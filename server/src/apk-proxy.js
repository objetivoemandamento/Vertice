const express = require('express');

const APK_URL = process.env.VERTICE_APK_URL || 'https://github.com/objetivoemandamento/Vertice/releases/latest/download/app-release.apk';
const originalListen = express.application.listen;

express.application.listen = function (...args) {
  if (!this._verticeApkRouteInstalled) {
    this._verticeApkRouteInstalled = true;
    this.get('/app-release.apk', async (req, res) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const upstream = await fetch(APK_URL, { signal: controller.signal, headers: { 'User-Agent': 'VERTICE-APK-Proxy/2.0' }, redirect: 'follow' });
        if (!upstream.ok || !upstream.body) return res.status(502).json({ error: 'APK indisponível no momento.' });
        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        if (upstream.headers.get('content-length')) res.setHeader('Content-Length', upstream.headers.get('content-length'));
        if (upstream.headers.get('etag')) res.setHeader('ETag', upstream.headers.get('etag'));
        if (upstream.headers.get('last-modified')) res.setHeader('Last-Modified', upstream.headers.get('last-modified'));
        if (typeof upstream.body.pipe === 'function') upstream.body.pipe(res);
        else for await (const chunk of upstream.body) res.write(chunk);
        res.end();
      } catch (e) {
        if (!res.headersSent) res.status(502).json({ error: e.name === 'AbortError' ? 'Download do APK excedeu o tempo limite.' : 'APK indisponível.' });
      } finally { clearTimeout(timer); }
    });
  }
  return originalListen.apply(this, args);
};
