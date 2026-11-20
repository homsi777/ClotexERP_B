import type { PoolClient } from 'pg';
import { z } from 'zod';
const optionalId = z.string().uuid().nullish();
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(value + 'T00:00:00Z'); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value; }, 'Invalid calendar date').nullish();
export const customerOrderMetadataSchema = z.object({
 receivedOfficeId: optionalId, takenByEmployeeId: optionalId,
 // الآخذ للطلب: اسم يُكتب يدوياً (غير مربوط بالموارد البشرية) ويُحفظ للاقتراح لاحقاً
 takenByName: z.string().trim().max(120).nullish(),
 followUpEmployeeId: optionalId, followUpUserId: optionalId,
 sampleKind: z.string().trim().max(120).nullish(),
 sampleStatus: z.enum(['requested','received','approved','rejected']).nullish(),
 sampleRequestedDate: optionalDate, sampleReceivedDate: optionalDate, sampleApprovedDate: optionalDate,
});
export const metadataSelect = `o.received_office_id AS "receivedOfficeId", o.received_office_name AS "receivedOfficeName", o.taken_by_employee_id AS "takenByEmployeeId", o.taken_by_employee_name AS "takenByEmployeeName", o.follow_up_employee_id AS "followUpEmployeeId", o.follow_up_employee_name AS "followUpEmployeeName", o.follow_up_user_id AS "followUpUserId", o.follow_up_user_name AS "followUpUserName", o.sample_kind AS "sampleKind", o.sample_status AS "sampleStatus", o.sample_requested_date::text AS "sampleRequestedDate", o.sample_received_date::text AS "sampleReceivedDate", o.sample_approved_date::text AS "sampleApprovedDate"`;
export async function saveOrderMetadata(client: PoolClient, companyId: string, orderId: string, data: z.infer<typeof customerOrderMetadataSchema>) {
 const previous = await client.query('SELECT * FROM customer_orders WHERE id=$1 AND company_id=$2',[orderId,companyId]);
 const values: unknown[] = [orderId,companyId];
 const sets: string[] = [];
 const references = [
 ['receivedOfficeId','received_office','customer_order_offices','name'],
 ['takenByEmployeeId','taken_by_employee','payroll_employees','full_name'],
 ['followUpEmployeeId','follow_up_employee','payroll_employees','full_name'],
 ['followUpUserId','follow_up_user','users',"COALESCE(full_name,username)"],
 ] as const;
 if (data.takenByName !== undefined) {
   values.push(null,data.takenByName || null);
   sets.push(`taken_by_employee_id=$${values.length-1}`,`taken_by_employee_name=$${values.length}`);
 }
 for (const [key,column,table,name] of references) {
   if (data[key] === undefined) continue;
   if (key === 'takenByEmployeeId' && data.takenByName !== undefined) continue;
   const id = data[key] || null;
   let snapshot: string | null = null;
   if (id) {
     const reference = await client.query(`SELECT ${name} AS name,is_active FROM ${table} WHERE id=$1 AND company_id=$2 FOR SHARE`,[id,companyId]);
     if (!reference.rows.length || (!reference.rows[0].is_active && previous.rows[0][column+'_id'] !== id)) {
       throw Object.assign(new Error('مرجع غير صالح أو إجراء غير مسموح؛ راجع الطلبية والشركة'),{code:'VALIDATION'});
     }
     snapshot = previous.rows[0][column+'_id'] === id ? previous.rows[0][column+'_name'] || reference.rows[0].name : reference.rows[0].name;
   }
   values.push(id,snapshot);
   sets.push(`${column}_id=$${values.length-1}`,`${column}_name=$${values.length}`);
 }
 for (const [key,column] of Object.entries({sampleKind:'sample_kind',sampleStatus:'sample_status',sampleRequestedDate:'sample_requested_date',sampleReceivedDate:'sample_received_date',sampleApprovedDate:'sample_approved_date'})) {
   const value = data[key as keyof typeof data];
   if (value === undefined) continue;
   values.push(value || null); sets.push(`${column}=$${values.length}`);
 }
 if (sets.length) await client.query(`UPDATE customer_orders SET ${sets.join(',')} WHERE id=$1 AND company_id=$2`,values);
}
