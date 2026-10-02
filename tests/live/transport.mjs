// Live checks against the real Telegram servers (needs internet; not part of
// `npm run test:e2e`). Uses no account and no credential: the session is a
// random key that Telegram does not know.
//
//   npm run package && npm run test:live
//   LIVE_PROXY=1 npm run test:live   (also through a local HTTP CONNECT proxy,
//                                     like the phone's proxy on the glasses)
//
// For each browser it checks that the release build:
// 1. loads GramJS, opens wss://<dc>.web.telegram.org/apiws from an
//    http://127.0.0.1 page, and gets an answer from Telegram;
// 2. shows "Session not accepted" (AUTH_KEY_UNKNOWN) for that session instead of
//    retrying forever or reporting a network problem.
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {chromium, firefox} from 'playwright';
import {AuthKey} from 'telegram/crypto/AuthKey.js';
import {StringSession} from 'telegram/sessions/index.js';
import {startStaticServer} from '../e2e/static-server.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

async function randomSession(dcId) {
  const session = new StringSession('');
  const key = new AuthKey();
  await key.setKey(crypto.randomBytes(256));
  // The IP is what a desktop login stores; the app swaps it for the web host.
  session.setDC(dcId, '149.154.167.51', 443);
  session.setAuthKey(key);
  return session.save();
}

function startProxy(port) {
  const log = [];
  const server = http.createServer((req, res) => {
    const target = new URL(req.url);
    const upstream = http.request({host: target.hostname, port: target.port || 80, path: target.pathname + target.search, method: req.method, headers: req.headers}, up => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on('connect', (req, client, head) => {
    log.push(req.url);
    const [host, targetPort] = req.url.split(':');
    const upstream = net.connect(Number(targetPort), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({server, log})));
}

const results = [];
const app = await startStaticServer(path.join(root, 'dist'), 4195);
const proxy = process.env.LIVE_PROXY ? await startProxy(8899) : null;

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  for (const viaProxy of proxy ? [false, true] : [false]) {
    const label = `${name}${viaProxy ? ' via CONNECT proxy' : ''}`;
    const browser = await type.launch(viaProxy ? {proxy: {server: 'http://127.0.0.1:8899', bypass: '127.0.0.1'}} : {});
    const context = await browser.newContext({viewport: {width: 480, height: 640}});
    const session = await randomSession(2);
    await context.addInitScript(values => {
      window.lumen = {config: {get: async () => values, onChange: () => () => {}}};
    }, {'telegram.apiId': '12345', 'telegram.apiHash': '0123456789abcdef0123456789abcdef', 'telegram.session': session});
    const page = await context.newPage();
    const sockets = [];
    page.on('websocket', ws => sockets.push(ws.url()));
    const started = Date.now();
    await page.goto('http://127.0.0.1:4195/');
    let outcome;
    try {
      await page.getByText('Session not accepted').waitFor({timeout: 120000});
      const detail = await page.evaluate(() => document.body.innerText.match(/AUTH_KEY_\w+/)?.[0] ?? '');
      outcome = `ok: "Session not accepted" ${detail} after ${Math.round((Date.now() - started) / 1000)} s`;
    } catch {
      outcome = `FAIL: ${(await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' / ').slice(0, 160)}`;
    }
    results.push(`${label}: ${outcome}; WebSockets: ${[...new Set(sockets)].join(', ') || 'none'}`);
    console.log(results.at(-1));
    await browser.close();
  }
}

if (proxy) {
  console.log(`proxy CONNECT targets: ${[...new Set(proxy.log)].join(', ')}`);
  proxy.server.close();
}
app.close();
process.exit(results.some(line => line.includes('FAIL')) ? 1 : 0);
