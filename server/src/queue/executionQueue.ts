import { Queue } from "bullmq";
import { redis } from "./redis";
import { withTransaction } from "../db";
import type { ActionIntent } from "../security/schemas";

export const executionQueue = new Queue<ActionIntent>("vertice-execution", {
  connection: redis,
  prefix: "vertice",
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: "exponential", delay: 1000, jitter: 0.5 },
    removeOnComplete: { age: 86400, count: 10000 },
    removeOnFail: false
  }
});

export async function enqueueExecution(intent: ActionIntent): Promise<string> {
  await withTransaction(async client => {
    await client.query(
      "insert into tasks(id,tenant_id,user_id,idempotency_key,status,payload,created_at,updated_at) values($1,$2,$3,$4,'queued',$5,now(),now()) on conflict(tenant_id,idempotency_key) do nothing",
      [intent.actionId,intent.tenantId,intent.actorUserId,intent.idempotencyKey,JSON.stringify(intent)]
    );
    await client.query(
      "insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload,status,created_at) values($1,'task',$2,'execution.requested',$3,'pending',now()) on conflict do nothing",
      [intent.tenantId,intent.actionId,JSON.stringify(intent)]
    );
  });
  return intent.actionId;
}
