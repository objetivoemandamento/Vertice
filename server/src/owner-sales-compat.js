const express = require('express');

// Compatibility layer: the owner account uses the same sales API as the
// commercial account. Only /sales endpoints receive the temporary role
// mapping, leaving admin/security routes unchanged.
const salesPaths = ['/sales', '/sales/orders', '/sales/orders/'];

function isSalesPath(path) {
  return salesPaths.some((prefix) => path === prefix || path.startsWith(prefix));
}

for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = express.application[method];
  if (!original || original.__verticePatched) continue;

  const patched = function (path, ...handlers) {
    if (typeof path === 'string' && isSalesPath(path) && handlers.length > 0) {
      const ownerBridge = (req, res, next) => {
        if (req.user?.role === 'OWNER') req.user.role = 'CUSTOMER';
        next();
      };
      // auth is the first handler in the current sales routes. Put the bridge
      // immediately after it so req.user already exists.
      handlers = [handlers[0], ownerBridge, ...handlers.slice(1)];
    }
    return original.call(this, path, ...handlers);
  };
  patched.__verticePatched = true;
  express.application[method] = patched;
}
