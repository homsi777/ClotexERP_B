import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {getPool} from '../db/pool.js';
import {sendError} from '../middleware/errorHandler.js';
import {listNotificationInbox,notificationRecipientDiagnostics,scanCustomerOrderNotifications,setNotificationRead} from '../services/customerOrderNotificationService.js';

export const customerOrderNotificationRoutes:FastifyPluginAsync=async(app)=>{
  app.get('/notifications/routing',async(req,reply)=>{
    if(req.user!.role!=='admin'&&!req.user!.permissions.includes('customers.manage'))return sendError(reply,403,'لا تملك صلاحية إدارة التنبيهات','FORBIDDEN');
    const db=await getPool().connect();try{
      const users=await db.query(`SELECT id,COALESCE(full_name,username) AS name FROM users WHERE company_id=$1 AND is_active ORDER BY name`,[req.user!.companyId]);
      const phases=await db.query('SELECT phase,user_id AS "userId" FROM customer_order_notification_phase_users WHERE company_id=$1',[req.user!.companyId]);
      return {ok:true,data:{users:users.rows,phases:phases.rows}};
    }finally{db.release();}
  });
  app.put('/notifications/routing',async(req,reply)=>{
    if(req.user!.role!=='admin'&&!req.user!.permissions.includes('customers.manage'))return sendError(reply,403,'لا تملك صلاحية إدارة التنبيهات','FORBIDDEN');
    const parsed=z.object({phase:z.enum(['pending_supply','partial_ready','ready_pickup']),userId:z.string().uuid().nullable()}).safeParse(req.body);
    if(!parsed.success)return sendError(reply,400,'بيانات التوجيه غير صالحة','VALIDATION');
    const db=await getPool().connect();try{
      await db.query('BEGIN');
      const {phase,userId}=parsed.data,companyId=req.user!.companyId;
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`order-routing:${companyId}:${phase}`]);
      const previous=await db.query('SELECT user_id FROM customer_order_notification_phase_users WHERE company_id=$1 AND phase=$2',[companyId,phase]);
      if(userId){
        const user=await db.query(`SELECT u.id FROM users u WHERE u.company_id=$1 AND u.id=$2 AND u.is_active
          AND (u.role='admin' OR EXISTS(SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE r.code=u.role AND p.code='customers.view')) FOR SHARE OF u`,[companyId,userId]);
        if(!user.rows.length){await db.query('ROLLBACK');return sendError(reply,400,'المستخدم غير فعال أو لا يملك صلاحية عرض الأوردرات','VALIDATION');}
        await db.query(`INSERT INTO customer_order_notification_phase_users(company_id,phase,user_id) VALUES($1,$2,$3) ON CONFLICT(company_id,phase) DO UPDATE SET user_id=EXCLUDED.user_id`,[companyId,phase,userId]);
      }else await db.query('DELETE FROM customer_order_notification_phase_users WHERE company_id=$1 AND phase=$2',[companyId,phase]);
      await db.query(`INSERT INTO audit_logs(company_id,user_id,action,entity_type,details) VALUES($1,$2,'ORDER_NOTIFICATION_ROUTING','notification_routing',$3::jsonb)`,[companyId,req.user!.sub,JSON.stringify({phase,before:previous.rows[0]?.user_id??null,after:userId})]);
      await db.query('COMMIT');return {ok:true};
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });
  let timer:ReturnType<typeof setInterval>|undefined,running=false;
  app.addHook('onReady',async()=>{
    if(process.env.NODE_ENV==='test')return;
    timer=setInterval(()=>{if(running)return;running=true;void(async()=>{
      const companies=await getPool().query(`SELECT DISTINCT o.company_id FROM customer_orders o WHERE o.status IN ('pending_supply','partial_ready','ready_pickup')
        OR EXISTS(SELECT 1 FROM customer_order_notification_phase_outbox q WHERE q.company_id=o.company_id AND q.order_id=o.id AND q.processed_at IS NULL)
        OR EXISTS(SELECT 1 FROM app_notification_events n WHERE n.company_id=o.company_id AND n.entity_id=o.id AND n.source='customer_order' AND n.resolved_at IS NULL)`);
      for(const c of companies.rows)try{await scanCustomerOrderNotifications(getPool(),c.company_id);}catch(e){app.log.error(e,'Order notification scan failed');}
    })().catch(e=>app.log.error(e)).finally(()=>{running=false;});},60000);timer.unref();
  });
  app.addHook('onClose',async()=>{if(timer)clearInterval(timer);});
  app.get('/notifications',async(req)=>{const db=await getPool().connect();try{return {ok:true,data:await listNotificationInbox(db,req.user!.companyId,req.user!.sub,(req.query as {unread?:string}).unread==='true')};}finally{db.release();}});
  app.post('/notifications/:notificationId/read',async(req,reply)=>{
    const id=(req.params as {notificationId:string}).notificationId;
    const parsed=z.object({read:z.boolean()}).safeParse(req.body);
    if(!z.string().uuid().safeParse(id).success||!parsed.success)return sendError(reply,400,'بيانات الإشعار غير صالحة','VALIDATION');
    const db=await getPool().connect();try{if(!await setNotificationRead(db,req.user!.companyId,req.user!.sub,id,parsed.data.read))return sendError(reply,404,'الإشعار غير موجود','NOT_FOUND');return {ok:true};}finally{db.release();}
  });
  app.post('/notifications/refresh',async(req,reply)=>{
    if(req.user!.role!=='admin'&&!req.user!.permissions.includes('customers.manage'))return sendError(reply,403,'لا تملك صلاحية تحديث التنبيهات','FORBIDDEN');
    return {ok:true,data:await scanCustomerOrderNotifications(getPool(),req.user!.companyId)};
  });
  app.get('/notifications/diagnostics',async(req,reply)=>{
    if(req.user!.role!=='admin'&&!req.user!.permissions.includes('customers.manage'))return sendError(reply,403,'لا تملك صلاحية العرض','FORBIDDEN');
    const db=await getPool().connect();try{return {ok:true,data:await notificationRecipientDiagnostics(db,req.user!.companyId)};}finally{db.release();}
  });
};
