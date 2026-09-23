# STAGING_CERTIFICATION_REPORT.md

## VÉRTICE — Certificação dinâmica de Staging / Zero-Trust Kernel v2

- **Branch:** `feat/zero-trust-kernel-v2`
- **Repositório:** `objetivoemandamento/Vertice`
- **Data da certificação:** 2026-09-22 (logs UTC alcançam 2026-09-23)
- **Workflow:** `vertice-security-staging`
- **Run final:** **#225** — ID `35805891128`
- **SHA certificado:** `274a8f874a8a98976994d70463a3b211001fa74f`
- **Parecer:** **🟢 GO PARA PRODUÇÃO**

> Este parecer é baseado no run final acima, no SHA exato certificado. Não foi marcado PASS nenhum estágio que não tenha sido executado pelo GitHub Actions.

## 1. Resultado executivo

| Gate | Resultado | Evidência runtime |
|---|---|---|
| `npm install` | **PASS** | Run #225 — concluído |
| `npm run check` | **PASS** | Run #225 — exit 0 |
| `npm run typecheck` | **PASS** | Run #225 — exit 0 |
| Docker Compose / PostgreSQL / Redis | **PASS** | Run #225 — staging iniciado, serviços healthy |
| Migrações base + Zero-Trust + hardening | **PASS** | Run #225 — etapa concluída |
| Role `vertice_app` / RLS | **PASS** | Run #225 — teste SQL cross-tenant concluído |
| Concorrência / idempotência | **PASS** | Run #225 — 32 contenders, 1 lease; duplicate idempotency sem novo insert |
| Restart backend/worker | **PASS** | Run #225 — etapa concluída |
| MFA / isolamento HTTP cross-tenant | **PASS** | Run #225 — etapa concluída |
| Sandbox Docker | **PASS** | Run #225 — suíte concluída |
| `npm audit --audit-level=high` | **PASS** | Run #225 — exit 0 |
| Trivy HIGH/CRITICAL | **PASS** | Run #225 — exit 0 |
| Gitleaks | **PASS** | Run #225 — exit 0 |
| CodeQL | **PASS** | Run #225 — success |
| Teardown staging | **PASS** | Run #225 — concluído |

## 2. Evolução dos bloqueios e correções

### Run #119 — tipagem

O run #119 revelou falhas reais de TypeScript, incluindo:

- ausência de declaração para `../db`;
- imports relativos incompatíveis com NodeNext;
- parâmetro implicitamente `any`;
- união de status incompleta em `enqueueExecution`.

Correções aplicadas:

- `server/src/db.d.ts`;
- normalização dos imports para `.js`;
- tipagem explícita do gateway;
- inclusão de `awaiting_approval` no contrato da fila;
- validação adicional no publisher/outbox/worker.

Resultado posterior: `npm run check` e `npm run typecheck` passaram no run final.

### Staging / startup

Foram encontrados e corrigidos, por evidência runtime:

1. backend encerrando por ausência de `OWNER_LOGIN/OWNER_PASSWORD` em runtime production;
2. worker iniciando antes das migrações e tentando acessar `outbox_events`;
3. PostgreSQL/TLS local incompatível com a configuração de staging;
4. inicialização Redis/rate limiter;
5. validação IPv6 do `express-rate-limit`.

Correções principais:

- migração executada antes do startup do backend/worker;
- credenciais de bootstrap de owner explicitamente fornecidas somente no ambiente efêmero de staging;
- `DB_SSL_MODE` explícito;
- Redis API com fila offline habilitada durante bootstrap;
- `ipKeyGenerator(req.ip)` no rate limiter;
- staging com portas efêmeras expostas para os testes host-side.

### SQL / RLS

A homologação encontrou delimitadores PL/pgSQL inconsistentes nas migrações. Eles foram corrigidos e o run final confirmou:

- migrações aplicadas;
- `vertice_app` utilizado;
- RLS cross-tenant aprovado;
- zero exposição de linhas do tenant B ao contexto do tenant A.

O teste final registrou:

```
PASS RLS: tenant A cannot see tenant B rows
```

### Concorrência / idempotência

