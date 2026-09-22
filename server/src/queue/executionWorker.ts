import { Worker, UnrecoverableError } from "bullmq";
import { workerRedis } from "./redis";
import { actionSchema } from "../security/schemas";
import { evaluatePolicy } from "../security/policyEngine";
import { executeThroughConnector } from "../connectors/gateway";
import { withTransaction } from "../db.js";
import { registerProductionConnectors } from "../connectors";

const WORKER_ID = process.env.HOSTNAME || "worker-" + process.pid;
registerProductionConnectors();

async function acquireLease(tenantId: string, taskId: string): Promise<boolean> {
  return withTransaction(async client => {
    const r = await client.query(
      "update tasks set locked_by=$1,locked_until=now()+interval '60 seconds',attempts=attempts+1,status='running',updated_at=now() where id=$2 and tenant_id=$3 and status='queued' and (locked_until is null or locked_until<now()) returning id",
      [WORKER_ID,taskId,tenantId]
    );
    return r.rowCount === 1;
  });
}
async function finishTask(id: string, tenantId: string, status: "completed"|"failed"|"dead"): Promise<void> {
  await withTransaction(async client => {
    await client.query("update tasks set status=$1,locked_by=null,locked_until=null,updated_at=now() where id=$2 and tenant_id=$3 and locked_by=$4",[status,id,tenantId,WORKER_ID]);
  });
}
export const executionWorker = new Worker("vertice-execution", async job => {
  const intent = actionSchema.parse(job.data);
  const decision = evaluatePolicy(intent);
  if (!decision.allowed) throw new UnrecoverableError(decision.reason);
  const task = (await import("../db.js")).query("select status,mfa_verified_at from tasks where id=$1 and tenant_id=$2",[intent.actionId,intent.tenantId]);
  const row=(await task).rows[0];
  if(decision.risk==="approval") throw new UnrecoverableError("APPROVAL_REQUIRED_BEFORE_WORKER");
  if(decision.risk==="mfa" && !row?.mfa_verified_at) throw new UnrecoverableError("MFA_REQUIRED_BEFORE_WORKER");
  const leased = await acquireLease(intent.tenantId,intent.actionId);
  if (!leased) throw new UnrecoverableError("TASK_LEASE_NOT_ACQUIRED");
  try {
    const result = await executeThroughConnector(intent);
    await finishTask(intent.actionId,intent.tenantId,"completed");
    return result;
  } catch (error) {
    const attempts = job.attemptsMade + 1;
    await finishTask(intent.actionId,intent.tenantId,attempts >= 6 ? "dead" : "failed");
    throw error instanceof Error ? error : new Error("CONNECTOR_EXECUTION_FAILED");
  }
}, {
  connection: workerRedis,
  prefix: "vertice",
  concurrency: Number(process.env.VERTICE_WORKER_CONCURRENCY || 10),
  limiter: { max: Number(process.env.VERTICE_WORKER_RATE_MAX || 100), duration: Number(process.env.VERTICE_WORKER_RATE_MS || 1000) }
});
executionWorker.on("failed", (job,error) => console.error("[vertice-worker]", job?.id, error.message));
