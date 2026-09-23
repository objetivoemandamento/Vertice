import { query } from "../db";

export async function enqueueOutbox(
  tenantId: string,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<string> {
  const result = await query(
    "insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload,status,created_at) values($1,$2,$3,$4,$5,'pending',now()) returning id",
    [tenantId,aggregateType,aggregateId,eventType,JSON.stringify(payload)]
  );
  return result.rows[0].id;
}
