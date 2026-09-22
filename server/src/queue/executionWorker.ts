import { Worker, UnrecoverableError } from "bullmq";
import { workerRedis } from "./redis";
import { actionSchema } from "../security/schemas";
import { evaluatePolicy } from "../security/policyEngine";
import { withTransaction } from "../db";

const WORKER_ID = process.env.HOSTNAME || `worker-${process.pid}`;

async function acquireLease(tenantId: string, taskId: string): Promise<boolean> {
  const result = await withTransaction(async client => {
    const r = await client.query(
      "update tasks set locked_by=$1,locked_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() where id=$2 and tenant_id=$3 and status='queued' and (locked_until is null or locked_until<now()) returning id",
      [WORKER_ID,taskId,tenantId]
    );
    return r.rowCount === 1;
  });
  return result;
}

export const executionWorker = new Worker("vertice-execution", async job => {
  const intent = actionSchema.parse(job.data);
  const decision = evaluatePolicy(intent);
  if (!decision.allowed) throw new UnrecoverableError(decision.reason);
  if (decision.risk !== "automatic") throw new UnrecoverableError("APPROVAL_REQUIRED_BEFORE_WORKER");
  const leased = await acquireLease(intent.tenantId,intent.actionId);
  if (!leased) throw new UnrecoverableError("TASK_LEASE_NOT_ACQUIRED");
  // External side effects must be performed only by a connector selected by policy.
  // The current kernel intentionally fails closed until a registered connector claims this action type.
  throw new UnrecoverableError("NO_REGISTERED_CONNECTOR");
}, {
  connection: workerRedis,
  prefix: "vertice",
  concurrency: Number(process.env.VERTICE_WORKER_CONCURRENCY || 10),
  limiter: { max: Number(process.env.VERTICE_WORKER_RATE_MAX || 100), duration: Number(process.env.VERTICE_WORKER_RATE_MS || 1000) }
});

executionWorker.on("failed", (job,error) => {
  console.error("[vertice-worker]", job?.id, error.message);
});
