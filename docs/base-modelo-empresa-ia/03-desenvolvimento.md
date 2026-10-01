# 03 — Fábrica de Software

## Componentes de referência
- Qwen3-Coder: modelo especializado em código.
- OpenHands: agente de desenvolvimento que interage com repositórios e ambientes.
- Cline: alternativa para desenvolvimento assistido.
- Devstral: candidato adicional para coding agent local.

## Pipeline
Requisito → Product AI → Architect AI → Coding Agent → QA Agent → Security Agent → CI → Deploy → Observability.

## Regras
- toda alteração relevante gera diff;
- testes são executados antes do deploy;
- produção exige política de permissão;
- o agente deve trabalhar em branch/ambiente isolado;
- rollback deve ser possível.

## Objetivo
O VÉRTICE deve conseguir construir partes do próprio software sem tornar o código dependente de um modelo específico.
