import { Queue } from "bullmq";
import { redis } from "./redis";
import { withTransaction } from "../db.js";
import { evaluatePolicy } from "../security/policyEngine";
import type { ActionIntent } from "../security/schemas";

export const executionQueue = new Queue<ActionIntent>("vertice-execution", {
  connection: redis, prefix: "vertice",
  defaultJobOptions: { attempts: 6, backoff: { type: "exponential", delay: 1000, jitter: 0.5 }, removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: false }
});

export async function enqueueExecution(intent: ActionIntent): Promise<{actionId:string;status:"queued"|"awaiting_mfa"|"awaiting_approval"|"denied"}> {
  const decision=evaluatePolicy(intent);
  if(!decision.allowed) throw new Error("POLICY_DENIED:"+decision.reason);
  const status=decision.risk==="mfa"?"awaiting_mfa":decision.risk==="approval"?"awaiting_approval":"queued";
  await withTransaction(async client=>{
    if (intent.resource==="command" && intent.operation==="create") {
      const p=intent.payload as Record<string,unknown>;
      const commandId=String(p.commandId||"");
      const deviceId=String(p.deviceId||"");
      const command=String(p.command||"");
      const mode=String(p.mode||"");
      const userId=String(p.userId||intent.actorUserId);
      if(!commandId||!deviceId||!command||!mode||userId!==intent.actorUserId) throw new Error("COMMAND_FIELDS_INVALID");
      await client.query(
        "insert into commands(id,user_id,tenant_id,device_id,mode,command,status,created_at,updated_at) values($1,$2,$3,$4,$5,$6,'created',now(),now()) on conflict(id) do nothing",
        [commandId,userId,intent.tenantId,deviceId,mode,command]
      );
      if(status==="queued") {
        await client.query("update commands set status='validated',updated_at=now() where id=$1 and status='created'",[commandId]);
        await client.query("update commands set status='authorized',updated_at=now() where id=$1 and status='validated'",[commandId]);
        await client.query("update commands set status='queued',updated_at=now() where id=$1 and status='authorized'",[commandId]);
      }
    }
    await client.query("insert into tasks(id,tenant_id,user_id,idempotency_key,status,payload,created_at,updated_at) values($1,$2,$3,$4,$5,$6,now(),now()) on conflict(tenant_id,idempotency_key) do nothing",[intent.actionId,intent.tenantId,intent.actorUserId,intent.idempotencyKey,status,JSON.stringify(intent)]);
    if(status==="queued") await client.query("insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload,status,created_at) values($1,'task',$2,'execution.requested',$3,'pending',now()) on conflict do nothing",[intent.tenantId,intent.actionId,JSON.stringify(intent)]);
  });
  return {actionId:intent.actionId,status};
}
