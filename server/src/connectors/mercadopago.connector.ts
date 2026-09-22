import { z } from "zod";
import { httpJson } from "./httpClient";
import type { Connector } from "./gateway";
import type { ActionIntent } from "../security/schemas";
import { decryptSecret } from "../security/secretVault";
const payload=z.object({action:z.enum(["create_pix","create_preference","get_payment","reconcile"]),paymentId:z.string().optional(),amount:z.number().positive().optional(),currency:z.string().length(3).optional(),description:z.string().min(1).max(200).optional(),externalReference:z.string().min(1).max(200).optional(),payerEmail:z.string().email().optional(),preferenceId:z.string().optional()});
async function token(tenantId:string){const {query}=await import("../db");const r=await query("select access_token_ciphertext from connector_credentials where tenant_id=$1 and provider='mercado_pago' and enabled=true",[tenantId]);if(!r.rows[0])throw new Error("MERCADOPAGO_CREDENTIAL_NOT_CONFIGURED");return decryptSecret(r.rows[0].access_token_ciphertext);}
export const mercadoPagoConnector:Connector={name:"mercado_pago",supports:i=>i.resource==="mercado_pago",execute:async(i:ActionIntent)=>{const p=payload.parse(i.payload),t=await token(i.tenantId),h={Authorization:"Bearer "+t};
 if(p.action==="create_pix")return (await httpJson("https://api.mercadopago.com/v1/payments",{method:"POST",headers:{...h,"X-Idempotency-Key":i.idempotencyKey},body:JSON.stringify({transaction_amount:p.amount,payment_method_id:"pix",description:p.description,payer:{email:p.payerEmail},external_reference:p.externalReference})})).data;
 if(p.action==="create_preference")return (await httpJson("https://api.mercadopago.com/checkout/preferences",{method:"POST",headers:{...h,"X-Idempotency-Key":i.idempotencyKey},body:JSON.stringify({items:[{title:p.description||"VÉRTICE",quantity:1,unit_price:p.amount,currency_id:p.currency||"BRL"}],payer:p.payerEmail?{email:p.payerEmail}:undefined,external_reference:p.externalReference})})).data;
 if(!p.paymentId)throw new Error("MERCADOPAGO_PAYMENT_REQUIRED");
 if(p.action==="get_payment")return (await httpJson("https://api.mercadopago.com/v1/payments/"+encodeURIComponent(p.paymentId),{headers:h})).data;
 if(p.action==="reconcile")return (await httpJson("https://api.mercadopago.com/v1/payments/search?external_reference="+encodeURIComponent(p.externalReference||""),{headers:h})).data;
 throw new Error("MERCADOPAGO_ACTION_NOT_SUPPORTED");
}};
