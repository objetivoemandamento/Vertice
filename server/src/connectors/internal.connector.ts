import { z } from "zod";
import type { Connector } from "./gateway";
import type { ActionIntent } from "../security/schemas";
import { withTransaction } from "../db.js";
const p=z.object({action:z.enum(["register_device","create_command","update_command_status"]),deviceId:z.string().min(1).max(200).optional(),deviceName:z.string().max(100).optional(),mode:z.enum(["comando","operacao","monitoramento"]).optional(),commandId:z.string().uuid().optional(),command:z.string().max(2000).optional(),status:z.enum(["completed","failed","cancelled"]).optional(),userId:z.string().uuid()});
export const internalConnector:Connector={name:"internal",supports:i=>i.resource==="device"||i.resource==="command",execute:async(i:ActionIntent)=>{
 const x=p.parse(i.payload);
 if(x.userId!==i.actorUserId)throw new Error("ACTOR_MISMATCH");
 if(i.resource==="device"){if(!x.deviceId||!x.mode)throw new Error("DEVICE_FIELDS_REQUIRED");await withTransaction(async c=>{await c.query("insert into devices(id,user_id,device_name,mode,last_seen_at) values($1,$2,$3,$4,now()) on conflict(id) do update set user_id=excluded.user_id,device_name=excluded.device_name,mode=excluded.mode,last_seen_at=now()",[x.deviceId,x.userId,x.deviceName||"",x.mode])});return {deviceId:x.deviceId,mode:x.mode};}
 if(!x.commandId||!x.command||!x.mode||!x.deviceId)throw new Error("COMMAND_FIELDS_REQUIRED");
 if(i.operation==="create"){await withTransaction(async c=>{const d=await c.query("select user_id,mode,tenant_id from devices where id=$1 and tenant_id=$2",[x.deviceId,i.tenantId]);if(!d.rows[0]||d.rows[0].user_id!==x.userId)throw new Error("DEVICE_NOT_OWNED");if(x.mode==="operacao"&&d.rows[0].mode!=="operacao")throw new Error("DEVICE_MODE_MISMATCH");await c.query("insert into commands(id,user_id,tenant_id,device_id,mode,command,status,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'queued',now(),now()) on conflict(id) do nothing",[x.commandId,x.userId,i.tenantId,x.deviceId,x.mode,x.command])});return {commandId:x.commandId,status:"queued"};}
 if(i.operation==="update"){if(!x.status)throw new Error("COMMAND_STATUS_REQUIRED");const r=await import("../db.js").then(m=>m.query("update commands set status=$1,updated_at=now() where id=$2 and user_id=$3 and device_id=$4 and status in ('queued','running') returning status",[x.status,x.commandId,x.userId,x.deviceId]));if(!r.rows[0])throw new Error("COMMAND_NOT_FOUND");return {commandId:x.commandId,status:r.rows[0].status};}
 throw new Error("INTERNAL_COMMAND_OPERATION_UNSUPPORTED");
}};
