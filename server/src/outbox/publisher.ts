import { executionQueue } from "../queue/executionQueue";
import { query } from "../db";

export async function publishPendingOutbox(limit = 100): Promise<number> {
  const rows = await query(
    "select id,tenant_id,aggregate_type,aggregate_id,event_type,payload from outbox_events where status='pending' and available_at<=now() order by created_at asc for update skip locked limit $1",
    [limit]
  );
  let published = 0;
  for (const row of rows.rows) {
    try {
      if (row.event_type === "execution.requested") {
        await executionQueue.add("execute", row.payload, { jobId: String(row.aggregate_id) });
      }
      await query("update outbox_events set status='published',published_at=now(),attempts=attempts+1 where id=$1 and status='pending'",[row.id]);
      published += 1;
    } catch {
      await query("update outbox_events set status=case when attempts+1>=10 then 'failed' else 'pending' end,attempts=attempts+1,available_at=now()+interval '10 seconds' where id=$1",[row.id]);
    }
  }
  return published;
}
