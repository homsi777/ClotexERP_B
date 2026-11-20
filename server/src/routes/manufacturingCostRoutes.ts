import {manufacturingAssetRegister,setManufacturingAssetAcquisition} from '../services/manufacturingFinancialSourcesService.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, type JwtPayload } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { approveManufacturingCharge, manageManufacturingRate, addManufacturingCharge, costRate, finalizeManufacturingCost, linkManufacturingExternal, lockCostOrder, manufacturingCostReport, postManufacturingMaterial,recordManufacturingConsumption } from '../services/manufacturingCostService.js';
const has = (u: JwtPayload, p: string) => u.role === 'admin' || u.permissions.includes(p);
const price = (u: JwtPayload) => ['admin', 'accountant'].includes(u.role) || has(u, 'manufacturing.cost.manage');
export const manufacturingCostRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', authenticateRequest);
    app.get('/options', async (req, reply) => {
        const u = req.user!;
        if (!has(u, 'inventory.manage') && !has(u, 'manufacturing.work_orders.view') && !has(u,'manufacturing.cost.view') && !price(u))
            return sendError(reply, 403, 'لا تملك صلاحية العرض', 'FORBIDDEN');
        const [orders, lots, stages, jobs] = await Promise.all([
            getPool().query("SELECT id,work_order_no,status FROM manufacturing_work_orders WHERE company_id=$1 AND status<>'CANCELLED' ORDER BY created_at DESC", [u.companyId]),
            getPool().query("SELECT y.id,y.barcode,y.weight_kg,f.name,f.weight_material_kind FROM yarn_lots y JOIN fabric_items f ON f.id=y.item_id AND f.company_id=y.company_id WHERE y.company_id=$1 AND y.status='AVAILABLE' ORDER BY f.name", [u.companyId]),
            getPool().query(`SELECT id,work_order_id,run_no name,'WEAVING' stage,status FROM manufacturing_weaving_runs WHERE company_id=$1 UNION ALL SELECT s.id,w.work_order_id,s.sizing_order_no name,'SIZING' stage,s.status FROM manufacturing_sizing_orders s JOIN manufacturing_warp_beams b ON b.id=s.input_beam_id AND b.company_id=s.company_id JOIN manufacturing_warping_orders w ON w.id=b.warping_order_id AND w.company_id=b.company_id WHERE s.company_id=$1`, [u.companyId]),
            getPool().query("SELECT id,job_no FROM external_jobs WHERE company_id=$1 AND job_kind='PROCESSING' AND document_status='CONFIRMED' ORDER BY created_at DESC", [u.companyId])
        ]);
        return { ok: true, data: { orders: orders.rows, lots: lots.rows, stages: stages.rows, jobs: jobs.rows, canPrice: price(u), canViewCost: price(u) || has(u, 'manufacturing.cost.view'), canPost: has(u, 'inventory.manage') } };
    });
    app.get('/financial-sources', async (req,reply) => {
        const u=req.user!;
        if(!price(u)) return sendError(reply,403,'لا تملك صلاحية العرض','FORBIDDEN');
        const [rates,machines,payroll,assets]=await Promise.all([
          getPool().query('SELECT * FROM manufacturing_internal_rates WHERE company_id=$1 ORDER BY id',[u.companyId]),
          getPool().query('SELECT id,name FROM manufacturing_machines WHERE company_id=$1 AND is_active',[u.companyId]),
          getPool().query(`SELECT l.id,l.employee_id,e.full_name,r.payroll_no,r.currency_code,l.base_salary,l.allowances,l.deductions,l.net_salary,l.base_salary+l.allowances gross_earnings,
          COALESCE((SELECT SUM(c.amount) FROM manufacturing_cost_charges c WHERE c.company_id=l.company_id AND c.payroll_line_id=l.id),0) allocated,
          (SELECT MIN(c.payroll_cost_basis) FROM manufacturing_cost_charges c WHERE c.company_id=l.company_id AND c.payroll_line_id=l.id) cost_basis,
          (SELECT MIN((c.payroll_source_snapshot->>'eligibleAmount')::numeric) FROM manufacturing_cost_charges c WHERE c.company_id=l.company_id AND c.payroll_line_id=l.id) eligible_amount
          FROM payroll_run_lines l JOIN payroll_runs r ON r.company_id=l.company_id AND r.id=l.payroll_run_id JOIN payroll_employees e ON e.company_id=l.company_id AND e.id=l.employee_id WHERE l.company_id=$1 AND r.status IN ('CONFIRMED','PAID') ORDER BY r.created_at DESC`,[u.companyId]),
          manufacturingAssetRegister(getPool(),u.companyId)
        ]);
        return {ok:true,data:{rates:rates.rows,machines:machines.rows,payroll:payroll.rows,assets,assetEngineAvailable:false}};
    });
    app.get('/asset-register',async(req,reply)=>{
        const u=req.user!;
        if(!price(u)&&!has(u,'manufacturing.cost.view')) return sendError(reply,403,'لا تملك صلاحية العرض','FORBIDDEN');
        return {ok:true,data:await manufacturingAssetRegister(getPool(),u.companyId)};
    });
    app.post('/asset-register/acquisition-date',async(req,reply)=>{
        const u=req.user!;
        if(!price(u)) return sendError(reply,403,'لا تملك صلاحية الإجراء','FORBIDDEN');
        const db=await getPool().connect();
        try{
            await db.query('BEGIN');
            const data=await setManufacturingAssetAcquisition(db,u.companyId,u.sub,req.body);
            await db.query('COMMIT');return {ok:true,data};
        }catch(e){await db.query('ROLLBACK').catch(()=>undefined);return handle(e,reply);}
        finally{db.release();}
    });
    app.get('/:id', async (req, reply) => {
        const u = req.user!;
        if (!price(u) && !has(u, 'manufacturing.cost.view') && !has(u, 'inventory.manage'))
            return sendError(reply, 403, 'لا تملك صلاحية العرض', 'FORBIDDEN');
        const id = (req.params as {
            id: string;
        }).id;
        if (!z.string().uuid().safeParse(id).success)
            return sendError(reply, 400, 'المعرف غير صالح', 'VALIDATION');
        try {
            const report = await manufacturingCostReport(getPool(), u.companyId, id);
            if (!price(u) && !has(u, 'manufacturing.cost.view'))
                return { ok: true, data: { work: report.work, materialBalances:report.materialBalances, materials: report.materials.map(m => ({ id: m.id, kind: m.kind, yarn_lot_id: m.yarn_lot_id, weaving_run_id: m.weaving_run_id, sizing_order_id: m.sizing_order_id, weight_kg: m.weight_kg, waste_kg: m.waste_kg, notes: m.notes })), external: report.external.map(j => ({ id: j.id, job_no: j.job_no, lifecycle_closed_at: j.lifecycle_closed_at })), rolls: report.rolls } };
            return { ok: true, data: report };
        }
        catch (e) {
            return handle(e, reply);
        }
    });
    for (const action of ['materials', 'consumption', 'charges', 'approve-charge', 'internal-rates', 'external-link', 'price-material', 'finalize'] as const) {
        app.post(`/:id/${action}`, async (req, reply) => {
            const u = req.user!;
            if (action === 'materials' ? !has(u, 'inventory.manage') : !price(u))
                return sendError(reply, 403, 'لا تملك صلاحية الإجراء', 'FORBIDDEN');
            const id = (req.params as {
                id: string;
            }).id;
            if (!z.string().uuid().safeParse(id).success)
                return sendError(reply, 400, 'المعرف غير صالح', 'VALIDATION');
            const db = await getPool().connect();
            try {
                await db.query('BEGIN');
                let data: unknown;
                let before: unknown = null;
                if (action === 'materials')
                    data = await postManufacturingMaterial(db, u.companyId, u.sub, id, req.body);
                else if(action==='consumption')
                    data=await recordManufacturingConsumption(db,u.companyId,u.sub,id,req.body);
                else if(action === 'approve-charge') data=await approveManufacturingCharge(db,u.companyId,u.sub,id,req.body);
                else if(action === 'internal-rates') data=await manageManufacturingRate(db,u.companyId,u.sub,req.body);
                else if (action === 'charges')
                    data = await addManufacturingCharge(db, u.companyId, u.sub, id, req.body);
                else if (action === 'external-link')
                    data = await linkManufacturingExternal(db, u.companyId, u.sub, id, z.object({ jobId: z.string().uuid() }).parse(req.body).jobId);
                else if (action === 'finalize')
                    data = await finalizeManufacturingCost(db, u.companyId, u.sub, id);
                else {
                    const p = z.object({ source: z.enum(['WARP', 'MATERIAL']), entryId: z.string().uuid(), unitCost: z.number().finite().min(0).max(99999999), currencyCode: z.string().length(3).transform(s => s.toUpperCase()), notes: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
                    await lockCostOrder(db, u.companyId, id);
                    const rate = await costRate(db, u.companyId, p.currencyCode);
                    if (!rate)
                        throw Object.assign(new Error('سعر الصرف غير صالح'), { code: 'VALIDATION' });
                    before = (await db.query(p.source==='WARP'
                        ? `SELECT l.id,l.issued_unit_cost,l.issued_currency_code,l.issued_exchange_rate FROM manufacturing_warping_yarn_issue_lines l JOIN manufacturing_warping_yarn_issues i ON i.id=l.issue_id AND i.company_id=l.company_id JOIN manufacturing_warping_orders w ON w.id=i.warping_order_id AND w.company_id=i.company_id WHERE l.company_id=$1 AND w.work_order_id=$2 AND l.id=$3`
                        : `SELECT id,unit_cost,currency_code,exchange_rate FROM manufacturing_material_entries WHERE company_id=$1 AND work_order_id=$2 AND (id=$3 OR source_entry_id=$3)`,[u.companyId,id,p.entryId])).rows;
                    if (p.source === 'WARP')
                        data = (await db.query(`UPDATE manufacturing_warping_yarn_issue_lines l SET issued_unit_cost=$4,issued_currency_code=$5,issued_exchange_rate=$6 FROM manufacturing_warping_yarn_issues i,manufacturing_warping_orders w WHERE l.company_id=$1 AND l.id=$3 AND i.id=l.issue_id AND i.company_id=l.company_id AND w.id=i.warping_order_id AND w.company_id=i.company_id AND w.work_order_id=$2 RETURNING l.id`, [u.companyId, id, p.entryId, p.unitCost, p.currencyCode, rate])).rows;
                    else
                        data = (await db.query(`UPDATE manufacturing_material_entries SET unit_cost=$4,currency_code=$5,exchange_rate=$6 WHERE company_id=$1 AND work_order_id=$2 AND ((id=$3 AND kind='ISSUE') OR source_entry_id=$3) RETURNING id`, [u.companyId, id, p.entryId, p.unitCost, p.currencyCode, rate])).rows;
                    if (!(data as unknown[]).length)
                        throw Object.assign(new Error('سطر التكلفة غير موجود'), { code: 'NOT_FOUND' });
                }
                await db.query("INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,'manufacturing_work_order',$4,$5::jsonb)", [u.companyId, u.sub, `MANUFACTURING_${action.toUpperCase()}`, id, JSON.stringify({ input: req.body, before, result: data })]);
                await db.query('COMMIT');
                return { ok: true, data };
            }
            catch (e) {
                await db.query('ROLLBACK').catch(() => undefined);
                return handle(e, reply);
            }
            finally {
                db.release();
            }
        });
    }
};
function handle(e: unknown, reply: import('fastify').FastifyReply) { const err = e as {
    code?: string;
    message?: string;
}; if (e instanceof z.ZodError)
    return sendError(reply, 400, e.issues[0]?.message ?? 'بيانات غير صالحة', 'VALIDATION'); if (err.code === 'NOT_FOUND')
    return sendError(reply, 404, err.message!, 'NOT_FOUND'); if (['VALIDATION', 'INVALID_STATE', 'INVALID_STOCK'].includes(err.code ?? ''))
    return sendError(reply, 400, err.message!, err.code!); if (['23505', 'DUPLICATE'].includes(err.code ?? ''))
    return sendError(reply, 409, 'طلب مكرر أو متعارض', 'DUPLICATE'); throw e; }
