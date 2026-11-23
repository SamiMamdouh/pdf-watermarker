import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server.mjs';
import { hashPassword, verifyPassword } from '../auth.mjs';

const username='workshop';
const password='correct-test-password-2026';
const passwordHash=await hashPassword(password);
async function app(t,config={}) {
  const server=createApp({username,passwordHash,...config});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const request=(route,options={})=>fetch(base+route,{redirect:'manual',...options});
  const login=(user=username,pass=password,options={})=>request('/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded',...options.headers},body:new URLSearchParams({username:user,password:pass}),...options});
  return {request,login,base};
}
function session(response) {return response.headers.get('set-cookie').split(';')[0];}

test('salted hashes accept the correct password and reject another',async()=>{
  assert.equal(await verifyPassword(password,passwordHash),true);
  assert.equal(await verifyPassword('wrong-password',passwordHash),false);
  assert.notEqual(await hashPassword(password),passwordHash);
  await assert.rejects(hashPassword('short'));
});

test('anonymous visitors cannot get app pages, code, libraries, or font',async t=>{
  const {request}=await app(t);
  for(const route of ['/','/index.html','/app.js','/vendor/pdf-lib.min.js','/vendor/Arabic.ttf']) {
    const response=await request(route);assert.equal(response.status,302,route);assert.equal(response.headers.get('location'),'/login');await response.text();
  }
  const response=await request('/login');assert.equal(response.status,200);const html=await response.text();assert.match(html,/autocomplete="current-password"/);assert.doesNotMatch(html,/correct-test-password|scrypt\$/);
});

test('correct credentials create a cookie and unlock the app',async t=>{
  const {request,login}=await app(t,{secureCookies:true});
  const response=await login();assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Secure/);
  const headers={Cookie:session(response)};
  const page=await request('/',{headers});assert.equal(page.status,200);assert.match(await page.text(),/action="\/logout"/);
  const script=await request('/app.js',{headers});assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);await script.text();
  const loginPage=await request('/login',{headers});assert.equal(loginPage.status,302);await loginPage.text();
  for(const route of ['/server.mjs','/.env','/%2eenv','/package.json']) {const file=await request(route,{headers});assert.equal(file.status,404);await file.text();}
});

test('wrong credentials never issue a session',async t=>{
  const {login}=await app(t);
  for(const [user,pass] of [[username,'wrong'],['not-the-user',password]]) {const r=await login(user,pass);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login?error=credentials');assert.equal(r.headers.get('set-cookie'),null);await r.text();}
});

test('cross-origin and unsupported login requests are rejected',async t=>{
  const {request,base}=await app(t);
  for(const headers of [{Origin:'https://other.example','Content-Type':'application/x-www-form-urlencoded'},{'Content-Type':'application/x-www-form-urlencoded'}]) {
    const r=await request('/login',{method:'POST',headers,body:'username=workshop&password=anything'});assert.equal(r.status,403);await r.text();
  }
  const r=await request('/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,415);await r.text();
});

test('logout revokes the existing session and rejects cross-origin logout',async t=>{
  const {request,login,base}=await app(t);
  const signedIn=await login();const headers={Cookie:session(signedIn),Origin:base,'Content-Type':'application/x-www-form-urlencoded'};
  const cross=await request('/logout',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:''});assert.equal(cross.status,403);await cross.text();
  const signout=await request('/logout',{method:'POST',headers,body:''});assert.equal(signout.status,303);assert.match(signout.headers.get('set-cookie'),/Max-Age=0/);await signout.text();
  const after=await request('/',{headers});assert.equal(after.status,302);await after.text();
});

test('expired and forged session cookies do not unlock app files',async t=>{
  let time=1000;const {request,login}=await app(t,{now:()=>time,sessionMs:2000});
  const response=await login();const cookie=session(response);time+=2001;
  for(const Cookie of [cookie,'ism_session=forged-token']) {const r=await request('/app.js',{headers:{Cookie}});assert.equal(r.status,302);await r.text();}
});

test('login attempt limit expires and successful login works afterwards',async t=>{
  let time=1000;const {login}=await app(t,{now:()=>time,limit:2,windowMs:10000});
  for(let i=0;i<2;i++){const r=await login(username,'wrong');assert.equal(r.status,303);await r.text();}
  const blocked=await login();assert.equal(blocked.status,429);assert.ok(blocked.headers.get('retry-after'));await blocked.text();
  time+=10001;const success=await login();assert.equal(success.status,303);assert.equal(success.headers.get('location'),'/');await success.text();
});

test('oversized form body is rejected',async t=>{
  const {request,base}=await app(t);
  const r=await request('/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:'password='+'a'.repeat(9000)});assert.equal(r.status,413);await r.text();
});

test('production server fails closed without HTTPS origin or credentials',()=>{
  let result=spawnSync(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{NODE_ENV:'production'}});
  assert.equal(result.status,1);assert.match(result.stderr,/APP_ORIGIN/);
  result=spawnSync(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{NODE_ENV:'production',APP_ORIGIN:'https://ism.example.com',APP_USERNAME:username}});
  assert.equal(result.status,1);assert.match(result.stderr,/password/i);
});
