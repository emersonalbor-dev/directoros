/**
 * walmart_server.js — Servidor local para el dashboard DirectorOS
 *
 * Ejecutar UNA VEZ y dejar corriendo:
 *   node walmart_server.js
 *
 * El dashboard llama a http://localhost:3001/walmart cuando presionas "Actualizar".
 */

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT          = 3001;
const CLIENT_ID     = '55467e1a-a201-466d-b07c-6b068608f1e4';
const CLIENT_SECRET = 'TUkMmazS81XoKqTqVrMlc775xey-eZVtleZIsDUyg2Id4bUOlc-hlBPWf3ytyamusDIMgRPCzAeoQXCL3bk_Wg';
const BASE_URL      = 'https://marketplace.walmartapis.com/v3';
const MARKET        = 'mx';
const MESES         = ['enero','febrero','marzo','abril','mayo','junio',
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

// ── Walmart API ───────────────────────────────────────────────────────────────

async function getToken() {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const data = await httpPost(`${BASE_URL}/token`, 'grant_type=client_credentials', {
    'Authorization': `Basic ${creds}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'WM_SVC.NAME': 'Walmart Marketplace',
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    'WM_MARKET': MARKET,
  });
  return data.access_token;
}

function walmartGet(token, endpoint, params = {}) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${BASE_URL}${endpoint}${qs ? '?' + qs : ''}`;
  return httpGet(url, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'WM_SVC.NAME': 'Walmart Marketplace',
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
    'WM_SEC.ACCESS_TOKEN': token,
    'WM_MARKET': MARKET,
  });
}

async function getAllOrders(token, startDate, endDate) {
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

function aggregate(orders) {
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

// ── index.html update + git push ──────────────────────────────────────────────

function updateIndexHtml(monthKey, walmartData, parcialLabel) {
  const htmlPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const topLines = walmartData.top
    .map(p => `        { titulo: '${p.titulo.replace(/'/g, "\\'")}', ingresos: ${p.ingresos}, unidades: ${p.unidades} }`)
    .join(',\n');

  const newBlock =
    `walmart: {\n` +
    `      total: ${walmartData.total}, ordenes: ${walmartData.ordenes}, unidades: ${walmartData.unidades}, ticketPromedio: ${walmartData.ticketPromedio}, currency: 'MXN', skus: ${walmartData.skus},\n` +
    `      parcial: true, parcialLabel: '${parcialLabel}',\n` +
    `      top: [\n${topLines}\n      ]\n` +
    `    }`;

  const marker = `'${monthKey}'`;
  const mIdx   = html.indexOf(marker);
  if (mIdx === -1) return false;

  const wIdx = html.indexOf('walmart:', mIdx);
  if (wIdx === -1) return false;

  let i = html.indexOf('{', wIdx);
  if (i === -1) return false;
  const afterMonth = i;

  let depth = 0;
  while (i < html.length) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }

  const oldBlock = html.slice(afterMonth - 'walmart: '.length + 1, i);
  const updated  = html.replace(oldBlock, newBlock);
  if (updated === html) return false;

  fs.writeFileSync(htmlPath, updated, 'utf8');
  return true;
}

function gitPush(monthKey, data, parcialLabel) {
  try {
    const { execSync } = require('child_process');
    const cwd = __dirname;
    execSync('git add index.html', { cwd });
    execSync(`git commit -m "Walmart ${monthKey}: $${data.total.toLocaleString('es-MX')} · ${data.ordenes} ordenes · ${parcialLabel}"`, { cwd });
    execSync('git push', { cwd });
    console.log('[walmart] Publicado en GitHub');
  } catch (e) {
    console.warn('[walmart] git warn:', e.message.split('\n')[0]);
  }
}

// ── Fetch principal ───────────────────────────────────────────────────────────

async function fetchWalmartData() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const monthKey    = year + '-' + String(month).padStart(2, '0');
  const startDate   = `${year}-${String(month).padStart(2,'0')}-01T00:00:00Z`;
  const endDate     = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59Z`;
  const parcialLabel = `al ${day} de ${MESES[month - 1]}`;

  console.log(`[walmart] Obteniendo datos ${monthKey}...`);
  const token  = await getToken();
  const orders = await getAllOrders(token, startDate, endDate);
  const data   = aggregate(orders);
  data.parcial      = true;
  data.parcialLabel = parcialLabel;

  console.log(`[walmart] $${data.total.toLocaleString('es-MX')} · ${data.ordenes} ordenes · ${parcialLabel}`);

  // Actualizar index.html y publicar en GitHub en background
  setImmediate(() => {
    try {
      const ok = updateIndexHtml(monthKey, data, parcialLabel);
      if (ok) gitPush(monthKey, data, parcialLabel);
    } catch(e) {
      console.warn('[walmart] update html:', e.message);
    }
  });

  return { walmart: data };
}

// ── Servidor HTTP ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS — permite llamadas desde cualquier origen (incluyendo GitHub Pages HTTPS)
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

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nWalmart server listo en http://localhost:${PORT}/walmart`);
  console.log('Deja esta ventana abierta — el dashboard lo usará al presionar "Actualizar"\n');
});
