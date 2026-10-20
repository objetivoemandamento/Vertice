-- VÉRTICE marketplace connections: encrypted OAuth tokens, isolated by tenant.
CREATE TABLE IF NOT EXISTS marketplace_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('mercado_livre')),
  external_user_id text NOT NULL,
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS marketplace_connections_tenant_user_idx
  ON marketplace_connections (tenant_id, user_id, provider);

ALTER TABLE marketplace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_connections_tenant_isolation ON marketplace_connections;
CREATE POLICY marketplace_connections_tenant_isolation ON marketplace_connections
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
