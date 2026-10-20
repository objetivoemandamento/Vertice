# Mercado Livre no VÉRTICE

Esta integração é adicionada como módulo independente, sem substituir o login, o aplicativo Android, a fila de execução ou os checkouts existentes de Mercado Pago e Stripe.

## Configuração

1. Crie uma aplicação no painel de desenvolvedores do Mercado Livre.
2. Cadastre como redirect URI exatamente: `https://SEU-BACKEND/integrations/mercadolivre/callback`.
3. Configure no Render:
   - `MERCADOLIVRE_CLIENT_ID`
   - `MERCADOLIVRE_CLIENT_SECRET`
   - `MERCADOLIVRE_REDIRECT_URI`
   - `MERCADOLIVRE_TOKEN_ENCRYPTION_KEY`
4. Gere uma chave AES de 32 bytes e armazene-a em Base64. Exemplo local: `openssl rand -base64 32`. Não coloque a chave nem os tokens no GitHub.
5. Aplique `server/migrations/20261020_marketplace_connections.sql` no PostgreSQL antes de habilitar a integração.
6. Faça o deploy do backend. O APK não precisa de rebuild para usar as novas rotas do servidor, desde que já aponte para esse backend.

## Rotas

Todas as rotas abaixo usam o prefixo `/integrations/mercadolivre`.

- `GET /connect` — autenticada; redireciona o usuário para autorizar a conta do Mercado Livre.
- `GET /callback` — callback OAuth; valida o estado assinado e armazena tokens criptografados.
- `GET /status` — autenticada; informa se a conta está conectada.
- `GET /me` — autenticada; consulta o perfil do vendedor.
- `GET /items?limit=20&offset=0` — autenticada; consulta anúncios do vendedor.
- `POST /items` — autenticada; cria anúncio **pausado**, exigindo título, categoria, preço, estoque, condição e imagens HTTPS.
- `GET /orders?limit=20&offset=0` — autenticada; consulta pedidos do vendedor.

## Segurança e limites atuais

- Tokens de acesso e refresh são cifrados com AES-256-GCM e a chave fica em variável de ambiente.
- A conexão é isolada por usuário e tenant no PostgreSQL.
- O OAuth usa estado assinado com expiração curta.
- Novos anúncios são criados pausados para revisão antes da publicação.
- A renovação do token ocorre quando necessário.
- A integração ainda não sincroniza pedidos por webhook, não publica/reativa anúncios automaticamente e não implementa geração automática de descrições por IA. Esses itens devem ser adicionados e testados antes de considerar o fluxo de vendas totalmente autônomo.
- O Mercado Livre e o Mercado Pago são produtos diferentes: esta integração cobre a conta do marketplace; os pagamentos já existentes no VÉRTICE permanecem intactos.

## Testes de implantação

1. Aplicar a migration no ambiente de teste.
2. Configurar as quatro variáveis OAuth/criptografia.
3. Conectar uma conta de teste e confirmar `GET /status`.
4. Confirmar perfil e anúncios.
5. Criar anúncio de teste e verificar que fica pausado.
6. Consultar pedidos e validar que a conta conectada é a mesma do usuário autenticado.
7. Testar renovação de token e revogação da autorização.
