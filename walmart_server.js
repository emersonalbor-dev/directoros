/**
 * walmart_server.js — Servidor local para el dashboard DirectorOS
 *
 * Ejecutar UNA VEZ y dejar corriendo:
 *   node walmart_server.js
 *
 * Endpoints:
 *   GET /walmart  → ventas Walmart del mes actual
 *   GET /ml       → ventas MercadoLibre del mes actual
 *
 * El dashboard llama a estos endpoints cuando presionas "Actualizar".
 */

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT          = 3001;

// ── Walmart ────────────────────────────────────────────────────────────────────
const WM_CLIENT_ID     = '55467e1a-a201-466d-b07c-6b068608f1e4';
const WM_CLIENT_SECRET = 'TUkMmazS81XoKqTqVrMlc775xey-eZVtleZIsDUyg2Id4bUOlc-hlBPWf3ytyamusDIMgRPCzAeoQXCL3bk_Wg';
const WM_BASE_URL      = 'https://marketplace.walmartapis.com/v3';
const WM_MARKET        = 'mx';

// ── MercadoLibre ───────────────────────────────────────────────────────────────
const ML_CLIENT_ID     = '3229341112864987';
const ML_CLIENT_SECRET = 'dXOYxPIKcbuH2iXu61b53SuLVbwvq6rk';
const ML_SELLER_ID     = '244438069';
const ML_TOKENS_FILE   = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Emerson Albor', '.claude', 'ml-tokens.env');
const ML_BASE_URL      = 'https://api.mercadolibre.com';

const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ── Helpers HTTP ─────────────────────────────────────────────────────────────

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data.slice(0,300))); } });
    }).on('error', reject);
  });
}

function httpGetWithStatus(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error(data.slice(0, 300))); }
      });
    }).on('error', reject);
  });
}

// ── Walmart API ───────────────────────────────────────────────────────────────

let wmTokenCache = { token: null, expiresAt: 0 };

async function getWmToken() {
  if (wmTokenCache.token && Date.now() < wmTokenCache.expiresAt - 30000) return wmTokenCache.token;
  const creds = Buffer.from(`${WM_CLIENT_ID}:${WM_CLIENT_SECRET}`).toString('base64');
  const data = await httpPost(`${WM_BASE_URL}/token`, 'grant_type=client_credentials', {
    'Authorization': `Basic ${creds}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'WM_SVC.NAME': 'Walmart Marketplace',
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    'WM_MARKET': WM_MARKET,
  });
  wmTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function walmartGet(token, endpoint, params = {}) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${WM_BASE_URL}${endpoint}${qs ? '?' + qs : ''}`;
  return httpGet(url, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'WM_SVC.NAME': 'Walmart Marketplace',
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    'WM_SEC.ACCESS_TOKEN': token,
    'WM_MARKET': WM_MARKET,
  });
}

async function getAllWmOrders(token, startDate, endDate) {
  const orders = [];
  let cursor = null;
  do {
    const params = { createdStartDate: startDate, createdEndDate: endDate, limit: 100 };
    if (cursor) params.nextCursor = cursor;
    const res = await walmartGet(token, '/orders', params);
    const batch = (res.order || res.list?.elements?.order || []);
    orders.push(...batch);
    const next = res.meta?.nextCursorMark || res.list?.meta?.nextCursorMark;
    cursor = (next && next !== '-1') ? next : null;
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);
  return orders;
}

function aggregateWm(orders) {
  const agg = {}, skus = new Set();
  let totalVentas = 0, totalUnidades = 0;
  for (const order of orders) {
    for (const line of (order.orderLines || [])) {
      const status = (line.orderLineStatus?.[0]?.status || '').toLowerCase();
      if (status === 'cancelled') continue;
      const titulo  = line.item?.productName || 'Producto';
      const qty     = Number(line.orderLineQuantity?.amount || 0);
      const charges = line.charges || [];
      const total   = charges.reduce((sum, c) => {
        const base = Number(c.chargeAmount?.amount || 0);
        const tax  = (c.tax || []).reduce((t, tx) => t + Number(tx.taxAmount?.amount || 0), 0);
        return sum + base + tax;
      }, 0);
      totalVentas   += total;
      totalUnidades += qty;
      if (line.item?.sku) skus.add(line.item.sku);
      if (!agg[titulo]) agg[titulo] = { ingresos: 0, unidades: 0 };
      agg[titulo].ingresos += total;
      agg[titulo].unidades += qty;
    }
  }
  const top = Object.entries(agg)
    .map(([titulo, d]) => ({ titulo, ingresos: Math.round(d.ingresos), unidades: Math.round(d.unidades) }))
    .sort((a, b) => b.ingresos - a.ingresos).slice(0, 5);
  return {
    total: Math.round(totalVentas),
    ordenes: orders.length,
    unidades: totalUnidades,
    ticketPromedio: orders.length ? Math.round(totalVentas / orders.length) : 0,
    currency: 'MXN',
    skus: skus.size,
    top
  };
}

// ── MercadoLibre API ──────────────────────────────────────────────────────────

function readMlTokens() {
  try {
    const env = fs.readFileSync(ML_TOKENS_FILE, 'utf8');
    const access  = (env.match(/ML_ACCESS_TOKEN=(.+)/)  || [])[1]?.trim();
    const refresh = (env.match(/ML_REFRESH_TOKEN=(.+)/) || [])[1]?.trim();
    return { access, refresh };
  } catch(e) {
    console.error('[ml] No se pudo leer ml-tokens.env:', e.message);
    return {};
  }
}

async function refreshMlToken() {
  const { refresh } = readMlTokens();
  if (!refresh) throw new Error('No ML refresh token found');
  console.log('[ml] Refreshing token...');
  const body = `grant_type=refresh_token&client_id=${ML_CLIENT_ID}&client_secret=${ML_CLIENT_SECRET}&refresh_token=${encodeURIComponent(refresh)}`;
  const data = await httpPost('https://api.mercadolibre.com/oauth/token', body, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  });
  if (!data.access_token) throw new Error('ML refresh failed: ' + JSON.stringify(data));
  const newContent = `ML_ACCESS_TOKEN=${data.access_token}\nML_REFRESH_TOKEN=${data.refresh_token || refresh}\n`;
  fs.writeFileSync(ML_TOKENS_FILE, newContent);
  console.log('[ml] Token refreshed OK');
  return data.access_token;
}

