const express = require('express');
const crypto = require('crypto');
const {
  authorizationUrl, exchangeCode, refreshAccessToken, apiRequest, encryptToken, decryptToken
} = require('../integrations/mercadolivre');

function createMercadoLivreRouter({ auth, jwt, jwtSecret, query, runWithTenantContext }) {
  const router = express.Router();

  function stateToken(user) {
    return jwt.sign({
      purpose: 'mercadolivre-oauth',
      sub: String(user.sub),
      tenant_id: String(user.tenant_id),
      nonce: crypto.randomUUID()
    }, jwtSecret, { expiresIn: '10m', issuer: 'vertice', audience: 'mercadolivre-oauth' });
  }

  async function saveTokens(context, tokenData, sellerId) {
    const expiresAt = new Date(Date.now() + Math.max(60, Number(tokenData.expires_in || 3600)) * 1000);
    return runWithTenantContext(context, () => query(
      `insert into marketplace_connections
        (tenant_id, user_id, provider, external_user_id, access_token_enc, refresh_token_enc, expires_at, scopes, updated_at)
       values ($1,$2,'mercado_livre',$3,$4,$5,$6,$7,now())
       on conflict (tenant_id, user_id, provider) do update set
        external_user_id=excluded.external_user_id,
        access_token_enc=excluded.access_token_enc,
        refresh_token_enc=excluded.refresh_token_enc,
        expires_at=excluded.expires_at,
        scopes=excluded.scopes,
        updated_at=now()`,
      [context.tenantId, context.userId, String(sellerId), encryptToken(tokenData.access_token),
       encryptToken(tokenData.refresh_token), expiresAt, String(tokenData.scope || '')]
    ));
  }

  async function connection(context) {
    const result = await runWithTenantContext(context, () => query(
      `select external_user_id, access_token_enc, refresh_token_enc, expires_at
       from marketplace_connections where tenant_id=$1 and user_id=$2 and provider='mercado_livre' limit 1`,
      [context.tenantId, context.userId]
    ));
    const row = result.rows[0];
    if (!row) throw Object.assign(new Error('Conecte sua conta do Mercado Livre primeiro.'), { status: 409 });
    let accessToken = decryptToken(row.access_token_enc);
    if (new Date(row.expires_at).getTime() < Date.now() + 60000) {
      const renewed = await refreshAccessToken(decryptToken(row.refresh_token_enc));
      const tokenData = {
        ...renewed,
        refresh_token: renewed.refresh_token || decryptToken(row.refresh_token_enc)
      };
      await saveTokens(context, tokenData, row.external_user_id);
      accessToken = tokenData.access_token;
    }
    return { accessToken, sellerId: String(row.external_user_id) };
  }

  async function callForUser(req, path) {
    const ctx = { tenantId: String(req.user.tenant_id), userId: String(req.user.sub), role: String(req.user.role || 'CUSTOMER'), requestId: crypto.randomUUID() };
    const linked = await connection(ctx);
    try {
      return await apiRequest(path, linked.accessToken);
    } catch (error) {
      if (error.status !== 401) throw error;
      const refreshed = await refreshAccessToken(decryptToken((await runWithTenantContext(ctx, () => query(
        `select refresh_token_enc from marketplace_connections where tenant_id=$1 and user_id=$2 and provider='mercado_livre' limit 1`,
        [ctx.tenantId, ctx.userId]
      ))).rows[0].refresh_token_enc));
      const tokenData = { ...refreshed, refresh_token: refreshed.refresh_token || decryptToken((await runWithTenantContext(ctx, () => query(
        `select refresh_token_enc from marketplace_connections where tenant_id=$1 and user_id=$2 and provider='mercado_livre' limit 1`,
        [ctx.tenantId, ctx.userId]
      ))).rows[0].refresh_token_enc) };
      await saveTokens(ctx, tokenData, linked.sellerId);
      return apiRequest(path, tokenData.access_token);
    }
  }

  router.get('/connect', auth, (req, res) => {
    try { return res.redirect(302, authorizationUrl(stateToken(req.user))); }
    catch (error) { return res.status(error.status || 503).json({ error: 'Integração do Mercado Livre não configurada.' }); }
  });

  router.get('/callback', async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state || req.query.error) return res.status(400).json({ error: 'Autorização do Mercado Livre cancelada ou inválida.' });
    let payload;
    try {
      payload = jwt.verify(state, jwtSecret, { issuer: 'vertice', audience: 'mercadolivre-oauth' });
      if (payload.purpose !== 'mercadolivre-oauth' || !payload.sub || !payload.tenant_id) throw new Error('invalid state');
    } catch { return res.status(400).json({ error: 'Estado OAuth inválido ou expirado.' }); }
    try {
      const tokens = await exchangeCode(code);
      const me = await apiRequest('/users/me', tokens.access_token);
      const context = { tenantId: String(payload.tenant_id), userId: String(payload.sub), role: 'CUSTOMER', requestId: crypto.randomUUID() };
      await saveTokens(context, tokens, me.id);
      const returnUrl = String(process.env.MERCADOLIVRE_SUCCESS_URL || '');
      if (returnUrl) return res.redirect(303, returnUrl);
      return res.status(200).json({ ok: true, connected: true, provider: 'mercado_livre', sellerId: String(me.id), nickname: String(me.nickname || '') });
    } catch (error) {
      return res.status(error.status || 502).json({ error: 'Não foi possível concluir a conexão com o Mercado Livre.' });
    }
  });

  router.get('/status', auth, async (req, res) => {
    try {
      const ctx = { tenantId: String(req.user.tenant_id), userId: String(req.user.sub), role: String(req.user.role || 'CUSTOMER'), requestId: crypto.randomUUID() };
      const result = await runWithTenantContext(ctx, () => query(
        `select external_user_id, expires_at, updated_at from marketplace_connections
         where tenant_id=$1 and user_id=$2 and provider='mercado_livre' limit 1`,
        [ctx.tenantId, ctx.userId]
      ));
      const row = result.rows[0];
      return res.json({ connected: Boolean(row), sellerId: row?.external_user_id || null, expiresAt: row?.expires_at || null, updatedAt: row?.updated_at || null });
    } catch { return res.status(500).json({ error: 'Não foi possível consultar a conexão.' }); }
  });

  router.get('/me', auth, async (req, res) => {
    try { return res.json(await callForUser(req, '/users/me')); }
    catch (error) { return res.status(error.status || 502).json({ error: error.status === 409 ? error.message : 'Falha ao consultar a conta do Mercado Livre.' }); }
  });

  router.get('/items', auth, async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    try {
      const ctx = { tenantId: String(req.user.tenant_id), userId: String(req.user.sub), role: String(req.user.role || 'CUSTOMER'), requestId: crypto.randomUUID() };
      const linked = await connection(ctx);
      return res.json(await apiRequest(`/users/${encodeURIComponent(linked.sellerId)}/items/search?limit=${limit}&offset=${offset}`, linked.accessToken));
    } catch (error) { return res.status(error.status || 502).json({ error: error.status === 409 ? error.message : 'Falha ao consultar anúncios.' }); }
  });

  router.post('/items', auth, async (req, res) => {
    const title = String(req.body?.title || '').trim();
    const categoryId = String(req.body?.categoryId || '').trim();
    const currencyId = String(req.body?.currencyId || 'BRL').trim().toUpperCase();
    const condition = String(req.body?.condition || 'new').trim().toLowerCase();
    const listingTypeId = String(req.body?.listingTypeId || 'gold_special').trim();
    const price = Number(req.body?.price);
    const availableQuantity = Number(req.body?.availableQuantity);
    const pictures = Array.isArray(req.body?.pictures) ? req.body.pictures : [];
    if (title.length < 10 || title.length > 60 || !categoryId ||
        !Number.isFinite(price) || price <= 0 ||
        !Number.isInteger(availableQuantity) || availableQuantity < 1 ||
        !['new', 'used'].includes(condition) ||
        pictures.length < 1 || pictures.length > 10 ||
        pictures.some(p => !p || typeof p.source !== 'string' || !/^https:\/\//i.test(p.source))) {
      return res.status(400).json({ error: 'Informe título (10–60 caracteres), categoria, preço, estoque, condição e de 1 a 10 imagens HTTPS.' });
    }
    try {
      const ctx = { tenantId: String(req.user.tenant_id), userId: String(req.user.sub), role: String(req.user.role || 'CUSTOMER'), requestId: crypto.randomUUID() };
      const linked = await connection(ctx);
      const payload = {
        title, category_id: categoryId, price, currency_id: currencyId,
        available_quantity: availableQuantity, buying_mode: 'buy_it_now',
        listing_type_id: listingTypeId, condition, pictures,
        status: 'paused',
        ...(Array.isArray(req.body?.attributes) ? { attributes: req.body.attributes } : {}),
        ...(Array.isArray(req.body?.saleTerms) ? { sale_terms: req.body.saleTerms } : {})
      };
      const created = await apiRequest('/items', linked.accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.status(201).json({ ok: true, item: created, note: 'Anúncio criado pausado para revisão antes da publicação.' });
    } catch (error) {
      return res.status(error.status || 502).json({ error: error.status === 409 ? error.message : 'Não foi possível criar o anúncio. Confira categoria, atributos obrigatórios e permissões da conta.' });
    }
  });

  router.get('/orders', auth, async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    try {
      const ctx = { tenantId: String(req.user.tenant_id), userId: String(req.user.sub), role: String(req.user.role || 'CUSTOMER'), requestId: crypto.randomUUID() };
      const linked = await connection(ctx);
      const from = String(req.query.from || '');
      const to = String(req.query.to || '');
      const dateFilters = (from && to) ? `&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}` : '';
      return res.json(await apiRequest(`/orders/search?seller=${encodeURIComponent(linked.sellerId)}&sort=date_desc&limit=${limit}&offset=${offset}${dateFilters}`, linked.accessToken));
    } catch (error) { return res.status(error.status || 502).json({ error: error.status === 409 ? error.message : 'Falha ao consultar pedidos.' }); }
  });

  return router;
}

module.exports = { createMercadoLivreRouter };
