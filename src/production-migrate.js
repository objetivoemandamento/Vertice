const fs=require("fs");
const path=require("path");
const {Client}=require("pg");
async function migrateProduction(){
 if(process.env.NODE_ENV!=="production"||process.env.VERTICE_AUTO_MIGRATE!=="true") return;
 const client=new Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); await client.connect();
 try{await client.query("select pg_advisory_lock(hashtext('vertice-zero-trust-production'))");
  for(const file of ["20260922_zero_trust_kernel.sql","20260922_staging_hardening.sql"]){await client.query(fs.readFileSync(path.join(__dirname,"../server/migrations",file),"utf8")); console.log("[vertice-migrate] applied",file);}
  const r=(await client.query("select to_regclass('public.outbox_events') outbox_events,to_regclass('public.connector_executions') connector_executions,to_regclass('public.tasks') tasks,to_regclass('public.audit_logs') audit_logs,to_regclass('public.tenants') tenants")).rows[0];
  for(const k of ["outbox_events","connector_executions","tasks","audit_logs","tenants"]) if(!r[k]) throw new Error("MIGRATION_INCOMPLETE:"+k);
  console.log("[vertice-migrate] ZERO_TRUST_PRODUCTION_READY");
 }finally{try{await client.query("select pg_advisory_unlock(hashtext('vertice-zero-trust-production'))")}catch{} await client.end();}
}
module.exports={migrateProduction};
