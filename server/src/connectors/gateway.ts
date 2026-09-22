import { actionSchema, type ActionIntent } from "../security/schemas";
import { CircuitBreaker } from "./circuitBreaker";
import { query, withTransaction } from "../db";

export type Connector = {
  name: string;
  supports: (intent: ActionIntent) => boolean;
  execute: (intent: ActionIntent) => Promise<unknown>;
};

const connectors = new Map<string, Connector>();
const breakers = new Map<string, CircuitBreaker>();

export function registerConnector(connector: Connector): void {
  if (connectors.has(connector.name)) throw new Error("CONNECTOR_ALREADY_REGISTERED");
  connectors.set(connector.name, connector);
  breakers.set(connector.name, new CircuitBreaker());
}

export async function executeThroughConnector(raw: unknown): Promise<unknown> {
  const intent = actionSchema.parse(raw);
  const connector = [...connectors.values()].find(item => item.supports(intent));
  if (!connector) throw new Error("NO_REGISTERED_CONNECTOR");
  const breaker = breakers.get(connector.name)!;
  return breaker.execute(async () => {
    const already = await query(
      "select status,response from connector_executions where tenant_id=$1 and idempotency_key=$2",
      [intent.tenantId,intent.idempotencyKey]
    );
    if (already.rows[0]?.status === "completed") return already.rows[0].response;

    const result = await connector.execute(intent);
    await withTransaction(async client => {
      await client.query(
        "insert into connector_executions(tenant_id,idempotency_key,connector,status,response,created_at) values($1,$2,$3,'completed',$4,now()) on conflict(tenant_id,idempotency_key) do update set status='completed',response=excluded.response",
        [intent.tenantId,intent.idempotencyKey,connector.name,JSON.stringify(result)]
      );
    });
    return result;
  });
}
