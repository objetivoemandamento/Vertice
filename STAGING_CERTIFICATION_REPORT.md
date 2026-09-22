# STAGING_CERTIFICATION_REPORT.md

## VÉRTICE — Homologação dinâmica de Staging

- **Branch:** `feat/zero-trust-kernel-v2`
- **Repositório:** `objetivoemandamento/Vertice`
- **Data:** 2026-09-22
- **Escopo:** validação final do kernel Zero-Trust / multi-tenant / execução assíncrona / RLS / CI de segurança
- **Parecer atual:** **NO-GO PARA PRODUÇÃO**

> Este relatório contém apenas evidências realmente observadas. Nenhum teste foi marcado como PASS quando não houve execução real comprovável.

## 1. Resultado executivo

| Etapa | Resultado | Evidência |
|---|---|---|
| Typecheck / check | **BLOQUEADO** | O job `server-security` não chegou aos comandos por falha anterior no `setup-node`; portanto não há resultado runtime válido de `npm run check`/ `typecheck`. |
| Docker Build / Staging | **NÃO EXECUTADO** | Não houve execução Docker/PostgreSQL/Redis neste ambiente de validação. |
| Migrações PostgreSQL sob `vertice_app` | **NÃO EXECUTADO** | Não existe log runtime comprovando aplicação das migrações com papel não-owner. |
| Concorrência / idempotência | **NÃO EXECUTADO** | `npm run test:concurrency` foi configurado no workflow, mas a execução do job foi interrompida antes dessa etapa. |
| RLS / isolamento cross-tenant | **NÃO EXECUTADO** | Não há evidência runtime de HTTP 403/zero rows entre tenants nesta homologação. |
| CodeQL | **PASS** no run 116 e execução novamente iniciada no run 119 | O job CodeQL do run 116 concluiu success. O run mais recente estava em execução no momento deste relatório. |
| Trivy | **BLOQUEADO no run 116; corrigido no código do workflow** | O run 116 falhou porque `aquasecurity/trivy-action@0.28.0` não existia. A versão foi corrigida para `v0.36.0`, existente oficialmente. |
| Secrets/Gitleaks | **NÃO EXECUTADO** | O job anterior não alcançou a etapa. |
| Sandbox runtime | **NÃO EXECUTADO** | Não há logs de execução Docker do sandbox nesta homologação. |

## 2. Evidências reais

### 2.1 Run 116 — falha inicial do pipeline

Workflow: `vertice-security-staging`  
Run: `35730407283` / #116

Trecho real:

```text
2026-09-22T12:58:02.0606179Z ##[error]Unable to resolve action `aquasecurity/trivy-action@0.28.0`, unable to find version `0.28.0`
```

Consequência: o job `server-security` falhou durante a preparação das Actions e não executou as suítes de aplicação.

### 2.2 Correção aplicada

Foi atualizado `.github/workflows/security-staging.yml` de:

```yaml
aquasecurity/trivy-action@0.28.0
```

para:

```yaml
aquasecurity/trivy-action@v0.36.0
```

A existência da release `v0.36.0` foi confirmada na fonte oficial do projeto Trivy Action.

Também foi removida a configuração de cache que apontava para `server/package-lock.json`, pois esse arquivo não existe atualmente na branch.

Commit da correção do cache:

```
7f9d6c207359b08172ea9840d24bc84cb7cbbe50
```

### 2.3 Run 117 — Trivy resolvido, novo bloqueio encontrado

Run: `35731590051` / #117

O log confirmou que o Trivy agora é resolvido:

```text
Download action repository 'aquasecurity/trivy-action@v0.36.0' (SHA:ed142fd0673e97e23eac54620cfb913e5ce36c25)
```

O novo bloqueio ocorreu no `setup-node` por causa do caminho inexistente do lockfile:

```text
[error]Some specified paths were not resolved, unable to cache dependencies.
```

Esse problema foi corrigido no commit:

```
7f9d6c207359b08172ea9840d24bc84cb7cbbe50
```

### 2.4 Run 119 — execução do workflow após a segunda correção

Run: `35731695150` / #119

No momento da emissão deste relatório, o run estava **queued**. Portanto não existe ainda evidência legítima para declarar `check`, `typecheck`, `concurrency`, `audit`, `Trivy` ou `Gitleaks` como PASS.

## 3. Evidência de sanitização de logs

Os logs disponibilizados pelo GitHub Actions mascararam o token de execução:

