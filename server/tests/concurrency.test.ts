import crypto from "node:crypto";
import { strict as assert } from "node:assert";
import { Pool } from "pg";

async function main() {
  const DB=String(process.env.DATABASE_URL||"");
  if(!DB) throw new Error("DATABASE_URL is required for the concurrency test");
  const p=new Pool({connectionString:DB,ssl:/localhost|127\.0\.0.1/.test(DB)?false:{rejectUnauthorized:true}});
  const tenant=String(process.env.STAGING_TEST_TENANT_ID||"");
  const user=String(process.env.STAGING_TEST_USER_ID||"");
  if(!tenant||!user) throw new Error("STAGING_TEST_TENANT_ID and STAGING_TEST_USER_ID are required");
  const task=crypto.randomUUID();
  const key="concurrency-"+crypto.randomUUID();
  try {
    await p.query("insert into tasks(id,tenant_id,user_id,idempotency_key,payload) values($1,$2,$3,$4,'{}')",[task,tenant,user,key]);
    const workers=Array.from({length:32},(_,i)=>p.query("update tasks set locked_by=$1,locked_until=now()+interval '30 seconds',status='running' where id=$2 and tenant_id=$3 and status='queued' and (locked_until is null or locked_until<now()) returning id",["test-"+i,task,tenant]));
    const results=await Promise.all(workers);
    assert.equal(results.filter(r=>r.rowCount===1).length,1);
    const duplicate=await p.query("insert into tasks(id,tenant_id,user_id,idempotency_key,payload) values($1,$2,$3,$4,'{}') on conflict(tenant_id,idempotency_key) do nothing",[crypto.randomUUID(),tenant,user,key]);
    assert.equal(duplicate.rowCount,0);
    console.log("PASS concurrency/idempotency: 32 contenders -> 1 lease; duplicate idempotency -> 0 inserts");
  } finally {
    await p.query("delete from tasks where id=$1",[task]);
    await p.end();
  }
}
main().catch(err=>{console.error(err);process.exit(1);});
