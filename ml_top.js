const https = require('https');
const TOKEN = 'APP_USR-3229341112864987-061420-ee54b1d30261d6d7d43aec8f218e5001-244438069';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: 'Bearer ' + TOKEN } };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function getOrdersPage(from, to, offset) {
  const url = `https://api.mercadolibre.com/orders/search?seller=244438069&order.status=paid&order.date_created.from=${encodeURIComponent(from)}&order.date_created.to=${encodeURIComponent(to)}&limit=50&offset=${offset}`;
  return fetchJson(url);
}

async function getMonthFull(from, to, label) {
  const first = await getOrdersPage(from, to, 0);
  const total = first.paging ? first.paging.total : 0;
  process.stderr.write(`${label}: total=${total}\n`);

  // Fetch ALL pages if ≤ 700, else 10 distributed
  let allPages = [first];
  if (total <= 700) {
    for (let o = 50; o < total; o += 50) {
      try {
        allPages.push(await getOrdersPage(from, to, o));
        await new Promise(r => setTimeout(r, 150));
      } catch(e) { process.stderr.write(`Error offset ${o}: ${e.message}\n`); }
    }
  } else {
    const dists = [];
    for (let i = 1; i <= 9; i++) dists.push(Math.floor(total * i / 10));
    dists.push(Math.max(0, total - 50));
    for (const o of [...new Set(dists)]) {
      try {
        allPages.push(await getOrdersPage(from, to, o));
        await new Promise(r => setTimeout(r, 150));
      } catch(e) { process.stderr.write(`Error offset ${o}: ${e.message}\n`); }
    }
  }

  const agg = {}, skus = new Set();
  let ventas = 0, unidades = 0, seenOrders = new Set(), sampledN = 0;

  for (const page of allPages) {
    for (const order of (page.results || [])) {
      if (seenOrders.has(order.id)) continue;
      seenOrders.add(order.id); sampledN++;
      for (const item of (order.order_items || [])) {
        const titulo = item.item ? item.item.title : 'Unknown';
        const qty = item.quantity || 0;
        const price = item.unit_price || 0;
        ventas += qty * price; unidades += qty;
        if (item.item && item.item.id) skus.add(item.item.id);
        if (!agg[titulo]) agg[titulo] = { ingresos: 0, unidades: 0 };
        agg[titulo].ingresos += qty * price;
        agg[titulo].unidades += qty;
      }
    }
  }

  const scale = (total > 700 && sampledN > 0) ? total / sampledN : 1;
  const top = Object.entries(agg)
    .map(([titulo, d]) => ({ titulo, ingresos: Math.round(d.ingresos), unidades: Math.round(d.unidades) }))
    .sort((a, b) => b.ingresos - a.ingresos).slice(0, 10);

  return { ordenes: total, ventas: Math.round(ventas * scale), unidades: Math.round(unidades * scale), skus: skus.size, top };
}

async function main() {
  const months = [
    { key: '2026-06', from: '2026-06-01T00:00:00.000-06:00', to: '2026-06-15T23:59:59.000-06:00' },
  ];

  const result = {};
  for (const m of months) {
    result[m.key] = await getMonthFull(m.from, m.to, m.key);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
