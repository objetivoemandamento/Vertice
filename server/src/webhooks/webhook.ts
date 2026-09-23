import crypto from "node:crypto";
import { query, withTransaction } from "../db";

export function verifyHmac(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

export async function acceptWebhook(provider: string, eventId: string, payload: unknown): Promise<boolean> {
  if (!provider || !eventId) throw new Error("WEBHOOK_ID_REQUIRED");
  return withTransaction(async client => {
    const inserted = await client.query(
      "insert into webhook_events(provider,event_id,payload,received_at) values($1,$2,$3,now()) on conflict(provider,event_id) do nothing returning id",
      [provider,eventId,JSON.stringify(payload)]
    );
    return inserted.rowCount === 1;
  });
}