O teste inicialmente falhou porque o próprio teste de concorrência não estabelecia o contexto de tenant exigido pelo RLS.

Foi corrigido para executar cada operação dentro de transação com:

- `app.tenant_id`;
- `app.user_id`;
- role de aplicação;
- lease atômico;
- mesma `idempotency_key`.

Resultado do run final:

```
PASS concurrency/idempotency: 32 contenders -> 1 lease; duplicate idempotency -> 0 inserts
```

### Sandbox

O primeiro teste assumia um exit code específico para o bloqueio de rede e depois assumia `timedOut=true` para CPU. O runtime demonstrou que o mecanismo pode retornar por enforcement do Docker em vez de pelo timer JavaScript.

O teste foi endurecido para validar a propriedade de segurança observável:

- rede externa não produz execução bem-sucedida;
- filesystem host não é gravável;
- execução CPU-bound termina de forma não bem-sucedida e dentro de janela limitada.

Também foi corrigido o timeout do sandbox para matar o grupo de processos Docker, reduzindo risco de processo órfão.

Resultado final: **PASS**.

### Gitleaks

O Gitleaks inicialmente falhou não por encontrar segredo, mas porque o checkout não continha o objeto base necessário ao range do PR:

```
fatal: ambiguous argument ... unknown revision
```

A correção final foi:

- checkout com `fetch-depth: 0`;
- migração de `gitleaks-action@v2` para `@v3`.

O run #225 concluiu a etapa Gitleaks com **success**.

## 3. Evidência do pipeline final

### Run #225 — `35805891128`

Job `server-security`:

- Set up job — success
- checkout — success
- setup-node — success
- npm install — success
- check — success
- typecheck — success
- Start staging — success
- migrations — success
- isolated tenant seed — success
- RLS SQL isolation — success
- concurrency/idempotency — success
- backend/worker restart — success
- MFA + HTTP tenant isolation — success
- sandbox — success
- npm audit — success
- Trivy — success
- Gitleaks — success
- evidence collection — success
- teardown — success

Job `codeql`:

- init — success
- analyze — success
- cleanup — success

Conclusão do workflow:

```
Run #225 — success
```

## 4. Segurança multi-tenant

A certificação dinâmica validou o fluxo sob o papel de aplicação `vertice_app`, não apenas por inspeção estática.

A matriz comprovada inclui:

- contexto de tenant/usuário;
- RLS;
- isolamento de leitura cross-tenant;
- isolamento HTTP;
- ownership de comandos;
- constraints de `tenant_id`;
- lease atômico;
- idempotência por tenant.

## 5. Governança de ações de alto risco

O fluxo final de staging executou uma ação de pagamento de risco elevado e verificou a retenção em MFA antes da execução.

Também foi exercitado o isolamento de comando HTTP entre tenants.

Isso comprova runtime do gate de governança usado pela branch certificada, sem conceder autonomia irrestrita ao modelo de IA.

## 6. Sandbox

A execução dinâmica confirmou os controles configurados no container:

- `--network none`;
- filesystem do container read-only;
- volume de trabalho somente leitura;
- limite de memória;
- limite de CPU;
- `--pids-limit`;
- `--cap-drop ALL`;
- `no-new-privileges`;
- `tmpfs` restrito para `/tmp`;
- encerramento de processos Docker no timeout.

Resultado final: **PASS**.

## 7. Dependências e análise estática

O run final aprovou:

- TypeScript;
- CodeQL;
- npm audit com nível HIGH;
- Trivy HIGH/CRITICAL;
- Gitleaks.

Nenhum destes gates bloqueou o run #225.

## 8. Integridade da certificação

O certificado está vinculado ao SHA:

```
274a8f874a8a98976994d70463a3b211001fa74f
```

O parecer não deve ser transferido automaticamente para outro SHA sem nova execução do pipeline.

## 9. Parecer final

Todos os gates definidos no protocolo de homologação foram executados no GitHub Actions e concluídos com sucesso no run #225.

# 🟢 GO PARA PRODUÇÃO

**Condição de integridade:** promover somente o SHA certificado ou um novo SHA submetido novamente ao mesmo conjunto de gates.
