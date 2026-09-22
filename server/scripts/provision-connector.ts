import { query, runWithTenantContext } from "../src/db";
import { encryptSecret } from "../src/security/secretVault";
const provider=String(process.argv[2]||"").trim();
if(!["github","vercel","mercado_pago"].includes(provider))throw new Error("Provider must be github, vercel or mercado_pago");
const tenantId=String(process.env.STAGING_TENANT_ID||"");const userId=String(process.env.STAGING_USER_ID||"");const token=String(process.env.STAGING_CONNECTOR_TOKEN||"");
if(!tenantId||!userId||!token)throw new Error("STAGING_TENANT_ID, STAGING_USER_ID and STAGING_CONNECTOR_TOKEN are required");
await runWithTenantContext({tenantId,userId,role:"OWNER",requestId:crypto.randomUUID()},async()=>{
 await query("insert into connector_credentials(tenant_id,provider,access_token_ciphertext,enabled,created_at,updated_at) values($1,$2,$3,true,now(),now()) on conflict(tenant_id,provider) do update set access_token_ciphertext=excluded.access_token_ciphertext,enabled=true,updated_at=now()",[tenantId,provider,encryptSecret(token)]);
});
console.log("Connector credential stored encrypted:",provider);
