import { z } from "zod";
import { httpJson } from "./httpClient";
import type { Connector } from "./gateway";
import type { ActionIntent } from "../security/schemas";
import { decryptSecret } from "../security/secretVault";
const payload=z.object({action:z.enum(["deploy","get_deployment","add_domain"]),projectId:z.string().optional(),name:z.string().optional(),target:z.enum(["production","preview","development"]).optional(),url:z.string().url().optional(),domain:z.string().min(1).optional()});
async function token(tenantId:string){const {query}=await import("../db");const r=await query("select access_token_ciphertext from connector_credentials where tenant_id=$1 and provider='vercel' and enabled=true",[tenantId]);if(!r.rows[0])throw new Error("VERCEL_CREDENTIAL_NOT_CONFIGURED");return decryptSecret(r.rows[0].access_token_ciphertext);}
export const vercelConnector:Connector={name:"vercel",supports:i=>i.resource==="vercel",execute:async(i:ActionIntent)=>{const p=payload.parse(i.payload),t=await token(i.tenantId),h={Authorization:"Bearer "+t};
 if(p.action==="deploy")return (await httpJson("https://api.vercel.com/v13/deployments",{method:"POST",headers:h,body:JSON.stringify({name:p.name,target:p.target})})).data;
 if(!p.projectId)throw new Error("VERCEL_PROJECT_REQUIRED");
 if(p.action==="get_deployment")return (await httpJson("https://api.vercel.com/v13/deployments/"+encodeURIComponent(p.projectId),{headers:h})).data;
 if(p.action==="add_domain"){if(!p.domain)throw new Error("VERCEL_DOMAIN_REQUIRED");return (await httpJson("https://api.vercel.com/v10/projects/"+encodeURIComponent(p.projectId)+"/domains",{method:"POST",headers:h,body:JSON.stringify({name:p.domain})})).data;}
 throw new Error("VERCEL_ACTION_NOT_SUPPORTED");
}};
