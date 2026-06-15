/**
 * Configura auto-renovación de token de ML.
 * Uso: node ml_auth_setup.js
 *
 * Pasos:
 *  1. Abre el navegador en la página de autorización de ML
 *  2. Tú apruebas el acceso en ML
 *  3. ML redirige a localhost y este script captura el código
 *  4. Se intercambia por access_token + refresh_token
 *  5. Se inyectan en el localStorage del dashboard automáticamente
 */

const http    = require('http');
const https   = require('https');
const url     = require('url');
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const APP_ID   = '3229341112864987';
const PORT     = 3333;
const REDIRECT = 'http://localhost:' + PORT + '/callback';
const AUTH_URL = 'https://auth.mercadolibre.com.mx/authorization' +
  '?response_type=code&client_id=' + APP_ID + '&redirect_uri=' + encodeURIComponent(REDIRECT);

// ── helpers ────────────────────────────────────────────────────────────
function ask(q) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, a => { rl.close(); res(a.trim()); });
  });
}

function openBrowser(u) {
  const { exec } = require('child_process');
  exec('start "" "' + u + '"'); // Windows
}

function postJson(reqUrl, body) {
  return new Promise((resolve, reject) => {
    const p = new url.URL(reqUrl);
    const data = Object.entries(body).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
    const opts = {
      hostname: p.hostname, path: p.pathname + p.search, port: 443,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n========================================');
  console.log('  Configurador de Auto-renovación ML  ');
  console.log('========================================\n');

  // 1. Pedir client_secret
  console.log('Necesito el Client Secret de tu app en Mercado Libre.');
  console.log('Dónde encontrarlo:');
  console.log('  1. Ve a https://developers.mercadolibre.com.mx/devcenter');
  console.log('  2. Selecciona tu app (ID: ' + APP_ID + ')');
  console.log('  3. Copia el "Client secret"\n');

  const secret = await ask('Pega tu Client Secret aquí: ');
  if (!secret) { console.error('Sin client secret, cancelado.'); process.exit(1); }

  // 2. Abrir navegador para autorizar
  console.log('\nAbriendo el navegador para autorizar la app en ML...');
  openBrowser(AUTH_URL);

  // 3. Iniciar servidor local para capturar callback
  console.log('Esperando que ML redirija de vuelta (puerto ' + PORT + ')...\n');

  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const q = url.parse(req.url, true).query;
      if (q.code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;padding:40px;text-align:center">' +
          '<h2 style="color:#27ae60">✓ Autorización exitosa</h2>' +
          '<p>Puedes cerrar esta ventana. El script está guardando tus tokens...</p></body></html>');
        srv.close();
        resolve(q.code);
      } else {
        res.writeHead(400); res.end('Sin código');
        srv.close();
        reject(new Error('ML no devolvió código: ' + JSON.stringify(q)));
      }
    });
    srv.listen(PORT);
    srv.on('error', reject);
  });

  console.log('✓ Código recibido de ML. Intercambiando por tokens...');

  // 4. Intercambiar código por tokens
  const tokens = await postJson('https://api.mercadolibre.com/oauth/token', {
    grant_type:    'authorization_code',
    client_id:     APP_ID,
    client_secret: secret,
    code:          code,
    redirect_uri:  REDIRECT
  });

  if (!tokens.access_token) {
    console.error('Error al obtener tokens:', tokens);
    process.exit(1);
  }

  console.log('\n✓ Tokens obtenidos:');
  console.log('  access_token:  ' + tokens.access_token.substring(0, 40) + '...');
  console.log('  refresh_token: ' + (tokens.refresh_token || '(no incluido)'));
  console.log('  expires_in:    ' + tokens.expires_in + 's');

  // 5. Guardar en archivo para referencia
  const creds = {
    client_id:     APP_ID,
    client_secret: secret,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token || '',
    saved_at:      new Date().toISOString()
  };
  const credFile = path.join(__dirname, 'ml_credentials.json');
  fs.writeFileSync(credFile, JSON.stringify(creds, null, 2));
  console.log('\n✓ Credenciales guardadas en ml_credentials.json (NO subir a git)');

  // 6. Generar snippet para pegar en el navegador
  const snippet =
    `localStorage.setItem('ml_token', '${tokens.access_token}');` +
    `localStorage.setItem('ml_refresh_token', '${tokens.refresh_token || ''}');` +
    `localStorage.setItem('ml_client_secret', '${secret}');` +
    `localStorage.setItem('ml_client_id', '${APP_ID}');` +
    `console.log('✓ Credenciales guardadas. Recarga el dashboard.');`;

  const snippetFile = path.join(__dirname, 'ml_inject_creds.js');
  fs.writeFileSync(snippetFile, snippet);

  console.log('\n========================================');
  console.log('  ÚLTIMO PASO: activa en el dashboard  ');
  console.log('========================================');
  console.log('\n1. Abre el dashboard: https://emersonalbor-dev.github.io/directoros/');
  console.log('2. Abre la consola del navegador (F12 → Console)');
  console.log('3. Copia y pega este comando:\n');
  console.log(snippet);
  console.log('\nO ejecuta: node ml_inject_creds.js  (lo abre automáticamente)');
  console.log('\n¡Listo! El token se renovará automáticamente cuando expire.\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
