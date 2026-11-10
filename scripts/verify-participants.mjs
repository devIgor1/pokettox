// Participant accounts and addresses: real route code, lib/pg.ts and the Neon driver against an
// in-memory Postgres (PGlite). No network, no Neon account, no production data.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestDatabase, neonHttpHandler, isFixtureDatabaseRequest, rows, FIXTURE_DATABASE_URL } from './pglite-neon.mjs';

const pg = await createTestDatabase();
process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
const output = path.resolve('.sites-runtime/verify-participants-bundle.mjs');
await build({
  stdin: { contents: `export {POST as account} from './app/api/account/[action]/route'; export {GET as me} from './app/api/account/route';
    export {POST as createAddress} from './app/api/account/addresses/route'; export {PUT as updateAddress,PATCH as defaultAddress,DELETE as deleteAddress} from './app/api/account/addresses/[id]/route';`,
    resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  plugins: [{ name: 'test-runtime', setup(b) {
    // lib/server.ts imports the staff session helper, which needs the Next runtime; staff access is not exercised here.
    b.onResolve({ filter: /(?:^|\/)admin-auth$/ }, () => ({ path: 'admin', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function getAdmin(){return null;}' }));
  } }], logLevel: 'silent' });
const routes = await import(pathToFileURL(output).href);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (isFixtureDatabaseRequest(new URL(String(input)))) return neonHttpHandler(pg, new Request(String(input), init));
  throw new Error(`Unexpected network call: ${input}`);
};
const origin = 'https://fixture.example';
let ip = 0;
async function call(handler, method, pathname, { body, cookie, params = {}, from = origin } = {}) {
  const headers = { 'x-real-ip': `10.0.0.${++ip % 250}` };
  if (from) headers.origin = from;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await handler(new Request(origin + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
  const setCookie = response.headers.get('set-cookie') || '';
  return { status: response.status, data: await response.json(), setCookie, cookie: setCookie.split(';')[0] };
}
const post = (action, body, opts = {}) => call(routes.account, 'POST', `/api/account/${action}`, { body, params: { action }, ...opts });
const me = cookie => call(routes.me, 'GET', '/api/account', { cookie, from: null });
const address = { label: 'Casa', recipient: 'Ana Colecionadora', cep: '01310-100', street: 'Av. Paulista', number: '1000', complement: 'ap 1', district: 'Bela Vista', city: 'São Paulo', state: 'SP' };

try {
  const password = 'senha-de-teste-1';
  // Sign-up: validation, CSRF, terms, cookie attributes.
  assert.equal((await post('signup', { name: 'Ana Colecionadora', email: 'ana@example.test', phone: '11 99999-0000', password, acceptTerms: false })).status, 400);
  assert.equal((await post('signup', { name: 'Ana Colecionadora', email: 'ana@example.test', phone: '123', password, acceptTerms: true })).status, 400);
  assert.equal((await post('signup', { name: 'Ana Colecionadora', email: 'ana@example.test', phone: '11999990000', password: 'curta', acceptTerms: true })).status, 400);
  assert.equal((await post('signup', { name: 'Ana Colecionadora', email: 'ana@example.test', phone: '11999990000', password, acceptTerms: true }, { from: 'https://evil.example' })).status, 403);
  assert.equal((await post('signup', { name: 'Ana Colecionadora', email: 'ana@example.test', phone: '11999990000', password, acceptTerms: true }, { from: null })).status, 403);
  const signup = await post('signup', { name: 'Ana Colecionadora', email: 'ANA@example.test', phone: '+55 (11) 99999-0000', password, acceptTerms: true });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  assert.match(signup.setCookie, /^__Host-pc_conta=/); assert.match(signup.setCookie, /HttpOnly/); assert.match(signup.setCookie, /SameSite=Lax/); assert.match(signup.setCookie, /Secure/);
  assert.equal(signup.data.participant.email, 'ana@example.test');
  assert.equal(signup.data.participant.phone, null, 'phone is only set after bot verification');
  assert.equal(signup.data.participant.pending_phone, '5511999990000');
  const [stored] = await rows(pg, 'SELECT password_hash, terms_accepted_at FROM participants WHERE email=$1', ['ana@example.test']);
  assert.ok(stored.password_hash.startsWith('scrypt$') && !stored.password_hash.includes(password)); assert.ok(Number(stored.terms_accepted_at) > 0);
  assert.equal((await post('signup', { name: 'Outra Pessoa', email: 'ana@example.test', phone: '11988887777', password, acceptTerms: true })).status, 409);
  assert.equal((await me(signup.cookie)).status, 200);
  assert.equal((await me('')).status, 401);
  assert.equal((await me('__Host-pc_conta=' + 'f'.repeat(43))).status, 401);

  // Login: same answer for wrong password and unknown e-mail.
  const wrong = await post('login', { email: 'ana@example.test', password: 'errada-errada' }), unknown = await post('login', { email: 'ninguem@example.test', password: 'errada-errada' });
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.data, unknown.data);
  const login = await post('login', { email: 'ana@example.test', password });
  assert.equal(login.status, 200); assert.notEqual(login.cookie, signup.cookie);
  // A participant created by the bot (no e-mail) can never sign in or hold a session.
  await pg.query("INSERT INTO participants (id,phone,status,version,created_at,updated_at) VALUES ('bot-made','5521977776666','active',1,1,1)");
  assert.equal((await post('login', { email: '', password: 'x' })).status, 400);

  // Profile: CPF validation, pending phone vs verified phone.
  assert.equal((await post('profile', { name: 'Ana Colecionadora', cpf: '111.111.111-11', phone: '11999990000' }, { cookie: login.cookie })).status, 400);
  assert.equal((await post('profile', { name: 'Ana C.', cpf: '', phone: '11999990000' })).status, 401);
  let profile = await post('profile', { name: 'Ana Colecionadora Silva', cpf: '529.982.247-25', phone: '(11) 98888-1234' }, { cookie: login.cookie });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.participant.cpf, '52998224725'); assert.equal(profile.data.participant.pending_phone, '5511988881234');
  await pg.query("UPDATE participants SET phone='5511988881234', pending_phone=NULL WHERE email='ana@example.test'"); // what the bot will do in phase 2
  profile = await post('profile', { name: 'Ana Colecionadora Silva', cpf: '', phone: '11988881234' }, { cookie: login.cookie });
  assert.equal(profile.data.participant.pending_phone, null, 'informing the verified number keeps it verified'); assert.equal(profile.data.participant.cpf, null);
  profile = await post('profile', { name: 'Ana Colecionadora Silva', cpf: '', phone: '11977770000' }, { cookie: login.cookie });
  assert.equal(profile.data.participant.phone, '5511988881234'); assert.equal(profile.data.participant.pending_phone, '5511977770000');

  // Addresses: ownership, default rules, limit.
  const create = body => call(routes.createAddress, 'POST', '/api/account/addresses', { body, cookie: login.cookie });
  const list = async () => (await me(login.cookie)).data.addresses;
  assert.equal((await call(routes.createAddress, 'POST', '/api/account/addresses', { body: address })).status, 401);
  assert.equal((await create({ ...address, cep: '123' })).status, 400);
  assert.equal((await create({ ...address, state: 'XX' })).status, 400);
  const first = await create(address); assert.equal(first.status, 201);
  const second = await create({ ...address, label: 'Trabalho', cep: '20040020' }); assert.equal(second.status, 201);
  let saved = await list();
  assert.equal(saved.length, 2); assert.equal(saved[0].id, first.data.id); assert.equal(saved[0].is_default, 1); assert.equal(saved[1].is_default, 0);
  assert.equal(saved[0].cep, '01310100');
  assert.equal((await call(routes.defaultAddress, 'PATCH', '/x', { params: { id: second.data.id }, cookie: login.cookie })).status, 200);
  saved = await list(); assert.equal(saved[0].id, second.data.id); assert.equal(saved.filter(a => a.is_default).length, 1);
  const updated = await call(routes.updateAddress, 'PUT', '/x', { params: { id: first.data.id }, cookie: login.cookie, body: { ...address, label: 'Casa da praia' } });
  assert.equal(updated.status, 200); assert.ok((await list()).some(a => a.label === 'Casa da praia'));

  // Another participant cannot see, change or delete Ana's addresses.
  const bruno = await post('signup', { name: 'Bruno Treinador', email: 'bruno@example.test', phone: '21 98888-7777', password, acceptTerms: true });
  assert.equal((await me(bruno.cookie)).data.addresses.length, 0);
  assert.equal((await call(routes.updateAddress, 'PUT', '/x', { params: { id: first.data.id }, cookie: bruno.cookie, body: address })).status, 404);
  assert.equal((await call(routes.defaultAddress, 'PATCH', '/x', { params: { id: first.data.id }, cookie: bruno.cookie })).status, 404);
  assert.equal((await call(routes.deleteAddress, 'DELETE', '/x', { params: { id: first.data.id }, cookie: bruno.cookie })).status, 404);
  assert.equal((await list()).length, 2); assert.equal((await list())[0].id, second.data.id, 'Ana keeps her default');
  assert.equal((await call(routes.deleteAddress, 'DELETE', '/x', { params: { id: first.data.id }, cookie: login.cookie, from: 'https://evil.example' })).status, 403);

  // Deleting the default promotes the remaining address.
  assert.equal((await call(routes.deleteAddress, 'DELETE', '/x', { params: { id: second.data.id }, cookie: login.cookie })).status, 200);
  saved = await list(); assert.equal(saved.length, 1); assert.equal(saved[0].is_default, 1);
  for (let i = 0; i < 4; i++) assert.equal((await create({ ...address, label: `Extra ${i}` })).status, 201);
  assert.equal((await create({ ...address, label: 'Sexto' })).status, 409);

  // Password change signs out other devices and keeps the current one.
  assert.equal((await post('password', { currentPassword: 'errada-errada', password: 'nova-senha-123' }, { cookie: login.cookie })).status, 400);
  const changed = await post('password', { currentPassword: password, password: 'nova-senha-123' }, { cookie: login.cookie });
  assert.equal(changed.status, 200);
  assert.equal((await me(signup.cookie)).status, 401); assert.equal((await me(login.cookie)).status, 401); assert.equal((await me(changed.cookie)).status, 200);
  assert.equal((await post('login', { email: 'ana@example.test', password })).status, 401);
  assert.equal((await post('login', { email: 'ana@example.test', password: 'nova-senha-123' })).status, 200);

  // Logout and expiry.
  assert.equal((await post('logout', {}, { cookie: changed.cookie })).status, 200); assert.equal((await me(changed.cookie)).status, 401);
  const fresh = await post('login', { email: 'ana@example.test', password: 'nova-senha-123' });
  await pg.query('UPDATE participant_sessions SET expires_at=1');
  assert.equal((await me(fresh.cookie)).status, 401);

  // Per-e-mail login limit.
  for (let i = 0; i < 10; i++) await post('login', { email: 'alvo@example.test', password: 'errada-errada' });
  assert.equal((await post('login', { email: 'alvo@example.test', password: 'errada-errada' })).status, 429);

  console.log('PASS: cadastro com termos e CSRF, cookie Lax seguro, login sem enumeração, perfil com CPF e WhatsApp pendente/verificado, endereços (padrão único, isolamento entre contas, limite de 5), troca de senha revogando sessões, logout, expiração e limite de tentativas.');
} finally {
  globalThis.fetch = originalFetch;
  await pg.close();
}
