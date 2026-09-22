import { Queue } from "bullmq";
import { redis } from "./redis";
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
  const job = await executionQueue.add("execute", intent, {
    jobId: intent.idempotencyKey
  });
  return job.id!;
}
