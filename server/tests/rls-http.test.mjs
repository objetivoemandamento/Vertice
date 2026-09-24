import { strict as assert } from "node:assert";
import jwt from "jsonwebtoken";
const base=String(process.env.STAGING_BASE_URL||"").replace(/\/$/,"");
const tokenA=String(process.env.STAGING_TOKEN_A||"");
const foreignCommand=String(process.env.STAGING_FOREIGN_COMMAND_ID||"");
const foreignDevice=String(process.env.STAGING_FOREIGN_DEVICE_ID||"");
if(!base||!tokenA||!foreignCommand||!foreignDevice){console.log("SKIP HTTP RLS test: staging variables missing");process.exit(0);}
const r=await fetch(base+"/commands/"+encodeURIComponent(foreignCommand)+"/status",{method:"POST",headers:{"Authorization":"Bearer "+tokenA,"Content-Type":"application/json","Idempotency-Key":"rls-"+crypto.randomUUID()},body:JSON.stringify({status:"succeeded",deviceId:foreignDevice})});
assert.equal(r.status,403);
const body=await r.json();assert.equal(body.code,"TENANT_ISOLATION");
console.log("PASS HTTP cross-tenant command isolation");

const customerToken=jwt.sign(
  {sub:"00000000-0000-0000-0000-000000000001",tenant_id:"10000000-0000-0000-0000-000000000001",role:"CUSTOMER"},
  process.env.JWT_SECRET,
  {issuer:"vertice",audience:"vertice-app",expiresIn:"10m"}
);
const denied=await fetch(base+"/security/emergency-stop",{method:"POST",headers:{"Authorization":"Bearer "+customerToken,"Content-Type":"application/json"},body:JSON.stringify({stopped:true})});
assert.equal(denied.status,403);

const stopped=await fetch(base+"/security/emergency-stop",{method:"POST",headers:{"Authorization":"Bearer "+tokenA,"Content-Type":"application/json"},body:JSON.stringify({stopped:true})});
assert.equal(stopped.status,200);

const resumed=await fetch(base+"/security/emergency-stop",{method:"POST",headers:{"Authorization":"Bearer "+tokenA,"Content-Type":"application/json"},body:JSON.stringify({stopped:false})});
assert.equal(resumed.status,200);
console.log("PASS emergency-stop OWNER-only control");
