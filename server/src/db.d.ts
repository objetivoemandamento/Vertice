import type { Pool, PoolClient, QueryResult } from "pg";
export type TenantContext = { tenantId: string; userId: string };
export const pool: Pool;
export function query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
export function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T;
export function requireContext(): TenantContext;
export function waitForDatabase(retries?: number): Promise<boolean>;
export function closeDatabase(): Promise<void>;
