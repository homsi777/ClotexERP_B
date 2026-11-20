import type {PoolClient} from 'pg';

export type ReservationOwner={type:'DRAFT_SALE'|'CUSTOMER_ORDER_LINE';id:string;number:string};
const invalid=(message:string)=>Object.assign(new Error(message),{code:'INVALID_STOCK'});

export async function getRollReservation(db:PoolClient,company:string,roll:string){
  return (await db.query(`SELECT * FROM inventory_roll_reservations WHERE company_id=$1 AND roll_id=$2 AND released_at IS NULL`,[company,roll])).rows[0]??null;
}

export async function reserveRoll(db:PoolClient,company:string,user:string|null,roll:string,owner:ReservationOwner){
  const r=(await db.query('SELECT status FROM fabric_rolls WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,roll])).rows[0];
  if(!r)throw invalid('الرول غير موجود');
  const current=await getRollReservation(db,company,roll);
  if(current){
    if(current.reference_type===owner.type&&current.reference_id===owner.id&&r.status==='RESERVED')return;
    throw invalid('الرول محجوز لمرجع آخر');
  }
  if(r.status!=='AVAILABLE')throw invalid('الرول غير متاح للحجز أو يحتاج مراجعة مالك الحجز السابق');
  const holds=await db.query(`SELECT 1 FROM external_job_return_lines WHERE company_id=$1 AND result_roll_id=$2 AND defective AND resolution IS NULL LIMIT 1`,[company,roll]);
  if(holds.rows.length)throw invalid('الرول معلق بفحص الجودة');
  await db.query(`INSERT INTO inventory_roll_reservations(company_id,roll_id,reference_type,reference_id,reference_no,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[company,roll,owner.type,owner.id,owner.number,user]);
  await db.query("UPDATE fabric_rolls SET status='RESERVED',updated_at=now() WHERE company_id=$1 AND id=$2",[company,roll]);
  await db.query(`INSERT INTO inventory_movements(company_id,roll_id,movement_type,old_status,new_status,reference_type,reference_id,reference_no,created_by_user_id)
    VALUES($1,$2,'RESERVE','AVAILABLE','RESERVED',$3,$4,$5,$6)`,[company,roll,owner.type,owner.id,owner.number,user]);
}

export async function releaseRollReservation(db:PoolClient,company:string,user:string|null,roll:string,owner:ReservationOwner){
  const r=(await db.query('SELECT status FROM fabric_rolls WHERE company_id=$1 AND id=$2 FOR UPDATE',[company,roll])).rows[0];
  const current=await getRollReservation(db,company,roll);
  if(!current||current.reference_type!==owner.type||current.reference_id!==owner.id)return;
  await db.query('UPDATE inventory_roll_reservations SET released_at=clock_timestamp(),released_by_user_id=$3 WHERE company_id=$1 AND id=$2',[company,current.id,user]);
  if(r?.status!=='RESERVED')return;
  await db.query("UPDATE fabric_rolls SET status='AVAILABLE',updated_at=now() WHERE company_id=$1 AND id=$2",[company,roll]);
  await db.query(`INSERT INTO inventory_movements(company_id,roll_id,movement_type,old_status,new_status,reference_type,reference_id,reference_no,created_by_user_id)
    VALUES($1,$2,'RELEASE_RESERVATION','RESERVED','AVAILABLE',$3,$4,$5,$6)`,[company,roll,owner.type,owner.id,owner.number,user]);
}

export async function assertReservationForInvoice(db:PoolClient,company:string,roll:string,invoice:string,line:string|null){
  const owner=await getRollReservation(db,company,roll);
  if(!owner)throw invalid('حجز الرول بلا مرجع معروف؛ راجع الحجز قبل البيع');
  const ownInvoice=owner.reference_type==='DRAFT_SALE'&&owner.reference_id===invoice;
  const ownOrder=owner.reference_type==='CUSTOMER_ORDER_LINE'&&line&&owner.reference_id===line;
  if(!ownInvoice&&!ownOrder)throw invalid('الرول محجوز لأوردر أو فاتورة أخرى');
}

export async function consumeRollReservation(db:PoolClient,company:string,user:string|null,roll:string){
  await db.query('UPDATE inventory_roll_reservations SET released_at=clock_timestamp(),released_by_user_id=$3 WHERE company_id=$1 AND roll_id=$2 AND released_at IS NULL',[company,roll,user]);
}
