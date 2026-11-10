// Runs the real route/service code (including lib/pg.ts and the Neon driver) against an
// in-memory Postgres (PGlite) with all HTTP mocked.
// No production database, customer information, payment, or label is touched.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestDatabase, neonHttpHandler, isFixtureDatabaseRequest, rows, FIXTURE_DATABASE_URL } from './pglite-neon.mjs';

const pg = await createTestDatabase();
globalThis.paymentTestAdmin = null;
Object.assign(process.env, {
  DATABASE_URL: FIXTURE_DATABASE_URL,
  INFINITEPAY_HANDLE: 'fixture-store', PUBLIC_SITE_URL: 'https://fixture.example',
  SUPERFRETE_TOKEN: 'local-fixture-not-a-token', SUPERFRETE_AUTO_LABEL: 'true', SHIPPING_DOCUMENT: 'declaration',
  ORIGIN_CEP: '02335090', PACKAGE_HEIGHT_CM: '6', PACKAGE_WIDTH_CM: '11', PACKAGE_LENGTH_CM: '16', PACKAGE_WEIGHT_KG: '0.3',
  SENDER_NAME: 'Remetente de Teste', SENDER_STREET: 'Rua Teste', SENDER_NUMBER: '1', SENDER_DISTRICT: 'Teste', SENDER_CITY: 'São Paulo', SENDER_STATE: 'SP',
});
const output = path.resolve('.sites-runtime/verify-payments-bundle.mjs');
await build({ stdin: { contents: `export {POST as payment} from './app/api/payments/[action]/route'; export {POST as order} from './app/api/orders/route'; export {POST as staff,GET as staffList} from './app/api/staff/orders/route'; export {GET as csv} from './app/api/staff/spreadsheet/route';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  plugins: [{ name: 'test-runtime', setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare', namespace: 'fixture' }));
    b.onResolve({ filter: /(?:^|\/)admin-auth$/ }, () => ({ path: 'admin', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path === 'cloudflare' ? 'export const env={};' : 'export async function getAdmin(){return globalThis.paymentTestAdmin;}' }));
  } }], logLevel: 'silent' });
const routes = await import(pathToFileURL(output).href);
const origin = 'https://fixture.example';
const checks = new Map(), links = new Map(), labels = new Map();
const calls = { links: 0, cart: 0, purchase: 0, check: 0 };
let scenario = 'normal';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (isFixtureDatabaseRequest(new URL(String(input)))) return neonHttpHandler(pg, new Request(String(input), init));
  const url = String(input), body = init.body ? JSON.parse(init.body) : null;
  if (url === 'https://api.checkout.infinitepay.io/links') {
    calls.links++;
    assert.equal(body.handle, 'fixture-store'); assert.equal(body.items[0].price, 2400);
    assert.equal(body.webhook_url, `${origin}/api/payments/webhook`);
    links.set(body.order_nsu, body);
    return Response.json({ url: `https://buy.infinitepay.io/fixture-store/${body.order_nsu}` });
  }
  if (url === 'https://api.checkout.infinitepay.io/payment_check') {
    calls.check++;
    assert.equal(body.handle, 'fixture-store');
    const proof = checks.get(body.transaction_nsu);
    if (!proof || proof.reference !== body.order_nsu || proof.slug !== body.slug) return Response.json({ success: true, paid: false });
    return Response.json({ success: true, paid: true, amount: proof.amount, paid_amount: proof.amount, capture_method: proof.method });
  }
  if (url === 'https://api.superfrete.com/api/v0/cart') {
    calls.cart++;
    assert.equal(body.options.non_commercial, true); assert.equal(body.options.insurance_value, 100);
    assert.equal(body.products[0].quantity, 1); assert.equal(body.products[0].unitary_value, 100);
    assert.deepEqual(body.volumes, { weight: 0.3, height: 6, width: 11, length: 16 });
    const label = { id: `fixture-label-${calls.cart}`, price: scenario === 'higher-price' ? 25 : 20, status: 'pending' };
    labels.set(label.id, label);
    if (scenario === 'uncertain-cart') throw new Error('Simulated connection lost after cart creation');
    return Response.json(label);
  }
  if (url.startsWith('https://api.superfrete.com/api/v0/order/info/')) return Response.json(labels.get(url.split('/').at(-1)));
  if (url === 'https://api.superfrete.com/api/v0/checkout') {
    calls.purchase++;
    if (scenario === 'no-balance') return Response.json({}, { status: 400 });
    const label = labels.get(body.orders[0]); assert.equal(label.status, 'pending');
    label.status = 'released'; label.tracking = 'AA000000000BR'; label.print = { url: 'https://superfrete.com/fixture.pdf' };
    if (scenario === 'uncertain-purchase') throw new Error('Simulated connection lost after purchase');
    return Response.json({ success: true, purchase: { status: 'paid', orders: [label] } });
  }
  throw new Error(`Unexpected external request blocked: ${url}`);
};
function request(endpoint, body, headers = {}) {
  return new Request(`${origin}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
}
async function pay(action, body, headers = {}) {
  const res = await routes.payment(request(`/api/payments/${action}`, body, headers), { params: Promise.resolve({ action }) });
  return { status: res.status, data: await res.json() };
}
const customer = { name: 'Comprador de Teste', cpf: '52998224725', phone: '11999990000', cep: '01001000', street: 'Praça da Sé', number: '1', complement: '', district: 'Sé', city: 'São Paulo', state: 'SP' };
async function order(mode = 'shipping') {
  const key = crypto.randomUUID(), quote = crypto.randomUUID(), owner = crypto.randomUUID();
  await pg.query('INSERT INTO quotes VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [quote, owner, customer.cep, 'PAC', 5, 1800, 200, 2400, 10000, Date.now() + 600000]);
  const res = await routes.order(request('/api/orders', { customer, mode, quoteId: mode === 'shipping' ? quote : undefined, totalCents: 1, status: 'pago_pronto_envio' }, { 'Idempotency-Key': key, Cookie: `pc_quote=${owner}` }));
  assert.equal(res.status, 201); const data = await res.json(); return { id: data.id, key };
}
async function event(id, method = 'pix', amount = 2400) {
  const [payment] = await rows(pg, 'SELECT * FROM order_payments WHERE order_id=$1', [id]);
  const e = { order_nsu: payment.reference, invoice_slug: crypto.randomUUID(), transaction_nsu: crypto.randomUUID() };
  checks.set(e.transaction_nsu, { reference: e.order_nsu, slug: e.invoice_slug, amount, method }); return e;
}
async function status(id) { return (await rows(pg, 'SELECT status FROM orders WHERE id=$1', [id]))[0].status; }
async function job(id) { return (await rows(pg, 'SELECT * FROM shipment_jobs WHERE order_id=$1', [id]))[0]; }
async function retry(id) {
  const res = await routes.staff(request('/api/staff/orders', { id, action: 'retry_label' }));
  assert.equal(res.status, 200);
}
try {
  const vault = await order('vault'); assert.equal((await pay('checkout', vault)).status, 409); assert.equal(await job(vault.id), undefined);
  const first = await order();
  assert.equal((await pay('checkout', first, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await pay('checkout', { ...first, key: crypto.randomUUID() })).status, 404);
  const result = await pay('checkout', { ...first, amount: 1, handle: 'attacker' }); assert.equal(result.status, 200);
  assert.equal((await pay('checkout', first)).data.url, result.data.url); assert.equal(calls.links, 1);
  const proof = (await event(first.id));
  const forged = { ...proof, transaction_nsu: crypto.randomUUID(), paid: true, amount: 2400 };
  assert.equal((await pay('webhook', forged)).status, 400); assert.equal(await status(first.id), 'aguardando_pagamento'); assert.equal(calls.cart, 0);
  const short = (await event(first.id, 'pix', 1)); assert.equal((await pay('webhook', short)).status, 400); assert.equal(await status(first.id), 'aguardando_pagamento');
  process.env.INFINITEPAY_HANDLE = 'changed-store';
  assert.equal((await pay('return', proof)).data.status, 'pago_pronto_envio');
  process.env.INFINITEPAY_HANDLE = 'fixture-store';
  assert.equal((await job(first.id)).status, 'issued'); assert.equal(calls.purchase, 1);
  const before = { ...calls }; assert.equal((await pay('webhook', proof)).status, 200); assert.deepEqual(calls, before);
  assert.equal((await pay('checkout', first)).data.status, 'pago_pronto_envio'); assert.equal(calls.links, 1);
  assert.equal((await pay('status', { ...first, key: crypto.randomUUID() })).status, 404);
  assert.equal((await pay('status', first)).data.status, 'pago_pronto_envio');
  assert.equal((await routes.staff(request('/api/staff/orders', { id: first.id, action: 'retry_label' }))).status, 401);
  globalThis.paymentTestAdmin = { email: 'staff@example.test' };
  const csv = await (await routes.csv()).text(); assert.ok(csv.includes(customer.name)); assert.equal(csv.split(customer.name).length - 1, 1);
  console.log('PASS: server-owned amounts/merchant, access, cofre, checkout reuse, forged events, underpayment, PIX, stored recipient, confirmation, CSV, replay, protected label actions.');

  const card = await order(); await pay('checkout', card); assert.equal((await pay('webhook', (await event(card.id, 'credit_card')))).status, 200);
  assert.equal((await rows(pg, 'SELECT capture_method FROM order_payments WHERE order_id=$1', [card.id]))[0].capture_method, 'credit_card');
  scenario = 'higher-price'; const high = await order(); await pay('checkout', high); let purchases = calls.purchase;
  await pay('webhook', (await event(high.id))); assert.equal(await status(high.id), 'pago_pronto_envio'); assert.equal((await job(high.id)).status, 'attention'); assert.equal(calls.purchase, purchases);
  scenario = 'no-balance'; const low = await order(); await pay('checkout', low); await pay('webhook', (await event(low.id))); assert.equal((await job(low.id)).status, 'attention');
  const carts = calls.cart; scenario = 'normal'; await retry(low.id); assert.equal((await job(low.id)).status, 'issued'); assert.equal(calls.cart, carts);
  scenario = 'uncertain-purchase'; const uncertain = await order(); await pay('checkout', uncertain); const uncertainEvent = (await event(uncertain.id)); await pay('webhook', uncertainEvent);
  assert.equal((await job(uncertain.id)).status, 'attention'); purchases = calls.purchase; scenario = 'normal'; await retry(uncertain.id);
  assert.equal((await job(uncertain.id)).status, 'issued'); assert.equal(calls.purchase, purchases);
  scenario = 'uncertain-cart'; const lost = await order(); await pay('checkout', lost); const lostEvent = (await event(lost.id)); await pay('webhook', lostEvent);
  const cartCount = calls.cart; assert.equal((await job(lost.id)).status, 'attention'); scenario = 'normal'; await pay('webhook', lostEvent); await retry(lost.id); assert.equal(calls.cart, cartCount);
  assert.equal((await pay('webhook', { ...proof, order_nsu: crypto.randomUUID() })).status, 400);
  console.log('PASS: cartão, content declaration, label price cap, insufficient balance, retry without duplicate cart, ambiguous purchase reconciliation, ambiguous cart blocks re-creation.');
} finally { globalThis.fetch = originalFetch; await pg.close(); await fs.rm(output, { force: true }); }
