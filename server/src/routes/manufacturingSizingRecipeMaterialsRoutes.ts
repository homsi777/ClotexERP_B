import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {sendError} from '../middleware/errorHandler.js';
export const manufacturingSizingRecipeMaterialsRoutes:FastifyPluginAsync=async(app)=>{
  app.addHook('preHandler',async(req,reply)=>{const u=req.user!,permission=req.method==='GET'?'manufacturing.sizing.view':'manufacturing.sizing.manage';if(u.role!=='admin'&&!u.permissions.includes(permission)&&!(req.method==='GET'&&u.permissions.includes('manufacturing.sizing.manage')))return sendError(reply,403,'لا تملك صلاحية وصفات التصميغ','FORBIDDEN');});
  app.get('/recipe-material-options',async(req)=>({ok:true,data:(await getPool().query(`SELECT id,name,internal_code,unit FROM fabric_items WHERE company_id=$1 AND is_active AND unit='kg' AND weight_material_kind IS DISTINCT FROM 'YARN' ORDER BY name`,[req.user!.companyId])).rows}));
  app.get('/recipes/:recipeId/materials',async(req,reply)=>{
    const id=(req.params as {recipeId:string}).recipeId;if(!z.string().uuid().safeParse(id).success)return sendError(reply,400,'مرجع الوصفة غير صالح','VALIDATION');
    return {ok:true,data:(await getPool().query(`SELECT m.item_id AS "itemId",m.quantity_kg::float AS "quantityKg",m.notes,i.name,i.internal_code FROM manufacturing_sizing_recipe_materials m JOIN fabric_items i ON i.company_id=m.company_id AND i.id=m.item_id WHERE m.company_id=$1 AND m.recipe_id=$2 ORDER BY i.name`,[req.user!.companyId,id])).rows};
  });
  app.put('/recipes/:recipeId/materials',async(req,reply)=>{
    const id=(req.params as {recipeId:string}).recipeId,parsed=z.object({materials:z.array(z.object({itemId:z.string().uuid(),quantityKg:z.number().finite().positive().max(99999999).refine(n=>Math.abs(n*1000-Math.round(n*1000))<.00001),notes:z.string().trim().max(1000).default('')}).strict()).max(100)}).strict().safeParse(req.body);
    if(!z.string().uuid().safeParse(id).success||!parsed.success||new Set(parsed.data.materials.map(m=>m.itemId)).size!==parsed.data.materials.length)return sendError(reply,400,'مواد الوصفة غير صالحة أو مكررة','VALIDATION');
    const db=await getPool().connect();try{
      await db.query('BEGIN');const company=req.user!.companyId;
      const recipe=(await db.query("SELECT id FROM manufacturing_sizing_recipes WHERE company_id=$1 AND id=$2 AND status='DRAFT' FOR UPDATE",[company,id])).rows[0];
      if(!recipe){await db.query('ROLLBACK');return sendError(reply,409,'مواد الإصدار المعتمد لا تتغير؛ أنشئ إصداراً جديداً','INVALID_STATE');}
      for(const line of parsed.data.materials){const valid=await db.query("SELECT id FROM fabric_items WHERE company_id=$1 AND id=$2 AND is_active AND unit='kg' AND weight_material_kind IS DISTINCT FROM 'YARN' FOR SHARE",[company,line.itemId]);if(!valid.rows.length){await db.query('ROLLBACK');return sendError(reply,400,'اختر مادة استهلاكية موزونة من الشركة','VALIDATION');}}
      const before=(await db.query('SELECT * FROM manufacturing_sizing_recipe_materials WHERE company_id=$1 AND recipe_id=$2',[company,id])).rows;
      await db.query('DELETE FROM manufacturing_sizing_recipe_materials WHERE company_id=$1 AND recipe_id=$2',[company,id]);
      for(const line of parsed.data.materials)await db.query('INSERT INTO manufacturing_sizing_recipe_materials(company_id,recipe_id,item_id,quantity_kg,notes) VALUES($1,$2,$3,$4,$5)',[company,id,line.itemId,line.quantityKg,line.notes]);
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,'SIZING_RECIPE_MATERIALS','sizing_recipe',$3,$4::jsonb)`,[company,req.user!.sub,id,JSON.stringify({before,after:parsed.data.materials,basis:'PER_BATCH'})]);
      await db.query('COMMIT');return {ok:true};
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });
};
