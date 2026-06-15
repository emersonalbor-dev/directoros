const https = require('https');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const CLIENT_ID     = '55467e1a-a201-466d-b07c-6b068608f1e4';
const CLIENT_SECRET = 'TUkMmazS81XoKqTqVrMlc775xey-eZVtleZIsDUyg2Id4bUOlc-hlBPWf3ytyamusDIMgRPCzAeoQXCL3bk_Wg';
const BASE_URL      = 'https://marketplace.walmartapis.com/v3';
const MARKET        = 'mx';

// ── Auth ─────────────────────────────────────────────────────────────────────

function httpPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGet(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

async function getToken() {
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const data = await httpPost(
    `${BASE_URL}/token`,
    'grant_type=client_credentials',
    {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      'WM_MARKET': MARKET,
    }
  );
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

// ── Fetch all orders for a date range ────────────────────────────────────────

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

    process.stderr.write(`  Página: ${batch.length} órdenes (total acum: ${orders.length})\n`);
    if (cursor) await new Promise(r => setTimeout(r, 300));
  } while (cursor);

  return orders;
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

function aggregate(orders) {
  const agg = {}, skus = new Set();
  let totalVentas = 0, totalUnidades = 0;

  for (const order of orders) {
    const lines = order.orderLines || [];
    for (const line of lines) {
      const status = (line.orderLineStatus?.[0]?.status || '').toLowerCase();
      if (status === 'cancelled') continue;

      const titulo  = line.item?.productName || 'Producto';
      const qty     = Number(line.orderLineQuantity?.amount || 0);
      const precio  = Number(line.item?.unitPrice?.amount || 0);
      const total   = qty * precio;

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
    .sort((a, b) => b.ingresos - a.ingresos)
    .slice(0, 5);

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

// ── Update index.html ─────────────────────────────────────────────────────────

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

  // Regex: reemplaza el bloque walmart: { ... } dentro del mes actual
  // Busca desde "walmart: {" hasta el cierre del objeto (línea que termina en "},")
  const regex = new RegExp(
    `(('${monthKey.replace('-', '\\-')}'[\\s\\S]*?))walmart: \\{[\\s\\S]*?\\n    \\}`,
    ''
  );

  // Approach más simple: buscar línea exacta y reemplazar bloque
  const startMarker = '    walmart: {';
  const monthMarker = `  '${monthKey}': {`;

  const monthIdx = html.indexOf(monthMarker);
  if (monthIdx === -1) {
    process.stderr.write(`No se encontró el mes ${monthKey} en index.html\n`);
    return false;
  }

  // Dentro del bloque del mes, encontrar "    walmart: {"
  const afterMonth = html.indexOf(startMarker, monthIdx);
  if (afterMonth === -1) {
    process.stderr.write(`No se encontró bloque walmart en el mes ${monthKey}\n`);
    return false;
  }

  // Encontrar el cierre del bloque: "    }," después de afterMonth
  // Contamos llaves para encontrar el cierre correcto
  let depth = 0, i = afterMonth;
  while (i < html.length) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
    i++;
  }

  const oldBlock = html.slice(afterMonth, i);
  const updated = html.replace(oldBlock, newBlock);

  if (updated === html) {
    process.stderr.write('WARN: No se realizaron cambios en index.html\n');
    return false;
  }

  fs.writeFileSync(htmlPath, updated, 'utf8');
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const monthKey  = year + '-' + String(month).padStart(2, '0');
  const startDate = `${year}-${String(month).padStart(2,'0')}-01T00:00:00Z`;
  const endDate   = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T23:59:59Z`;

  const MESES = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const parcialLabel = `al ${day} de ${MESES[month - 1]}`;

  process.stderr.write(`\nWalmart Top — ${monthKey} (${startDate} → ${endDate})\n`);

  const token = await getToken();
  process.stderr.write('Token OK\n');

  const orders = await getAllOrders(token, startDate, endDate);
  process.stderr.write(`Total órdenes: ${orders.length}\n`);

  if (!orders.length) {
    process.stderr.write('Sin órdenes en el periodo.\n');
    process.exit(0);
  }

  const data = aggregate(orders);
  data.parcial = true;
  data.parcialLabel = parcialLabel;

  process.stderr.write(`\nResultados:\n`);
  process.stderr.write(`  Ventas:   $${data.total.toLocaleString('es-MX')}\n`);
  process.stderr.write(`  Órdenes:  ${data.ordenes}\n`);
  process.stderr.write(`  Unidades: ${data.unidades}\n`);
  process.stderr.write(`  SKUs:     ${data.skus}\n`);
  process.stderr.write(`  Ticket:   $${data.ticketPromedio}\n`);
  process.stderr.write(`  ${parcialLabel}\n\n`);

  // Actualizar index.html
  const ok = updateIndexHtml(monthKey, data, parcialLabel);
  if (ok) {
    process.stderr.write(`index.html actualizado con datos de Walmart ${monthKey}\n`);
  }

  // Output JSON (para revisión)
  console.log(JSON.stringify({ [monthKey]: { walmart: data } }, null, 2));
}

main().catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
