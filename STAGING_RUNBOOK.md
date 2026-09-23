# VÉRTICE — Staging Readiness Runbook

## 1. Pré-requisitos
- Docker e Docker Compose
- Node.js 22.x
- PostgreSQL client (psql)
- Credenciais de staging para GitHub/Vercel/Mercado Pago
- Domínio HTTPS de staging para webhooks

## 2. Segredos
Use server/.env.staging.example como manifesto e gere:
- JWT_SECRET: mínimo 32 bytes aleatórios
- VERTICE_MASTER_KEY: exatamente 32 bytes em hexadecimal (64 caracteres)
- PAYMENT_CAPABILITY_SECRET: mínimo 32 bytes aleatórios
- POSTGRES_PASSWORD
- APP_DB_PASSWORD
- REDIS_PASSWORD
- CORS_ORIGINS

Nunca grave valores reais no Git.

## 3. Subir infraestrutura
~~~bash
docker compose -f docker-compose.staging.yml up -d --build
~~~

## 4. Aplicar banco
Aplique primeiro:
~~~bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/20260922_zero_trust_kernel.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/20260922_staging_hardening.sql
~~~

O runtime deve usar o usuário vertice_app, nunca o proprietário/superusuário do banco.

## 5. Provisionar conectores
Para cada tenant:
~~~bash
cd server
STAGING_TENANT_ID="<tenant>" STAGING_USER_ID="<owner>" STAGING_CONNECTOR_TOKEN="<token>" npm run provision:connector -- github
STAGING_TENANT_ID="<tenant>" STAGING_USER_ID="<owner>" STAGING_CONNECTOR_TOKEN="<token>" npm run provision:connector -- vercel
STAGING_TENANT_ID="<tenant>" STAGING_USER_ID="<owner>" STAGING_CONNECTOR_TOKEN="<token>" npm run provision:connector -- mercado_pago
~~~
Os tokens são cifrados com AES-256-GCM antes de serem persistidos.

## 6. Validação do backend
~~~bash
cd server
npm install
npm run check
npm run typecheck
npm run test:concurrency
~~~

## 7. Isolamento
Defina STAGING_TOKEN_A, STAGING_FOREIGN_COMMAND_ID, STAGING_FOREIGN_DEVICE_ID e:
~~~bash
STAGING_BASE_URL="https://<staging>" npm run test:rls:http
~~~
Resultado obrigatório: HTTP 403 com código TENANT_ISOLATION.

Também execute:
~~~bash
psql "$DATABASE_URL" -v TENANT_A_USER="'<user-a>'" -v TENANT_A_ID="'<tenant-a>'" -v TENANT_B_ID="'<tenant-b>'" -f server/tests/rls-isolation.sql
~~~

## 8. MFA
1. Autentique-se.
2. POST /api/v1/mfa/enroll.
3. Configure o segredo no Authenticator.
4. POST /api/v1/mfa/verify com o código para ativar MFA.
5. Crie uma ação operation=execute, resource=command, payload.mode=operacao.
6. Confirme status=awaiting_mfa.
7. Envie o taskId em /api/v1/mfa/verify.
8. Confirme transição para queued e execução pelo worker.

## 9. Approval gate
1. Crie uma ação classificada como approval.
2. Confirme awaiting_approval.
3. OWNER/ADMIN chama POST /api/v1/execution/:actionId/approve.
4. Confirme publicação no outbox e execução pelo worker.

## 10. Conectores
Teste uma ação por provedor:
- GitHub: criação de repositório, commit de arquivo, PR e webhook.
- Vercel: deployment, status e domínio.
- Mercado Pago: Pix/preference, consulta e reconciliação.
Cada mutação deve usar uma Idempotency-Key única e repetição da mesma chave não pode produzir segundo efeito.

## 11. Webhooks
Envie o mesmo evento duas vezes. A primeira entrega deve processar; a segunda deve retornar deduplicated=true e não alterar novamente o pagamento.

## 12. Sandbox
O host de staging deve ter Docker disponível para o worker/sandbox. O executor aplica:
- rede none
- filesystem somente leitura
- /tmp efêmero
- CPU limitada
- RAM limitada
- pids limit
- capabilities removidas
- no-new-privileges
- timeout de 30s

## 13. CI/CD
O workflow .github/workflows/security-staging.yml executa:
- typecheck
- checks
- npm audit
- Trivy
- Gitleaks
- CodeQL
- teste de concorrência

O deploy deve ser bloqueado quando qualquer gate crítico falhar.

## 14. Critério de entrada em staging
Só considerar o ambiente pronto quando:
- migrações aplicadas sem erro;
- backend e worker saudáveis;
- RLS cross-tenant comprovadamente bloqueando;
- MFA e approval funcionando;
- três conectores testados;
- webhooks deduplicados;
- idempotência concorrente validada;
- sandbox executando e bloqueando rede;
- CI verde;
- nenhum segredo real no repositório;
- logs não exibirem tokens.
