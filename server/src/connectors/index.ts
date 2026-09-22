import { registerConnector } from "./gateway";
import { githubConnector } from "./github.connector";
import { vercelConnector } from "./vercel.connector";
import { mercadoPagoConnector } from "./mercadopago.connector";
let registered=false;
export function registerProductionConnectors():void{if(registered)return;registerConnector(githubConnector);registerConnector(vercelConnector);registerConnector(mercadoPagoConnector);registered=true;}