```text
token: ***
AUTHORIZATION: basic ***
```

Isso demonstra sanitização pelo próprio runner do GitHub Actions para esses valores. **Não constitui, isoladamente, prova de que toda a aplicação VÉRTICE nunca registrará tokens ou segredos em runtime.**

Não houve evidência observada, nesta execução, de chave AES-256-GCM ou credencial de connector impressa em claro.

## 4. MFA / ações de alto risco

O código da branch contém a infraestrutura de MFA e o fluxo de governança para ações de risco.

Entretanto, nesta homologação não foi obtido log runtime demonstrando:

1. ação RED sendo criada;
2. estado `AWAITING_MFA`;
3. envio de TOTP válido;
4. transição posterior autorizada;
5. rejeição de TOTP inválido;
6. auditoria correspondente.

**Resultado: NÃO CERTIFICADO por runtime.**

## 5. RLS / isolamento multi-tenant

A branch contém migrações e políticas de RLS, incluindo o modelo `tenant_id` e funções de contexto.

A certificação exigida, porém, depende de execução real utilizando um papel PostgreSQL que:

- não seja owner;
- não possua `BYPASSRLS`;
- tenha permissões de aplicação;
- receba o contexto correto de tenant/usuário.

Não houve execução real dessa matriz nesta sessão.

**Resultado: NÃO CERTIFICADO por runtime.**

## 6. Concorrência / idempotência

A branch contém a implementação de fila/worker, lease atômico e chave de idempotência.

Não foi obtido resultado real do cenário:

```
N requisições paralelas
        ↓
mesma tenant_id
        ↓
mesma idempotency_key
        ↓
1 único efeito
```

**Resultado: NÃO CERTIFICADO por runtime.**

## 7. Sandbox

A implementação contém isolamento Docker e a correção recente para tradução do orçamento de CPU para quota Docker.

Não houve execução real dos cenários:

- OOM;
- acesso ao filesystem do host;
- rede externa;
- timeout;
- tentativa de escape do container.

**Resultado: NÃO CERTIFICADO por runtime.**

## 8. Docker / PostgreSQL / Redis

A infraestrutura de staging foi ajustada para:

- provisionar `APP_DB_PASSWORD`;
- utilizar o usuário de aplicação `vertice_app`;
- exigir verificação TLS no backend.

Entretanto, a combinação Docker/PostgreSQL/Redis não foi inicializada e validada end-to-end neste ciclo. Portanto não há base para declarar `docker compose up -d --build` como PASS.

## 9. Critério formal de homologação

O critério solicitado foi:

> GO PARA PRODUÇÃO somente se todos os testes passarem; qualquer falha não tratada resulta em NO-GO.

No estado observado:

- há workflow ainda em execução;
- não há evidência de execução completa das cinco etapas principais;
- não há evidência runtime de RLS;
- não há evidência runtime de concorrência;
- não há evidência runtime de MFA;
- não há evidência runtime do sandbox;
- não há evidência runtime do Docker staging completo.

### Parecer

# **NO-GO PARA PRODUÇÃO**

O NO-GO é técnico e provisório até que o pipeline atual conclua e as etapas de staging efetivamente executadas produzam evidência verde.

## 10. Critérios para liberar o GO

A branch somente deve ser homologada quando houver evidência verificável de:

- `npm run check` → exit 0;
- `npm run typecheck` → exit 0;
- Docker build/up → healthy;
- migrações → concluídas;
- PostgreSQL app role → não-owner / sem BYPASSRLS;
- RLS cross-tenant → 403 ou zero rows;
- concorrência → uma única efetivação;
- MFA RED → `AWAITING_MFA` e aprovação TOTP válida;
- payment capability → rejeição sem capability válida;
- sandbox → isolamento comprovado;
- npm audit → conforme política;
- Trivy → sem HIGH/CRITICAL bloqueante;
- Gitleaks → sem segredo;
- CodeQL → success;
- logs → sem segredo sensível;
- workflow final → success no SHA exato que será mesclado.

## 11. Observação de integridade da auditoria

Este documento deliberadamente não converte:

- código inspecionado em teste executado;
- workflow configurado em pipeline aprovado;
- existência de função SQL em RLS comprovado;
- existência de endpoint MFA em MFA comprovado;
- existência de sandbox em sandbox comprovado.

Essa distinção é obrigatória para uma certificação de produção confiável.
