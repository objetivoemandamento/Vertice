import { executionQueue } from "../queue/executionQueue";
import { query, withTransaction } from "../db";

type OutboxRow = {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

export async function publishPendingOutbox(limit = 100): Promise<number> {
  const rows: OutboxRow[] = await withTransaction(async client => {
    const selected = await client.query(
      "select id,tenant_id,aggregate_type,aggregate_id,event_type,payload from outbox_events where status='pending' and available_at<=now() order by created_at asc for update skip locked limit $1",
      [limit]
    );
    if (!selected.rows.length) return [];
    await client.query(
      "update outbox_events set attempts=attempts+1,available_at=now()+interval '60 seconds' where id = any($1::uuid[])",
      [selected.rows.map((row: OutboxRow) => row.id)]
    );
    return selected.rows as OutboxRow[];
  });

  let published = 0;
  for (const row of rows) {
    try {
      if (row.event_type === "execution.requested") {
        await executionQueue.add("execute", row.payload, { jobId: row.aggregate_id });
      }
      await query(
        "update outbox_events set status='published',published_at=now() where id=$1 and status='pending'",
        [row.id]
      );
      published += 1;
    } catch {
      await query(
        "update outbox_events set status=case when attempts>=10 then 'failed' else 'pending' end,available_at=now()+interval '10 seconds' where id=$1",
        [row.id]
      );
    }
  }
  return published;
}
