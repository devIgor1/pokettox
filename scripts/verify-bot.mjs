// WhatsApp bot logic against an in-memory Postgres (PGlite) with a fake WhatsApp port.
// Poll votes are encrypted exactly like WhatsApp clients do, so decryption is really exercised.
// No network, no WhatsApp number, no production data.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { aesEncryptGCM, hmacSign, proto } from 'baileys';
import { createTestDatabase, neonHttpHandler, isFixtureDatabaseRequest, rows, FIXTURE_DATABASE_URL } from './pglite-neon.mjs';

const pg = await createTestDatabase();
process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
globalThis.botTestAdmin = null;
const output = path.resolve('.sites-runtime/verify-bot-bundle.mjs');
await build({
  stdin: { contents: `
    export * as outbox from './bot/outbox'; export * as votes from './bot/votes'; export * as identity from './bot/identity'; export * as verify from './bot/verify';
    export * as shared from './lib/bot-shared';
    export {POST as account} from './app/api/account/[action]/route'; export {GET as me} from './app/api/account/route';
    export {GET as staffBot} from './app/api/staff/bot/route'; export {POST as staffCommand} from './app/api/staff/bot/[action]/route';`,
    resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: output, external: ['baileys', 'pino', 'qrcode'],
  plugins: [{ name: 'test-runtime', setup(b) {
    b.onResolve({ filter: /(?:^|\/)admin-auth$/ }, () => ({ path: 'admin', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function getAdmin(){return globalThis.botTestAdmin;}' }));
  } }], logLevel: 'silent' });
const m = await import(pathToFileURL(output).href);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  if (isFixtureDatabaseRequest(new URL(String(input)))) return neonHttpHandler(pg, new Request(String(input), init));
  throw new Error(`Unexpected network call: ${input}`);
};

// ---------- helpers ----------
const BOT_PN = '5511900000001@s.whatsapp.net', BOT_LID = '99990000001@lid', GROUP = '120363000000000001@g.us';
const sha = v => createHash('sha256').update(v).digest();
/** Encrypts a vote the way a WhatsApp client does (mirror of Baileys' decryptPollVote). */
function encryptVote({ secret, pollMsgId, creatorJid, voterJid, options }) {
  const sign = Buffer.concat([Buffer.from(pollMsgId), Buffer.from(creatorJid), Buffer.from(voterJid), Buffer.from('Poll Vote'), new Uint8Array([1])]);
  const key = hmacSign(sign, hmacSign(secret, new Uint8Array(32), 'sha256'), 'sha256');
  const iv = randomBytes(12);
  const plain = proto.Message.PollVoteMessage.encode({ selectedOptions: options.map(o => sha(o)) }).finish();
  return { encPayload: aesEncryptGCM(plain, key, iv, Buffer.from(`${pollMsgId}\u0000${voterJid}`)), encIv: iv };
}
let voteSeq = 0;
function vote(poll, { signVoter, signCreator = BOT_PN, voterJids, options, at = Date.now(), pushName, secret }) {
  const enc = encryptVote({ secret: secret || Buffer.from(poll.secret, 'base64'), pollMsgId: poll.message_id, creatorJid: signCreator, voterJid: signVoter, options });
  return m.votes.recordVote({ pollMessageId: poll.message_id, voteMessageId: `VOTE${++voteSeq}`, voterJids, votedAt: at, pushName, ...enc }, [BOT_PN, BOT_LID]);
}
class FakeWhatsApp {
  sent = []; failNext = 0; loggedOut = false; members = ['5511911111111@s.whatsapp.net', '22220000001@lid'];
  async #record(kind, jid, data) { if (this.failNext > 0) { this.failNext--; throw new Error('timed out'); } const id = `MSG${this.sent.length + 1}`; this.sent.push({ kind, jid, id, ...data }); return { id, message: JSON.stringify({ kind }) }; }
  sendText(jid, text, mentions) { return this.#record('text', jid, { text, mentions }); }
  sendImage(jid, url, caption, mentions) { return this.#record('image', jid, { url, caption, mentions }); }
  async sendPoll(jid, poll) { return { ...await this.#record('poll', jid, { poll }), creatorJid: BOT_PN }; }
  async groupMembers() { return this.members; }
  async logout() { this.loggedOut = true; }
}
const origin = 'https://fixture.example';
let ip = 0;
async function call(handler, method, pathname, { body, cookie, params = {}, from = origin } = {}) {
  const headers = { 'x-real-ip': `10.1.0.${++ip % 250}` };
  if (from) headers.origin = from;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await handler(new Request(origin + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
  return { status: response.status, data: await response.json(), cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
}
const account = (action, body, cookie) => call(m.account, 'POST', `/api/account/${action}`, { body, cookie, params: { action } });

try {
  // ---------- outbox ----------
  const wa = new FakeWhatsApp();
  assert.equal(await m.outbox.runOnce(wa), false, 'nothing queued');
  await m.shared.enqueueText(GROUP, { text: 'Bem-vindos!', mentionAll: true });
  assert.ok(m.shared.pollOptionsError('x', ['a'])); assert.equal(m.shared.pollOptionsError('x', ['a', 'b']), null);
  await assert.rejects(m.shared.enqueuePoll(GROUP, 'Dup', ['R$ 10', 'R$ 10']));
  await assert.rejects(m.shared.enqueuePoll(GROUP, 'Muitas', Array.from({ length: 13 }, (_, i) => `R$ ${i}`)));
  const { pollId } = await m.shared.enqueuePoll(GROUP, 'Pikachu — lance', ['R$ 10', 'R$ 12', 'R$ 14']);
  assert.equal(await m.outbox.runOnce(wa), true);
  assert.deepEqual(wa.sent[0].mentions, wa.members, 'marcar todos mentions every member');
  assert.equal(await m.outbox.runOnce(wa), true);
  const pollSent = wa.sent[1];
  assert.equal(pollSent.kind, 'poll'); assert.equal(pollSent.poll.selectableCount, 1);
  const [pollRow] = await rows(pg, 'SELECT * FROM polls WHERE id=$1', [pollId]);
  assert.equal(pollRow.message_id, pollSent.id); assert.equal(pollRow.creator_jid, BOT_PN);
  assert.equal(Buffer.from(pollSent.poll.messageSecret).toString('base64'), pollRow.secret, 'the stored secret is the one sent');
  assert.equal(await m.outbox.sentMessage(pollSent.id), JSON.stringify({ kind: 'poll' }), 'sent message kept for re-send requests');
  // Retry with backoff, then give up after 5 attempts.
  const failing = await m.shared.enqueueText(GROUP, { text: 'vai falhar' });
  wa.failNext = 99;
  for (let i = 1; i <= 5; i++) {
    await pg.query('UPDATE bot_outbox SET send_after=0 WHERE id=$1', [failing]);
    assert.equal(await m.outbox.runOnce(wa), true);
    const [r] = await rows(pg, 'SELECT status, attempts, error FROM bot_outbox WHERE id=$1', [failing]);
    assert.equal(r.attempts, i); assert.equal(r.status, i < 5 ? 'pending' : 'failed'); assert.equal(r.error, 'timed out');
  }
  wa.failNext = 0;
  // A command whose lease expired (worker died mid-send) is taken again; a poll is never published twice.
  const again = await m.shared.enqueuePoll(GROUP, 'Eevee — lance', ['R$ 5', 'R$ 6']);
  await m.outbox.claimNext();
  await pg.query("UPDATE polls SET message_id='ALREADY' WHERE id=$1", [again.pollId]);
  assert.equal(await m.outbox.runOnce(wa, Date.now()), false, 'lease still valid');
  assert.equal(await m.outbox.runOnce(wa, Date.now() + 200_000), true, 'expired lease is reclaimed');
  assert.equal(wa.sent.filter(s => s.poll?.name === 'Eevee — lance').length, 0, 'not sent again');
  assert.equal((await rows(pg, 'SELECT status FROM bot_outbox WHERE id=$1', [again.outboxId]))[0].status, 'sent');
  // Dedupe key: the same logical command is queued once.
  await m.shared.enqueueText(GROUP, { text: 'Faltam 1h' }, { dedupeKey: 'evento-1:1h' });
  await m.shared.enqueueText(GROUP, { text: 'Faltam 1h' }, { dedupeKey: 'evento-1:1h' });
  assert.equal((await rows(pg, "SELECT count(*)::int AS n FROM bot_outbox WHERE dedupe_key='evento-1:1h'"))[0].n, 1);
  await m.shared.enqueueLogout();
  while (await m.outbox.runOnce(wa)) { /* drain */ }
  assert.equal(wa.loggedOut, true);

  // ---------- votes ----------
  const poll = (await rows(pg, 'SELECT * FROM polls WHERE id=$1', [pollId]))[0];
  const ana = '5511911111111@s.whatsapp.net';
  assert.equal(await vote(poll, { signVoter: ana, voterJids: [ana + ''], options: ['R$ 12'], pushName: 'Ana TCG' }), 'recorded');
  let [ev] = await rows(pg, 'SELECT e.*, p.name FROM poll_vote_events e JOIN participants p ON p.id=e.participant_id ORDER BY received_at');
  assert.deepEqual(JSON.parse(ev.selected), ['R$ 12']); assert.equal(ev.voter_phone, '5511911111111'); assert.equal(ev.name, 'Ana TCG', 'profile created from the vote');
  // Device suffix in the key is normalized before decrypting.
  assert.equal(await vote(poll, { signVoter: ana, voterJids: ['5511911111111:23@s.whatsapp.net'], options: ['R$ 14'] }), 'recorded');
  // LID group: signed with LIDs; the phone comes from participantAlt.
  const bruno = '33330000001@lid', brunoPn = '5521922222222@s.whatsapp.net';
  assert.equal(await vote(poll, { signVoter: bruno, signCreator: BOT_LID, voterJids: [bruno, brunoPn], options: ['R$ 10'], pushName: 'Bruno' }), 'recorded');
  [ev] = await rows(pg, "SELECT * FROM poll_vote_events WHERE voter_jid=$1", [bruno]);
  assert.equal(ev.voter_phone, '5521922222222', 'LID voter resolved through the alternate id');
  // LID only, number unknown: kept, then filled in when the mapping is learned.
  const carla = '44440000001@lid';
  assert.equal(await vote(poll, { signVoter: carla, signCreator: BOT_LID, voterJids: [carla], options: ['R$ 10'] }), 'recorded');
  assert.equal((await rows(pg, 'SELECT voter_phone, participant_id FROM poll_vote_events WHERE voter_jid=$1', [carla]))[0].voter_phone, null);
  await m.identity.learnLid(carla, '5531933333333@s.whatsapp.net');
  [ev] = await rows(pg, 'SELECT voter_phone, participant_id FROM poll_vote_events WHERE voter_jid=$1', [carla]);
  assert.equal(ev.voter_phone, '5531933333333'); assert.ok(ev.participant_id);
  // Removing the vote is an empty selection, recorded as an event.
  assert.equal(await vote(poll, { signVoter: bruno, signCreator: BOT_LID, voterJids: [bruno, brunoPn], options: [] }), 'recorded');
  assert.deepEqual(JSON.parse((await rows(pg, 'SELECT selected FROM poll_vote_events WHERE voter_jid=$1 ORDER BY voted_at DESC, received_at DESC LIMIT 1', [bruno]))[0].selected), []);
  // Same vote message twice, unknown poll, wrong key.
  const enc = encryptVote({ secret: Buffer.from(poll.secret, 'base64'), pollMsgId: poll.message_id, creatorJid: BOT_PN, voterJid: ana, options: ['R$ 10'] });
  const replay = { pollMessageId: poll.message_id, voteMessageId: 'REPLAY', voterJids: [ana], votedAt: Date.now(), ...enc };
  assert.equal(await m.votes.recordVote(replay, [BOT_PN]), 'recorded');
  assert.equal(await m.votes.recordVote(replay, [BOT_PN]), 'duplicate');
  assert.equal(await m.votes.recordVote({ ...replay, pollMessageId: 'NOPE', voteMessageId: 'X1' }, [BOT_PN]), 'unknown_poll');
  assert.equal(await vote(poll, { signVoter: ana, voterJids: [ana], options: ['R$ 10'], secret: randomBytes(32) }), 'undecryptable');
  assert.equal((await rows(pg, 'SELECT count(*)::int AS n FROM poll_vote_events'))[0].n, 6);

  // ---------- staff panel ----------
  assert.equal((await call(m.staffBot, 'GET', '/api/staff/bot', { from: null })).status, 401);
  globalThis.botTestAdmin = { id: 'primary-admin', email: 'equipe@example.test', version: 1 };
  await pg.query(`INSERT INTO bot_groups (jid,subject,size,bot_is_admin,updated_at) VALUES ($1,'Grupo de teste',3,1,1)`, [GROUP]);
  await pg.query(`INSERT INTO bot_status (id,state,phone,heartbeat_at,updated_at) VALUES ('main','open','5511900000001',$1,$1)`, [Date.now()]);
  const panel = await call(m.staffBot, 'GET', '/api/staff/bot', { from: null });
  assert.equal(panel.status, 200); assert.equal(panel.data.status.online, true);
  const tally = Object.fromEntries(panel.data.polls.find(p => p.id === pollId).tally.map(t => [t.option, t.voters.length]));
  // Current choices: Ana → R$ 10 (latest, REPLAY), Bruno removed, Carla → R$ 10.
  assert.deepEqual(tally, { 'R$ 10': 2, 'R$ 12': 0, 'R$ 14': 0 });
  assert.ok(panel.data.history.some(h => h.selected.length === 0), 'removal visible in history');
  const command = (action, body, from) => call(m.staffCommand, 'POST', `/api/staff/bot/${action}`, { body, params: { action }, from });
  assert.equal((await command('text', { groupJid: GROUP, text: 'oi' }, 'https://evil.example')).status, 403);
  assert.equal((await command('text', { groupJid: '120363999@g.us', text: 'oi' })).status, 400, 'unknown group');
  assert.equal((await command('poll', { groupJid: GROUP, name: 'X', options: ['A', 'A'] })).status, 400);
  assert.equal((await command('poll', { groupJid: GROUP, name: 'Mew — lance', options: ['R$ 50', 'R$ 55'] })).status, 201);
  assert.equal((await command('text', { groupJid: GROUP, text: 'Leilão às 20h', mentionAll: true })).status, 201);
  assert.equal((await command('nope', {})).status, 404);
  globalThis.botTestAdmin = null;
  assert.equal((await command('text', { groupJid: GROUP, text: 'oi' })).status, 401);

  // ---------- WhatsApp confirmation ----------
  const pw = 'senha-de-teste-1';
  const signup = await account('signup', { name: 'Ana Colecionadora', email: 'ana@example.test', phone: '(11) 91111-1111', password: pw, acceptTerms: true });
  assert.equal(signup.status, 201);
  // The bot made a profile for 5511911111111 from votes; block it to check that the block survives the merge.
  await pg.query("UPDATE participants SET status='blocked', notes='Não pagou leilão #3' WHERE phone='5511911111111'");
  const stubId = (await rows(pg, "SELECT id FROM participants WHERE phone='5511911111111'"))[0].id;
  await pg.query("DELETE FROM bot_status");
  assert.equal((await account('phone-code', {}, signup.cookie)).status, 503, 'bot never connected');
  await pg.query(`INSERT INTO bot_status (id,state,phone,heartbeat_at,updated_at) VALUES ('main','open','5511900000001',$1,$1)`, [Date.now()]);
  const codeRes = await account('phone-code', {}, signup.cookie);
  assert.equal(codeRes.status, 200, JSON.stringify(codeRes.data));
  const { code } = codeRes.data;
  assert.match(code, /^\d{6}$/); assert.equal(codeRes.data.link, `https://wa.me/5511900000001?text=${encodeURIComponent(`Meu código PokéCofre é ${code}`)}`);
  assert.equal(await m.verify.handlePrivateText('5511911111111', 'oi, tudo bem?'), null, 'no code → silent');
  assert.equal(await m.verify.handlePrivateText(null, code), m.verify.replies.unknownNumber);
  assert.equal(await m.verify.handlePrivateText('5511955555555', code), m.verify.replies.invalid, 'code from another number');
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal(await m.verify.handlePrivateText('5511911111111', wrong), m.verify.replies.invalid);
  assert.equal((await rows(pg, 'SELECT attempts FROM phone_verifications'))[0].attempts, 1);
  assert.equal(await m.verify.handlePrivateText('5511911111111', `Meu código PokéCofre é ${code}`), m.verify.replies.done('Ana Colecionadora'));
  const [ana2] = await rows(pg, "SELECT * FROM participants WHERE email='ana@example.test'");
  assert.equal(ana2.phone, '5511911111111'); assert.equal(ana2.pending_phone, null);
  assert.equal(ana2.status, 'blocked', 'block on the number carries over'); assert.equal(ana2.notes, 'Não pagou leilão #3');
  assert.equal((await rows(pg, 'SELECT count(*)::int AS n FROM participants WHERE id=$1', [stubId]))[0].n, 0, 'bot-made profile merged');
  assert.equal((await rows(pg, "SELECT count(*)::int AS n FROM poll_vote_events WHERE voter_phone='5511911111111' AND participant_id=$1", [ana2.id]))[0].n, 3, 'her votes moved to the account');
  assert.equal((await account('phone-code', {}, signup.cookie)).status, 409, 'already confirmed');
  assert.equal(await m.verify.handlePrivateText('5511911111111', code), m.verify.replies.invalid, 'code is single use');

  // Number already confirmed on another account → refused.
  const other = await account('signup', { name: 'Outra Pessoa', email: 'outra@example.test', phone: '11 91111-1111', password: pw, acceptTerms: true });
  const otherCode = (await account('phone-code', {}, other.cookie)).data.code;
  assert.equal(await m.verify.handlePrivateText('5511911111111', otherCode), m.verify.replies.taken);
  assert.equal((await rows(pg, "SELECT phone FROM participants WHERE email='outra@example.test'"))[0].phone, null);
  // Expiry and attempt limit.
  const bia = await account('signup', { name: 'Bia Treinadora', email: 'bia@example.test', phone: '11 97777-6666', password: pw, acceptTerms: true });
  const biaCode = (await account('phone-code', {}, bia.cookie)).data.code;
  assert.equal(await m.verify.handlePrivateText('5511977776666', biaCode, Date.now() + 31 * 60_000), m.verify.replies.invalid, 'expired');
  const biaBad = biaCode === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await m.verify.handlePrivateText('5511977776666', biaBad);
  assert.equal(await m.verify.handlePrivateText('5511977776666', biaCode), m.verify.replies.invalid, 'locked after 5 wrong codes');
  const fresh = (await account('phone-code', {}, bia.cookie)).data.code;
  assert.equal(await m.verify.handlePrivateText('5511977776666', fresh), m.verify.replies.done('Bia Treinadora'), 'a new code works');

  console.log('PASS: fila (marcar todos, enquete com segredo próprio, nova tentativa e desistência, lease expirado sem duplicar enquete, deduplicação, desconectar), votos cifrados (número, LID com alternativo, LID sem número preenchido depois, sufixo de aparelho, voto removido, repetição, enquete desconhecida, chave errada), painel da equipe (apuração atual, histórico, CSRF, grupos, validação) e confirmação do WhatsApp (código de uso único, número errado, expiração, limite, fusão com perfil criado pelo robô mantendo bloqueio, número já usado).');
} finally {
  globalThis.fetch = originalFetch;
  await pg.close();
}
