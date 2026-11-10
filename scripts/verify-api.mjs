// Local-only integration check. Never targets the hosted site. Fixtures are removed by exact IDs.
import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
import {hashPassword} from '../lib/password.ts';
const origin='http://localhost:3000';
const customer={name:'QA local — teste automatizado',cpf:'52998224725',phone:'11999990000',cep:'01001000',street:'Praça da Sé',number:'1',complement:'',district:'Sé',city:'São Paulo',state:'SP'};
const keys=[],quoteIds=[],created=[];
const owner=crypto.randomUUID();
const adminId=`qa-ops-${crypto.randomUUID()}`,adminEmail=`${adminId}@example.test`,adminPassword='Senha exclusiva do teste de pedidos!';
// Same database the local dev server uses (.env.local → Neon branch "dev"). Never production.
process.loadEnvFile('.env.local');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente em .env.local');
const db = neon(process.env.DATABASE_URL);
const sql = (statement, params = []) => db.query(statement, params);
async function post(path,body,extra={}){const res=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...extra},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
try {
  assert.equal((await fetch(origin+'/api/staff/orders')).status,401);
  assert.equal((await fetch(origin+'/api/staff/spreadsheet')).status,401);
  const passwordHash=await hashPassword(adminPassword);
  await sql('INSERT INTO admin_accounts (id,email,password_hash,recovery_hash,active,version,created_at) VALUES ($1,$2,$3,$4,1,1,$5)',[adminId,adminEmail,passwordHash,'fixture-unused',Date.now()]);
  const signin=await fetch(origin+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert.equal(signin.status,200);
  const auth=signin.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  assert.ok(auth,'Local password sign-in cookie required');
  assert.equal((await fetch(origin+'/api/staff/orders',{headers:{Cookie:auth}})).status,200);
  const key=crypto.randomUUID();keys.push(key);
  const bad=await post('/api/orders',{customer:{...customer,cpf:'11111111111'},mode:'vault'},{'Idempotency-Key':crypto.randomUUID()});assert.equal(bad.status,400);
  const vault=await post('/api/orders',{customer,mode:'vault'},{'Idempotency-Key':key});assert.equal(vault.status,201,JSON.stringify(vault));created.push(vault.data.id);assert.equal(vault.data.status,'no_cofre');
  const repeat=await post('/api/orders',{customer,mode:'vault'},{'Idempotency-Key':key});assert.equal(repeat.data.id,vault.data.id);
  const changed=await post('/api/orders',{customer:{...customer,name:'Outro QA'},mode:'vault'},{'Idempotency-Key':key});assert.equal(changed.status,409);
  assert.equal((await post('/api/staff/orders',{id:vault.data.id,action:'confirm_payment'},{Cookie:auth})).status,409);
  const expired=crypto.randomUUID();quoteIds.push(expired);await sql("INSERT INTO quotes VALUES ($1,$2,'01001000','PAC',5,1800,200,2400,10000,$3)",[expired,owner,Date.now()-1000]);
  const exp=await post('/api/orders',{customer,mode:'shipping',quoteId:expired},{Cookie:`pc_quote=${owner}`,'Idempotency-Key':crypto.randomUUID()});assert.equal(exp.status,409);
  const quote=crypto.randomUUID();quoteIds.push(quote);await sql("INSERT INTO quotes VALUES ($1,$2,'01001000','PAC',5,1800,200,2400,10000,$3)",[quote,owner,Date.now()+600000]);
  const foreign=await post('/api/orders',{customer,mode:'shipping',quoteId:quote},{Cookie:`pc_quote=${crypto.randomUUID()}`,'Idempotency-Key':crypto.randomUUID()});assert.equal(foreign.status,409);
  const shipKey=crypto.randomUUID();keys.push(shipKey);
  const ship=await post('/api/orders',{customer,mode:'shipping',quoteId:quote,totalCents:1,status:'pago_pronto_envio'},{Cookie:`pc_quote=${owner}`,'Idempotency-Key':shipKey});assert.equal(ship.status,201,JSON.stringify(ship));created.push(ship.data.id);assert.equal(ship.data.status,'aguardando_pagamento');
  const before=await (await fetch(origin+'/api/staff/spreadsheet',{headers:{Cookie:auth}})).text();assert.ok(!before.includes(customer.name));
  const list=await (await fetch(origin+'/api/staff/orders',{headers:{Cookie:auth}})).json();assert.equal(list.orders.find(o=>o.id===ship.data.id).total_cents,2400);
  const denied=await post('/api/staff/orders',{id:ship.data.id,action:'confirm_payment'});assert.equal(denied.status,401);
  const paid=await post('/api/staff/orders',{id:ship.data.id,action:'confirm_payment'},{Cookie:auth});assert.equal(paid.status,200);assert.equal(paid.data.status,'pago_pronto_envio');
  assert.equal((await post('/api/staff/orders',{id:ship.data.id,action:'confirm_payment'},{Cookie:auth})).status,200);
  const csv=await (await fetch(origin+'/api/staff/spreadsheet',{headers:{Cookie:auth}})).text();assert.equal(csv.split(customer.name).length-1,1);assert.ok(csv.includes('pago / pronto para envio'));
  const noToken=await post('/api/quotes',{cep:'01001000',declaredValue:100});assert.equal(noToken.status,503);assert.ok(!noToken.data.quotes);
  console.log('PASS: acesso da equipe, CPF inválido, cofre, persistência, idempotência, cotação expirada/alheia, preço e status protegidos, confirmação manual, planilha só de pagos, ausência de token.');
}finally{
  for(const key of keys){await sql('DELETE FROM order_payments WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key=$1)',[key]);await sql('DELETE FROM shipment_jobs WHERE order_id IN (SELECT id FROM orders WHERE idempotency_key=$1)',[key]);await sql("DELETE FROM orders WHERE idempotency_key=$1 AND customer::json->>'name'='QA local — teste automatizado'",[key]);}
  for(const id of quoteIds)await sql('DELETE FROM quotes WHERE id=$1 AND owner=$2',[id,owner]);
  await sql('DELETE FROM admin_sessions WHERE admin_id=$1',[adminId]);await sql('DELETE FROM admin_accounts WHERE id=$1 AND email=$2',[adminId,adminEmail]);
}
