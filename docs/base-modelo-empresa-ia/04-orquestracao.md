# 04 — Orquestração

## Referência principal
LangGraph.

## Função
A orquestração transforma agentes independentes em workflows controláveis e persistentes.

## Conceito
CEO → Router → Specialist → Tool → Validator → Specialist/Reviewer → CEO.

## Estados
Cada execução deve possuir:
- objetivo;
- contexto;
- plano;
- tarefas;
- estado;
- resultados;
- erros;
- decisões;
- auditoria.

## Alternativas
VoltAgent, Pydantic AI, Google ADK, CrewAI e outros frameworks podem ser avaliados sem alterar o domínio do VÉRTICE.