async function mlGetPage(from, to, offset, token) {
  const url = `${ML_BASE_URL}/orders/search?seller=${ML_SELLER_ID}&order.status=paid` +
    `&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}` +
    `&limit=50&offset=${offset}`;
  return httpGetWithStatus(url, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  });
}

async function getAllMlOrders(startDate, endDate) {
  let { access: token } = readMlTokens();

  // Fetch first page to get total
  let res = await mlGetPage(startDate, endDate, 0, token);
  if (res.status === 401) {
    token = await refreshMlToken();
    res = await mlGetPage(startDate, endDate, 0, token);
  }
  if (res.status !== 200) throw new Error(`ML API error ${res.status}: ${JSON.stringify(res.body)}`);

  const total = res.body.paging?.total || 0;
  console.log(`[ml] Total órdenes en ML: ${total}`);

  const allOrders = [...(res.body.results || [])];

  // Fetch remaining pages
  for (let offset = 50; offset < total; offset += 50) {
    await new Promise(r => setTimeout(r, 150));
    let pageRes = await mlGetPage(startDate, endDate, offset, token);
    if (pageRes.status === 401) {
      token = await refreshMlToken();
      pageRes = await mlGetPage(startDate, endDate, offset, token);
    }
    if (pageRes.status !== 200) {
      console.warn(`[ml] Error en offset ${offset}: ${pageRes.status}`);
      break;
    }
    allOrders.push(...(pageRes.body.results || []));
    process.stdout.write(`\r[ml] ${allOrders.length}/${total} órdenes`);
  }
  console.log(`\r[ml] ${allOrders.length}/${total} órdenes obtenidas`);
  return allOrders;
}

function aggregateMl(orders) {
  const agg = {};
  let totalVentas = 0, totalUnidades = 0;
  for (const order of orders) {
    for (const item of (order.order_items || [])) {
      const qty   = Number(item.quantity   || 0);
      const price = Number(item.unit_price || 0);
      totalVentas   += qty * price;
      totalUnidades += qty;
      const titulo = (item.item && item.item.title) ? item.item.title : 'Producto';
      if (!agg[titulo]) agg[titulo] = { ingresos: 0, unidades: 0 };
      agg[titulo].ingresos += qty * price;
      agg[titulo].unidades += qty;
    }
  }
  const top = Object.entries(agg)
    .map(([titulo, d]) => ({ titulo, ingresos: Math.round(d.ingresos), unidades: Math.round(d.unidades) }))
    .sort((a, b) => b.ingresos - a.ingresos).slice(0, 5);
  return {
    total: Math.round(totalVentas),
    ordenes: orders.length,
    unidades: totalUnidades,
    ticketPromedio: orders.length ? Math.round(totalVentas / orders.length) : 0,
    currency: 'MXN',
    top
  };
}

// ── index.html update + git push ──────────────────────────────────────────────

