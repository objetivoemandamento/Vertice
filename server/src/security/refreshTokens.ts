import crypto from "node:crypto";
import { query, withTransaction } from "../db";

function hash(token: string): string {
  return crypto.createHash("sha256").update(token,"utf8").digest("hex");
}

export async function rotateRefreshToken(input: {
  token: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
  issue: () => string;
}): Promise<{ token: string; reused: boolean }> {
  const oldHash = hash(input.token);
  return withTransaction(async client => {
    const current = await client.query(
      "select id,user_id,tenant_id,revoked_at,expires_at from refresh_tokens where token_hash=$1 for update",
      [oldHash]
    );
    if (!current.rows[0]) throw new Error("REFRESH_TOKEN_INVALID");
    const row = current.rows[0];
    if (row.revoked_at) {
      await client.query(
        "update refresh_tokens set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and tenant_id=$2 and revoked_at is null",
        [input.userId,input.tenantId]
      );
      return { token: "", reused: true };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("REFRESH_TOKEN_EXPIRED");
    const next = input.issue();
    await client.query("update refresh_tokens set revoked_at=now() where id=$1",[row.id]);
    await client.query(
      "insert into refresh_tokens(user_id,tenant_id,token_hash,expires_at) values($1,$2,$3,$4)",
      [input.userId,input.tenantId,hash(next),input.expiresAt]
    );
    return { token: next, reused: false };
  });
}

export async function revokeAllRefreshTokens(userId: string, tenantId: string): Promise<void> {
  await query("update refresh_tokens set revoked_at=now() where user_id=$1 and tenant_id=$2 and revoked_at is null",[userId,tenantId]);
}
