# VÉRTICE Server 1.1

Backend Node/Express do VÉRTICE com autenticação, isolamento por cliente, dispositivos, comandos, vendas e integração com Mercado Pago Orders.

## Variáveis de ambiente

Configure no servidor (por exemplo, Render):

- `PORT`
- `DB_PATH`
- `JWT_SECRET`
- `OWNER_LOGIN`
- `OWNER_PASSWORD`
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `APP_PUBLIC_URL`

Nunca coloque Access Token, senha ou segredo de webhook no GitHub ou no APK.

## Endpoints principais

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `POST /devices/register`
- `POST /commands`
- `GET /commands`
- `POST /sales/orders`
- `GET /sales`
- `POST /sales/orders/:saleId/sync`
- `POST /webhooks/mercadopago`
- `GET /reports/monthly`
- `GET /ranking`
- `GET /admin/overview`
- `GET /admin/customers`

## Render

Root Directory: `server`

Build Command: `npm install`

Start Command: `node src/server.js`

Use HTTPS em produção.
