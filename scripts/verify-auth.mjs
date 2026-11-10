// Local-only: exercises real password hashing, cookies and Postgres. Never targets production.
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { hashPassword, verifyPassword, tokenHash } from '../lib/password.ts';
const origin='http://localhost:3000';
const email='qa-auth-local@example.test', changedEmail='qa-auth-changed@example.test';
const password='Teste local com senha longa 2026!', nextPassword='Outra senha de teste local 2026!';
// Same database the local dev server uses (.env.local → Neon branch "dev"). Never production.
process.loadEnvFile('.env.local');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente em .env.local');
const db = neon(process.env.DATABASE_URL);
const sql = (statement, params = []) => db.query(statement, params);
async function post(action,body={},cookie='',requestOrigin=origin){const r=await fetch(origin+'/api/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}return{status:r.status,data,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),cookieHeader:r.headers.get('set-cookie')};}
const status=async(cookie='')=>(await fetch(origin+'/api/staff/orders',{headers:cookie?{Cookie:cookie}:{}})).status;
const existing=await sql("SELECT id FROM admin_accounts WHERE id='primary-admin'");
assert.equal(existing.length,0,'This check needs an empty local primary-admin slot; it never deletes an existing account.');
let created=false;
try{
  const hash=await hashPassword(password);assert.ok(!hash.includes(password));assert.ok(await verifyPassword(password,hash));assert.equal(await verifyPassword('invalid',hash),false);
  assert.equal((await fetch(origin+'/equipe',{redirect:'manual'})).headers.get('location'),'/equipe/entrar');
  assert.equal(await status(),401);
  assert.equal((await fetch(origin+'/api/staff/orders',{headers:{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'igormraesmm@gmail.com'}})).status,401);
  const oldLogin=await fetch(origin+'/signin-with-chatgpt',{redirect:'manual'});
  assert.equal(await status(oldLogin.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')),401,'Platform session must no longer grant admin access');
  assert.equal((await post('setup',{email,password,token:'bad'})).status,403);
  assert.equal((await post('setup',{email,password,token:'t'.repeat(43)},'','https://evil.example')).status,403);
  assert.equal((await post('setup',{email,password:'short',token:'t'.repeat(43)})).status,400);
  const setup=await post('setup',{email:email.toUpperCase(),password,token:'t'.repeat(43)});
  assert.equal(setup.status,200,JSON.stringify(setup.data));created=true;
  assert.ok(setup.data.recoveryCode);assert.match(setup.cookieHeader,/HttpOnly/);assert.match(setup.cookieHeader,/SameSite=Strict/);
  assert.equal(await status(setup.cookie),200);
  assert.equal((await post('setup',{email:'attacker@example.test',password,token:'t'.repeat(43)})).status,409);
  const wrong=await post('login',{email,password:'incorrect'}),unknown=await post('login',{email:'nobody@example.test',password:'incorrect'});
  assert.equal(wrong.status,401);assert.deepEqual(wrong.data,unknown.data);
  const login=await post('login',{email,password});assert.equal(login.status,200);assert.equal(await status(login.cookie),200);assert.notEqual(login.cookie,setup.cookie);
  assert.equal(await status('pc_staff_local='+'f'.repeat(43)),401);
  assert.equal((await post('account',{email:changedEmail,currentPassword:'wrong',password:nextPassword},login.cookie)).status,400);
  assert.equal((await post('account',{email:changedEmail,currentPassword:password,password:nextPassword},login.cookie,'https://evil.example')).status,403);
  const change=await post('account',{email:changedEmail,currentPassword:password,password:nextPassword},login.cookie);assert.equal(change.status,200,JSON.stringify(change.data));
  assert.equal(await status(setup.cookie),401);assert.equal(await status(login.cookie),401);assert.equal(await status(change.cookie),200);
  assert.equal((await post('login',{email,password})).status,401);
  assert.equal((await post('login',{email:changedEmail,password})).status,401);
  const correct=await post('login',{email:changedEmail,password:nextPassword});assert.equal(correct.status,200);
  assert.equal((await post('recover',{email:changedEmail,password,recoveryCode:'wrong'})).status,400);
  const recovered=await post('recover',{email:changedEmail,password,recoveryCode:setup.data.recoveryCode});assert.equal(recovered.status,200,JSON.stringify(recovered.data));assert.notEqual(recovered.data.recoveryCode,setup.data.recoveryCode);
  assert.equal(await status(correct.cookie),401);assert.equal(await status(recovered.cookie),200);
  assert.equal((await post('recover',{email:changedEmail,password,recoveryCode:setup.data.recoveryCode})).status,400);
  assert.equal((await post('logout',{},recovered.cookie)).status,200);assert.equal(await status(recovered.cookie),401);
  const final=await post('login',{email:changedEmail,password});assert.equal(final.status,200);
  const sessionHash=tokenHash(final.cookie.split('=')[1]);
  await sql('UPDATE admin_sessions SET expires_at=1 WHERE token_hash=$1',[sessionHash]);assert.equal(await status(final.cookie),401);
  for(let i=0;i<10;i++)await post('login',{email:'qa-rate-local@example.test',password:'incorrect'});
  assert.equal((await post('login',{email:'qa-rate-local@example.test',password:'incorrect'})).status,429);
  console.log('PASS: convite restrito e único, login real, ChatGPT sem acesso, senha incorreta, CSRF, troca de email/senha, revogação de sessões, recuperação de uso único, logout, expiração e limite de tentativas.');
}finally{
  if(created){await sql("DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admin_accounts WHERE id='primary-admin' AND email IN ($1,$2))",[email,changedEmail]);await sql("DELETE FROM admin_accounts WHERE id='primary-admin' AND email IN ($1,$2)",[email,changedEmail]);}
}
