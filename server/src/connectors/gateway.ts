import { actionSchema, type ActionIntent } from "../security/schemas";
import { CircuitBreaker } from "./circuitBreaker";
import { query, withTransaction } from "../db";
export type Connector={name:string;supports:(intent:ActionIntent)=>boolean;execute:(intent:ActionIntent)=>Promise<unknown>};
const connectors=new Map<string,Connector>(); const breakers=new Map<string,CircuitBreaker>();
const rateState=new Map<string,{started:number;count:number}>();
function allowRate(name:string):boolean{const max=Math.max(1,Number(process.env["VERTICE_CONNECTOR_"+name.toUpperCase()+"_RATE_MAX"]||30));const windowMs=Math.max(1000,Number(process.env["VERTICE_CONNECTOR_RATE_WINDOW_MS"]||1000));const now=Date.now();const s=rateState.get(name);if(!s||now-s.started>=windowMs){rateState.set(name,{started:now,count:1});return true;}if(s.count>=max)return false;s.count++;return true;}
export function registerConnector(connector:Connector):void{if(connectors.has(connector.name))throw new Error("CONNECTOR_ALREADY_REGISTERED");connectors.set(connector.name,connector);breakers.set(connector.name,new CircuitBreaker());}
export async function executeThroughConnector(raw:unknown):Promise<unknown>{
 const intent=actionSchema.parse(raw); const connector=[...connectors.values()].find(item=>item.supports(intent)); if(!connector)throw new Error("NO_REGISTERED_CONNECTOR");
 if(!allowRate(connector.name))throw new Error("CONNECTOR_RATE_LIMITED");
 const breaker=breakers.get(connector.name)!;
 return breaker.execute(async()=>{
   const claimed=await withTransaction(async client=>{
     const existing=await client.query("select status,response from connector_executions where tenant_id=$1 and idempotency_key=$2 for update",[intent.tenantId,intent.idempotencyKey]);
     if(existing.rows[0]?.status==="completed")return {state:"completed",response:existing.rows[0].response};
     if(existing.rows[0]?.status==="running")return {state:"running"};
     await client.query("insert into connector_executions(tenant_id,idempotency_key,connector,status,created_at,updated_at) values($1,$2,$3,'running',now(),now()) on conflict(tenant_id,idempotency_key) do update set status='running',updated_at=now()",[intent.tenantId,intent.idempotencyKey,connector.name]);
     return {state:"claimed"};
   });
   if(claimed.state==="completed")return claimed.response;
   if(claimed.state==="running")throw new Error("IDEMPOTENT_EXECUTION_IN_PROGRESS");
   try{const result=await connector.execute(intent);await query("update connector_executions set status='completed',response=$1,updated_at=now() where tenant_id=$2 and idempotency_key=$3",[JSON.stringify(result),intent.tenantId,intent.idempotencyKey]);return result;}
   catch(error){await query("update connector_executions set status='failed',updated_at=now() where tenant_id=$1 and idempotency_key=$2",[intent.tenantId,intent.idempotencyKey]);throw error;}
 });
}
