# 02 — Cérebro Central

## Candidatos
- GLM-5.x: candidato a cérebro open-weight de alta capacidade.
- Qwen: família geral e multimodal para operação.
- DeepSeek: raciocínio e análise.
- Kimi: tarefas agentic e multimodais.

## Arquitetura
O CEO AI não deve falar diretamente com todos os serviços. Ele chama um Model Gateway e um Agent Router.

## Responsabilidades
1. interpretar objetivos;
2. consultar memória;
3. decompor problemas;
4. escolher especialistas;
5. avaliar resultados;
6. solicitar crítica;
7. decidir próximos passos;
8. registrar a decisão.

## Regra de substituição
O restante do sistema deve depender de uma interface abstrata de modelo. Trocar GLM por Qwen, DeepSeek ou outro modelo não deve exigir reescrita do domínio empresarial.
