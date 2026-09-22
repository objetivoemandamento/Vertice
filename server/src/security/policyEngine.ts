import type { ActionIntent } from "./schemas";
export type PolicyDecision=
 |{risk:"automatic";allowed:true;reason:string;policyVersion:string}
 |{risk:"approval";allowed:true;reason:string;policyVersion:string}
 |{risk:"mfa";allowed:true;reason:string;policyVersion:string}
 |{risk:"deny";allowed:false;reason:string;policyVersion:string};
const VERSION="2026-09-22.2";
export function evaluatePolicy(input:ActionIntent):PolicyDecision{
 if(!input.tenantId||!input.actorUserId)return{risk:"deny",allowed:false,reason:"Identidade incompleta.",policyVersion:VERSION};
 if(input.idempotencyKey.length<16)return{risk:"deny",allowed:false,reason:"Idempotency key inválida.",policyVersion:VERSION};
 if(input.operation==="read")return{risk:"automatic",allowed:true,reason:"Leitura sem mutação.",policyVersion:VERSION};
 if(input.resource==="device"&&["create","update"].includes(input.operation))return{risk:"automatic",allowed:true,reason:"Registro de dispositivo no tenant do ator.",policyVersion:VERSION};
 if(input.resource==="command"&&input.operation==="create"){const mode=String(input.payload?.mode||"");return mode==="operacao"?{risk:"mfa",allowed:true,reason:"Comando operacional exige MFA.",policyVersion:VERSION}:{risk:"automatic",allowed:true,reason:"Comando não operacional permitido automaticamente.",policyVersion:VERSION};}
 if(["charge","refund","credential_change","delete"].includes(input.operation))return{risk:"mfa",allowed:true,reason:"Operação crítica exige aprovação e MFA.",policyVersion:VERSION};
 if(["publish","execute","create","update"].includes(input.operation))return{risk:"approval",allowed:true,reason:"Operação mutável exige aprovação.",policyVersion:VERSION};
 return{risk:"deny",allowed:false,reason:"Operação não permitida pela allowlist.",policyVersion:VERSION};
}
