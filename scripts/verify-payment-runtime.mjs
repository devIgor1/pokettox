// Uses workerd (the deployed runtime), real local D1, and a closed mock outbound service.
// No requests reach InfinitePay or SuperFrete and no production data is used.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import fs from 'node:fs/promises';

const orderId = 'PC-00000000-0000-4000-8000-000000000001';
const reference = '00000000-0000-4000-8000-000000000002';
const bundle = await build({
  stdin: { contents: `
    import {createCheckout,checkPayment} from './lib/infinitepay';
    import {issueShipment} from './lib/shipments';
    export default {async fetch(request) {
      try {
        if(new URL(request.url).pathname==='/shipment') {await issueShipment('${orderId}');return Response.json({ok:true});}
        if(new URL(request.url).pathname==='/check') return Response.json(await checkPayment('fixture-store',{order_nsu:'${reference}',transaction_nsu:'fixture-transaction',invoice_slug:'fixture-invoice'},2400));
        return Response.json({url:await createCheckout({handle:'fixture-store',reference:'${reference}',amount:2400,service:'PAC',origin:'https://fixture.example'})});
      } catch(e){return Response.json({error:e.name,message:e.message},{status:500});}
    }};
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
  external: ['cloudflare:workers', 'node:*'],
  plugins: [{ name: 'no-admin-in-this-test', setup(b) {
    b.onResolve({ filter: /(?:^|\/)admin-auth$/ }, () => ({ path: 'admin', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function getAdmin(){return null;}' }));
  } }], logLevel: 'silent',
});
let redirect = false, purchased = false;
const calls = [];
const mf = new Miniflare({
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  d1Databases: { DB: 'payment-runtime-fixture' },
  bindings: {
    INFINITEPAY_HANDLE: 'fixture-store', PUBLIC_SITE_URL: 'https://fixture.example',
    SUPERFRETE_TOKEN: 'fixture-not-a-real-token', SUPERFRETE_AUTO_LABEL: 'true', SHIPPING_DOCUMENT: 'declaration',
    ORIGIN_CEP: '02335090', PACKAGE_HEIGHT_CM: '6', PACKAGE_WIDTH_CM: '11', PACKAGE_LENGTH_CM: '16', PACKAGE_WEIGHT_KG: '0.3',
    SENDER_NAME: 'Remetente de Teste', SENDER_STREET: 'Rua Teste', SENDER_NUMBER: '1', SENDER_DISTRICT: 'Teste', SENDER_CITY: 'São Paulo', SENDER_STATE: 'SP',
  },
  outboundService: async request => {
    const url = new URL(request.url); calls.push(url.href);
    if (url.hostname === 'api.checkout.infinitepay.io' && url.pathname === '/links') {
      const body = await request.json(); assert.equal(body.items[0].price, 2400); assert.equal(body.handle, 'fixture-store');
      return redirect ? new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } }) : Response.json({ url: 'https://buy.infinitepay.io/fixture-store/fixture' });
    }
    if (url.hostname === 'api.checkout.infinitepay.io' && url.pathname === '/payment_check') return Response.json({ success: true, paid: true, amount: 2400, paid_amount: 2400, capture_method: 'pix' });
    if (url.hostname === 'api.superfrete.com') {
      if (url.pathname === '/api/v0/cart') return Response.json({ id: 'fixture-label', price: 20, status: 'pending' });
      if (url.pathname === '/api/v0/order/info/fixture-label') return Response.json({ id: 'fixture-label', price: 20, status: purchased ? 'released' : 'pending', tracking: purchased ? 'AA000000000BR' : null });
      if (url.pathname === '/api/v0/checkout') { purchased = true; return Response.json({ success: true }); }
    }
    throw new Error('Unexpected network request blocked');
  },
});
try {
  const response = await mf.dispatchFetch('https://fixture.example/create');
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.url, 'https://buy.infinitepay.io/fixture-store/fixture');
  const check = await mf.dispatchFetch('https://fixture.example/check'); assert.deepEqual(await check.json(), { method: 'pix' });
  redirect = true;
  const blocked = await mf.dispatchFetch('https://fixture.example/create'); assert.equal(blocked.status, 500);
  assert.ok(!calls.some(url => url.includes('untrusted.example'))); redirect = false;
  const db = await mf.getD1Database('DB');
  for (const file of (await fs.readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of (await fs.readFile(`drizzle/${file}`, 'utf8')).split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO orders (id,idempotency_key,fingerprint,customer,mode,service,total_cents,status,created_at) VALUES (?,?,?,'{}','shipping','PAC',2400,'pago_pronto_envio',?)").bind(orderId, crypto.randomUUID(), 'fixture', Date.now()).run();
  await db.prepare("INSERT INTO shipment_jobs (order_id,request_json,max_cents,updated_at) VALUES (?,'{}',2000,?)").bind(orderId, Date.now()).run();
  const shipment = await mf.dispatchFetch('https://fixture.example/shipment'); assert.equal(shipment.status, 200);
  const row = await db.prepare('SELECT status,error FROM shipment_jobs WHERE order_id=?').bind(orderId).first();
  assert.equal(row.status, 'issued', row.error); assert.equal(purchased, true);
  assert.equal(calls.filter(url => url.endsWith('/api/v0/checkout')).length, 1);
  console.log('PASS: workerd creates checkout, verifies payment, blocks redirects, and issues one label through real local D1. All external calls mocked.');
} finally { await mf.dispose(); }
