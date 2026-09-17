const express = require('express');

const APK_URL = 'https://github.com/objetivoemandamento/Vertice/releases/download/android-114/app-release.apk';
const originalListen = express.application.listen;

express.application.listen = function (...args) {
  if (!this._verticeApkRouteInstalled) {
    this._verticeApkRouteInstalled = true;
    this.get('/app-release.apk', async (req, res) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const upstream = await fetch(APK_URL, {
          signal: controller.signal,
          headers: { 'User-Agent': 'VERTICE-APK-Proxy/1.0' }
        });
        if (!upstream.ok || !upstream.body) {
          return res.status(502).json({ error: 'APK indisponível no momento.' });
        }
        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment; filename="vertice-1.4.4.apk"');
        if (upstream.headers.get('content-length')) {
          res.setHeader('Content-Length', upstream.headers.get('content-length'));
        }
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (!res.headersSent) res.status(502).json({ error: 'Falha ao baixar o APK.', detail: error.name === 'AbortError' ? 'timeout' : 'upstream' });
        else res.destroy(error);
      } finally {
        clearTimeout(timeout);
      }
    });
  }
  return originalListen.apply(this, args);
};
