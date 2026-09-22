import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

const tenantIdSchema = z.string().uuid();

type Context = { tenantId: string; userId: string; role: string; requestId: string };
const storage = new AsyncLocalStorage<Context>();

export function runTenantContext<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
  tenantIdSchema.parse(ctx.tenantId);
  return storage.run(ctx, fn);
}

export function getTenantContext(): Context {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("TENANT_CONTEXT_REQUIRED");
  return ctx;
}

export function getOptionalTenantContext(): Context | undefined {
  return storage.getStore();
}
