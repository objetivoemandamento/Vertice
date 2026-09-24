import { strict as assert } from "node:assert";
const base=String(process.env.STAGING_BASE_URL||"").replace(/\/$/,"");
const tokenA=String(process.env.STAGING_TOKEN_A||"");
const foreignCommand=String(process.env.STAGING_FOREIGN_COMMAND_ID||"");
const foreignDevice=String(process.env.STAGING_FOREIGN_DEVICE_ID||"");
if(!base||!tokenA||!foreignCommand||!foreignDevice){console.log("SKIP HTTP RLS test: staging variables missing");process.exit(0);}
const r=await fetch(base+"/commands/"+encodeURIComponent(foreignCommand)+"/status",{method:"POST",headers:{"Authorization":"Bearer "+tokenA,"Content-Type":"application/json","Idempotency-Key":"rls-"+crypto.randomUUID()},body:JSON.stringify({status:"succeeded",deviceId:foreignDevice})});
assert.equal(r.status,403);
const body=await r.json();assert.equal(body.code,"TENANT_ISOLATION");
console.log("PASS HTTP cross-tenant command isolation");
