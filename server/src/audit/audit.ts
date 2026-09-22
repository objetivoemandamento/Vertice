import { query } from "../db";
import { getTenantContext } from "../security/tenantContext";

export async function writeAudit(input: {
  action: string;
  entityType: string;
  entityId: string;
  outcome: "success"|"failure"|"denied";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const ctx = getTenantContext();
  await query(
    "insert into audit_logs(tenant_id,user_id,action,entity_type,entity_id,outcome,metadata,created_at) values($1,$2,$3,$4,$5,$6,$7,now())",
    [ctx.tenantId, ctx.userId, input.action, input.entityType, input.entityId, input.outcome, JSON.stringify(input.metadata ?? {})]
  );
}