function updateIndexHtml(monthKey, platform, data, parcialLabel) {
  try {
    const htmlPath = path.join(__dirname, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const topLines = data.top
      .map(p => `        { titulo: '${p.titulo.replace(/'/g, "\\'")}', ingresos: ${p.ingresos}, unidades: ${p.unidades} }`)
      .join(',\n');

    let newBlock;
    if (platform === 'walmart') {
      newBlock =
        `walmart: {\n` +
        `      total: ${data.total}, ordenes: ${data.ordenes}, unidades: ${data.unidades}, ticketPromedio: ${data.ticketPromedio}, currency: 'MXN', skus: ${data.skus || 0},\n` +
        `      parcial: true, parcialLabel: '${parcialLabel}',\n` +
        `      top: [\n${topLines}\n      ]\n` +
        `    }`;
    } else {
      newBlock =
        `mercadolibre: {\n` +
        `      total: ${data.total}, ordenes: ${data.ordenes}, unidades: ${data.unidades}, ticketPromedio: ${data.ticketPromedio},\n` +
        `      parcial: true, parcialLabel: '${parcialLabel}',\n` +
        `      top: [\n${topLines}\n      ]\n` +
        `    }`;
    }

    const marker = `'${monthKey}'`;
    const mIdx   = html.indexOf(marker);
    if (mIdx === -1) { console.warn(`[${platform}] marker '${monthKey}' no encontrado`); return false; }

    const search = platform + ':';
    const pIdx   = html.indexOf(search, mIdx);
    if (pIdx === -1) { console.warn(`[${platform}] '${search}' no encontrado`); return false; }

    let i = html.indexOf('{', pIdx);
    if (i === -1) return false;
    const start = pIdx;
    let depth = 0;
    while (i < html.length) {
      if      (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }

    const oldBlock = html.slice(start, i);
    const updated  = html.replace(oldBlock, newBlock);
    if (updated === html) { console.warn(`[${platform}] Sin cambios en HTML`); return false; }

    fs.writeFileSync(htmlPath, updated, 'utf8');
    console.log(`[${platform}] index.html actualizado`);
    return true;
  } catch(e) {
    console.warn(`[${platform}] updateIndexHtml error:`, e.message);
    return false;
  }
}

function gitPush(platform, monthKey, data, parcialLabel) {
  setImmediate(() => {
    try {
      const { execSync } = require('child_process');
      const cwd = __dirname;
      execSync('git add index.html', { cwd });
      execSync(`git commit -m "${platform} ${monthKey}: $${data.total.toLocaleString('es-MX')} · ${data.ordenes} ord · ${parcialLabel}"`, { cwd });
      execSync('git push', { cwd });
      console.log(`[${platform}] Publicado en GitHub Pages`);
    } catch(e) {
      console.warn(`[${platform}] git:`, e.message.split('\n')[0]);
    }
  });
}

// ── Fetch principales ─────────────────────────────────────────────────────────

async function fetchWalmartData() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const monthKey     = year + '-' + String(month).padStart(2, '0');
  const startDate    = `${year}-${String(month).padStart(2,'0')}-01T00:00:00Z`;
  const endDate      = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59Z`;
  const parcialLabel = `al ${day} de ${MESES[month - 1]}`;

  console.log(`[walmart] Obteniendo datos ${monthKey}...`);
  const token  = await getWmToken();
  const orders = await getAllWmOrders(token, startDate, endDate);
  const data   = aggregateWm(orders);
  data.parcial      = true;
  data.parcialLabel = parcialLabel;
  console.log(`[walmart] $${data.total.toLocaleString('es-MX')} · ${data.ordenes} ordenes · ${parcialLabel}`);

  const ok = updateIndexHtml(monthKey, 'walmart', data, parcialLabel);
  if (ok) gitPush('walmart', monthKey, data, parcialLabel);

  return { walmart: data };
}

async function fetchMlData() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const monthKey     = year + '-' + String(month).padStart(2, '0');
  const startDate    = `${year}-${String(month).padStart(2,'0')}-01T00:00:00.000-06:00`;
  const endDate      = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59.000-06:00`;
  const parcialLabel = `al ${day} de ${MESES[month - 1]}`;

  console.log(`[ml] Obteniendo datos ${monthKey}...`);
  const orders = await getAllMlOrders(startDate, endDate);
  const data   = aggregateMl(orders);
  data.parcial      = true;
  data.parcialLabel = parcialLabel;
  console.log(`[ml] $${data.total.toLocaleString('es-MX')} · ${data.ordenes} ordenes · ${parcialLabel}`);

  const ok = updateIndexHtml(monthKey, 'mercadolibre', data, parcialLabel);
  if (ok) gitPush('ml', monthKey, data, parcialLabel);

  return { mercadolibre: data };
}

// ── Servidor HTTP ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/walmart') {
    fetchWalmartData()
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        console.error('[walmart] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (req.method === 'GET' && req.url === '/ml') {
    fetchMlData()
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch(err => {
        console.error('[ml] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✓ Servidor DirectorOS listo en http://localhost:${PORT}`);
  console.log('  /walmart  → ventas Walmart del mes actual');
  console.log('  /ml       → ventas MercadoLibre del mes actual');
  console.log('\nDeja esta ventana abierta — el dashboard lo usará al presionar "Actualizar"\n');
});
