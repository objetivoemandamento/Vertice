import { z } from "zod";
import { httpJson } from "./httpClient";
import type { Connector } from "./gateway";
import type { ActionIntent } from "../security/schemas";
import { decryptSecret } from "../security/secretVault";
const payload=z.object({action:z.enum(["create_repo","create_file","create_pr","create_webhook","get_repo"]),owner:z.string().optional(),repo:z.string().optional(),name:z.string().optional(),path:z.string().optional(),content:z.string().optional(),branch:z.string().optional(),title:z.string().optional(),body:z.string().optional(),base:z.string().optional(),head:z.string().optional(),webhookUrl:z.string().url().optional()});
async function token(tenantId:string){const r=await import("../db").then(m=>m.query("select access_token_ciphertext from connector_credentials where tenant_id=$1 and provider='github' and enabled=true",[tenantId])); if(!r.rows[0])throw new Error("GITHUB_CREDENTIAL_NOT_CONFIGURED"); return decryptSecret(r.rows[0].access_token_ciphertext);}
export const githubConnector:Connector={name:"github",supports:i=>i.resource==="github",execute:async(i:ActionIntent)=>{
 const p=payload.parse(i.payload),t=await token(i.tenantId),h={Authorization:"Bearer "+t,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
 if(p.action==="create_repo")return (await httpJson("https://api.github.com/user/repos",{method:"POST",headers:h,body:JSON.stringify({name:p.name,private:true})})).data;
 if(!p.owner||!p.repo)throw new Error("GITHUB_REPOSITORY_REQUIRED");
 if(p.action==="get_repo")return (await httpJson("https://api.github.com/repos/"+encodeURIComponent(p.owner)+"/"+encodeURIComponent(p.repo),{headers:h})).data;
 if(p.action==="create_file"){if(!p.path||p.content===undefined)throw new Error("GITHUB_FILE_REQUIRED");return (await httpJson("https://api.github.com/repos/"+p.owner+"/"+p.repo+"/contents/"+p.path,{method:"PUT",headers:h,body:JSON.stringify({message:p.title||"VÉRTICE commit",content:Buffer.from(p.content).toString("base64"),branch:p.branch})})).data;}
 if(p.action==="create_pr")return (await httpJson("https://api.github.com/repos/"+p.owner+"/"+p.repo+"/pulls",{method:"POST",headers:h,body:JSON.stringify({title:p.title,body:p.body,head:p.head,base:p.base})})).data;
 if(p.action==="create_webhook"){if(!p.webhookUrl)throw new Error("GITHUB_WEBHOOK_URL_REQUIRED");return (await httpJson("https://api.github.com/repos/"+p.owner+"/"+p.repo+"/hooks",{method:"POST",headers:h,body:JSON.stringify({name:"web",active:true,events:["push","pull_request"],config:{url:p.webhookUrl,content_type:"json",insecure_ssl:"0"}})})).data;}
 throw new Error("GITHUB_ACTION_NOT_SUPPORTED");
}};
