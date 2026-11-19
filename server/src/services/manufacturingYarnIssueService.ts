import type { PoolClient } from 'pg';
export async function generateWarpingYarnIssueNo(client:PoolClient,companyId:string){
 await client.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext('MANUFACTURING_YARN_ISSUE_NUM'))`,[companyId]);
 const r=await client.query<{max_seq:string|null}>(`SELECT MAX((substring(issue_no from 4))::int)::text AS max_seq FROM manufacturing_warping_yarn_issues WHERE company_id=$1 AND issue_no ~ '^YI-[0-9]{7}$'`,[companyId]);
 return `YI-${String(Number(r.rows[0]?.max_seq??0)+1).padStart(7,'0')}`;
}
export function validateYarnSettlement(input:{issued:number;returned:number;waste:number}){
 if(![input.issued,input.returned,input.waste].every(Number.isFinite)||input.issued<0||input.returned<0||input.waste<0)return 'أوزان الخيط غير صالحة';
 if(input.returned+input.waste>input.issued+0.0005)return 'مجموع المرتجع والهالك يتجاوز الوزن المصروف';
 return null;
}
