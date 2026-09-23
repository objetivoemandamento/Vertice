# VÉRTICE — Release Notes v1.5.0

**Status:** Release candidate para operação comercial  
**Data:** 23/09/2026  
**Versão:** 1.5.0  
**Build Android:** 172

## 1. Sumário executivo

A fase de desenvolvimento e implantação foi encerrada operacionalmente. O backend VÉRTICE está publicado no Render, o worker de execução está ativo, as migrações Zero-Trust foram aplicadas em produção e o pipeline Android produziu um APK Release assinado.

A certificação abaixo distingue evidências efetivamente observadas de itens que ainda dependem de operação externa manual.

## 2. Artefatos certificados

### Commits relevantes

- fd75a1cb7a3f17b5fee5a5dafa56b5cd18316bc8 — baseline certificado de segurança/staging.
- 3adf50f87c9c2da6db4084b114c7553559af851f — migração explícita em produção.
- 62fd100f8a433a4461c276713a27c2e2cdf54401 — correção do carregamento do worker.
- f8dfbd5bf67dca11e8ba9a3ecec929184629def6 — versão implantada no Render antes dos ajustes de pipeline.
- 94f6cf826b4f093a83eee37be83dc9fe53faeb45 — remoção do workflow temporário de carga.

O histórico posterior do main inclui os ajustes de pipeline realizados nesta consolidação.

## 3. Android

- Version name: 1.5.0
- Build: 172
- Artefato: app-release.apk
- SHA-256 observado no release publicado pelo CI:
  6a96d610f75b3a0feed144bbd8312a1c0a82315e0cce4c280b9869fd937ed5a4

A assinatura do APK foi verificada pelo apksigner no CI.

## 4. Produção Render

Backend: https://vertice-backend-8gj5.onrender.com

Estado observado:
- serviço Live;
- migração 20260922_zero_trust_kernel.sql aplicada;
- migração 20260922_staging_hardening.sql aplicada;
- ZERO_TRUST_PRODUCTION_READY registrado;
- worker de execução iniciado;
- nenhuma ocorrência ERROR/WARN encontrada no período final de auditoria consultado;
- PostgreSQL Render disponível;
- Redis configurado para produção.

## 5. Zero-Trust checklist

- [x] Tenant isolation / tenant_id.
- [x] PostgreSQL RLS habilitado nas entidades protegidas.
- [x] Policy Engine determinístico.
- [x] IA não possui autorização direta para executar ações externas.
- [x] ActionIntent estruturado e validado.
- [x] Approval/MFA para operações de maior risco.
- [x] Access token de curta duração.
- [x] Refresh-token persistence/reuse detection.
- [x] Redis-backed rate limiting.
- [x] CORS allowlist.
- [x] Webhook deduplication.
- [x] Idempotency keys.
- [x] BullMQ + worker lease.
- [x] Retry/backoff/circuit breaker.
- [x] Dead-letter state.
- [x] Outbox pattern.
- [x] Audit log protegido contra alteração/exclusão.
- [x] Connector Gateway com fail-closed.
- [x] Android session storage usando Android Keystore.
- [x] Release minification habilitada.
- [x] APK Release assinado e verificado.

## 6. Limitações de certificação

Não foram emitidas como aprovadas evidências que dependem de recursos externos indisponíveis nesta sessão:
- teste E2E em dispositivo/emulador Android real;
- teste direto de RLS no PostgreSQL de produção via conexão TLS externa;
- publicação no Google Play Console;
- publicação no Firebase App Distribution;
- criação efetiva do tag Git v1.0.0/v1.5.0.

Esses itens são procedimentos de operação/publicação e não devem ser confundidos com evidência inexistente.

## 7. Handover

O operador deve conservar este documento junto ao APK e registrar o SHA-256 do arquivo efetivamente enviado às lojas. Qualquer APK diferente deve receber nova verificação de hash e assinatura antes da distribuição.
