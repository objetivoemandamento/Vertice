# VÉRTICE — Padrão de Engenharia 90%+

## Objetivo

Estabelecer 90% como piso mínimo de aceitação técnica para cada camada do VÉRTICE. Percentuais são classificados como **estimativa**, **teste automatizado**, **teste de integração** ou **teste de dispositivo**. Uma estimativa nunca substitui evidência.

## Regra de aprovação

Uma área só pode ser marcada como `PASS >= 90` quando:

1. os requisitos críticos da área estiverem implementados;
2. os cenários críticos tiverem teste correspondente;
3. falhas conhecidas estiverem classificadas;
4. não houver vulnerabilidade crítica ou caminho de execução que contorne o controle;
5. o percentual for calculado por evidência, e não por impressão subjetiva.

## Modelo de pontuação

Para cada área:

`score = (controles_passados / controles_avaliados) * 100`

Controles críticos têm peso 2; controles normais têm peso 1.

`weighted_score = soma(peso * passou) / soma(peso) * 100`

Um único controle crítico de segurança, integridade de execução ou parada de emergência que falhe pode bloquear a aprovação da área mesmo que a média matemática seja >=90.

## Camadas e critérios

### 1. Arquitetura
- separação entre decisão, planejamento, execução e observação;
- contratos claros entre Android e backend;
- estados explícitos;
- recuperação após reinício;
- nenhuma dependência circular crítica.

### 2. Backend/API
- autenticação e autorização em cada endpoint protegido;
- validação de entrada;
- limites de payload;
- respostas determinísticas;
- timeouts de integrações externas;
- tratamento de erro sem vazamento de segredo.

### 3. Autenticação e autorização
- segredo de produção obrigatório;
- credenciais de proprietário exclusivamente por ambiente seguro;
- JWT assinado;
- validação de `iss`, `aud`, `exp` e `nbf`;
- `jti`/revogação para sessões terminadas quando aplicável;
- autorização por recurso, usuário, dispositivo e operação.

### 4. Fila e execução
- `command_id` estável;
- `execution_id` por tentativa;
- lease com expiração explícita;
- heartbeat;
- tentativa numerada;
- idempotência;
- estado `unknown` quando a confirmação é perdida;
- nenhuma reexecução automática baseada apenas em tempo decorrido.

### 5. Android Accessibility
- serviço ativado explicitamente pelo usuário;
- capability correta declarada;
- comandos interrompíveis;
- estado de emergência consultado antes e durante a execução;
- callback de gesto tratado;
- resultado técnico separado de resultado verificado.

### 6. Detecção de elementos

A seleção de alvo deve priorizar:

1. resource ID;
2. accessibility/content description;
3. texto exato;
4. texto normalizado;
5. hierarquia/contexto;
6. posição como último recurso.

Alvos ambíguos devem resultar em `UNKNOWN`/falha segura, e não em clique arbitrário.

### 7. Verificação pós-ação

Toda ação operacional deve seguir:

`precondition -> action -> technical result -> observe -> expected state -> verified result`

Estados permitidos:

- `SUCCESS`
- `FAILED`
- `CANCELLED`
- `UNKNOWN`

`dispatchGesture()` sem confirmação posterior não é considerado sucesso de negócio.

### 8. Emergency Stop

- estado persistente;
- geração/versionamento do estado;
- bloqueio de novos comandos;
- interrupção de planos em andamento;
- nenhuma função de IA pode reativar o sistema;
- reativação somente por ação explícita autorizada do usuário.

### 9. IA e planejamento

Fluxo obrigatório para operação:

`natural language -> intent -> structured plan -> risk classification -> preconditions -> action -> observation -> verification -> next step`

A IA não deve ser a única camada que decide se uma ação sensível pode ocorrer.

### 10. Risco

- R0: observação;
- R1: ação reversível;
- R2: ação sensível;
- R3: ação destrutiva/financeira/irreversível.

R2/R3 exigem política de confirmação apropriada ao contexto. A classificação deve ser explícita no plano.

### 11. Persistência

O estado crítico do sistema não deve depender de filesystem efêmero de hospedagem. A estratégia alvo é banco relacional gerenciado para dados transacionais, com migração controlada e backup/restore testado.

### 12. Segurança

Controles mínimos:

- HTTPS;
- CORS restrito;
- headers seguros;
- rate limiting distribuível;
- proteção contra replay quando aplicável;
- secrets fora do código;
- logs sem tokens/senhas;
- autorização server-side;
- validação de transições de estado.

### 13. Observabilidade

Cada execução deve permitir reconstruir:

`command_id, execution_id, device_id, step, action, target, started_at, finished_at, technical_result, verification_result, error_code`

### 14. Testes

Matriz mínima:

- unidade;
- integração API;
- concorrência da fila;
- autenticação/autorização;
- idempotência;
- perda de rede;
- backend indisponível;
- processo Android encerrado;
- tela inesperada;
- alvo ausente;
- emergência durante plano;
- duplicação de comando;
- retomada após reinício.

### 15. Compatibilidade Android

A compatibilidade só pode receber score >=90 quando houver evidência real em uma matriz de versões/fabricantes. Compatibilidade estimada não é aprovação.

### 16. CI/CD

Todo merge/deploy deve bloquear quando houver:

- sintaxe inválida;
- teste crítico quebrado;
- vulnerabilidade crítica conhecida;
- artefato Android não verificável;
- regressão em contratos de API;
- quality gate <90 em área crítica.

## Estados globais

- `GREEN`: >=90 e nenhum bloqueador crítico.
- `YELLOW`: 80–89,99 ou evidência insuficiente.
- `RED`: <80 ou qualquer bloqueador crítico.

## Política de honestidade da métrica

Não aumentar o percentual manualmente para atingir a meta. Quando uma área ainda não tem testes suficientes, ela permanece `YELLOW` mesmo que a implementação pareça robusta.

## Pesquisa técnica de referência

A implementação deve permanecer alinhada à documentação oficial do Android para `AccessibilityService`, às regras vigentes do Google Play para Accessibility API, às recomendações OWASP para REST/JWT e às características de persistência do ambiente de hospedagem escolhido.
