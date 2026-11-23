import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword, validateHash, verifyPassword, sameUsername } from './auth.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'public');
const cookieName = 'ism_session';
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
const cookieToken = req => (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
const escapeHtml = value => value.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function readBody(req) {
  return new Promise((resolve,reject)=>{
    let size=0, chunks=[], rejected=false;
    req.on('data',chunk=>{
      if(rejected) return;
      size+=chunk.length;
      if(size>8192) {rejected=true;chunks=[];reject(Object.assign(new Error('Request too large'),{status:413}));}
      else chunks.push(chunk);
    });
    req.on('end',()=>{if(!rejected)resolve(Buffer.concat(chunks).toString('utf8'));});
    req.on('error',reject);
    req.on('aborted',()=>reject(new Error('Request aborted')));
  });
}

export function createApp(config) {
  const { username, passwordHash, secureCookies=false, origin, trustProxy=false,
    sessionMs=8*60*60*1000, limit=5, windowMs=15*60*1000, now=Date.now } = config;
  if(!username || username.length>128)throw new Error('Set APP_USERNAME to a username of 1–128 characters.');
  validateHash(passwordHash);
  const sessions=new Map(), attempts=new Map();
  let hashesInFlight=0, globalAttempts={count:0,until:0};
  const sessionCookie=(token,seconds)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secureCookies?'; Secure':''}`;
  const redirect=(res,to,status=303)=>{res.writeHead(status,{Location:to});res.end();};
  function sweep() {
    const time=now();
    for(const [token,expiry] of sessions)if(expiry<=time)sessions.delete(token);
    for(const [ip,entry] of attempts)if(entry.until<=time)attempts.delete(ip);
  }
  const timer=setInterval(sweep,60_000);timer.unref();
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    if(secureCookies)res.setHeader('Strict-Transport-Security','max-age=31536000');
    const reply=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(message);};
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/healthz' && (req.method==='GET'||req.method==='HEAD'))return reply(200,'ok');
      if(!['GET','HEAD','POST'].includes(req.method)){res.setHeader('Allow','GET, HEAD, POST');return reply(405,'Method not allowed');}
      if(req.method==='POST') {
        const expected=origin || `http://${req.headers.host}`;
        if(req.headers.origin!==expected || req.headers['sec-fetch-site']==='cross-site')return reply(403,'This request must come from this website.');
        if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,'Unsupported form format');
      }
      const token=cookieToken(req);
      const expiry=token && sessions.get(token);
      const authenticated=Boolean(expiry && expiry>now());
      if(expiry && !authenticated)sessions.delete(token);
      if(pathname==='/login' && req.method==='POST') {
        sweep();
        const forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
        const ip=trustProxy && forwarded ? forwarded : req.socket.remoteAddress || 'unknown';
        let attempt=attempts.get(ip);
        if(!attempt){if(attempts.size>=10000)return reply(429,'Too many login attempts. Please try again later.');attempt={count:0,until:now()+windowMs};attempts.set(ip,attempt);}
        if(globalAttempts.until<=now())globalAttempts={count:0,until:now()+windowMs};
        if(attempt.count>=limit || globalAttempts.count>=200 || hashesInFlight>=4){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((attempt.until-now())/1000))));return reply(429,'Too many login attempts. Please try again in 15 minutes.');}
        const fields=new URLSearchParams(await readBody(req));
        const suppliedUsername=fields.get('username')||'', password=fields.get('password')||'';
        if(suppliedUsername.length>128 || Buffer.byteLength(password)>1024)return redirect(res,'/login?error=credentials');
        if(attempt.count>=limit || globalAttempts.count>=200 || hashesInFlight>=4){res.setHeader('Retry-After','900');return reply(429,'Too many login attempts. Please try again later.');}
        // Count before awaiting scrypt so simultaneous requests cannot evade the limit.
        attempt.count++;globalAttempts.count++;hashesInFlight++;
        let validPassword;
        try{validPassword=await verifyPassword(password,passwordHash);}finally{hashesInFlight--;}
        const validUsername=sameUsername(suppliedUsername,username);
        if(!validUsername || !validPassword)return redirect(res,'/login?error=credentials');
        attempts.delete(ip);
        if(token)sessions.delete(token);
        if(sessions.size>=10000)return reply(503,'Please try signing in again later.');
        const newToken=randomBytes(32).toString('base64url');sessions.set(newToken,now()+sessionMs);
        res.setHeader('Set-Cookie',sessionCookie(newToken,Math.floor(sessionMs/1000)));
        return redirect(res,'/');
      }
      if(pathname==='/logout' && req.method==='POST') {
        if(token)sessions.delete(token);
        res.setHeader('Set-Cookie',sessionCookie('',0));return redirect(res,'/login?loggedout=1');
      }
      if(req.method==='POST')return reply(404,'Not found');
      if(pathname==='/login') {
        if(authenticated)return redirect(res,'/',302);
        const query=new URL(req.url,'http://localhost').searchParams;
        const message=query.has('error')?'The username or password is incorrect.':query.has('loggedout')?'You have signed out.':'';
        const html=(await readFile(path.join(root,'login.html'),'utf8')).replace('{{MESSAGE}}',escapeHtml(message));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:html);
      }
      if(pathname==='/login.css') {
        res.writeHead(200,{'Content-Type':'text/css; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:await readFile(path.join(root,'login.css')));
      }
      if(!authenticated)return redirect(res,'/login',302);
      const decoded=decodeURIComponent(pathname);
      if(decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part=>part.startsWith('.')))return reply(404,'Not found');
      const filename=path.resolve(publicRoot,decoded==='/'?'index.html':`.${decoded}`);
      if(!filename.startsWith(publicRoot+path.sep))return reply(404,'Not found');
      let info;try{info=await stat(filename);}catch{return reply(404,'Not found');}
      if(!info.isFile())return reply(404,'Not found');
      const data=await readFile(filename);
      res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Content-Length':data.length});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(error){if(!res.headersSent)reply(error.status||500,error.status===413?'Request too large':'Unable to complete this request.');else res.end();}
  });
  server.headersTimeout=15_000;server.requestTimeout=30_000;
  server.on('close',()=>clearInterval(timer));
  return server;
}

async function start() {
  const envFile=path.join(root,'.env');if(existsSync(envFile))process.loadEnvFile(envFile);
  const production=process.env.NODE_ENV==='production';
  const origin=process.env.APP_ORIGIN;
  if(production && (!origin || new URL(origin).protocol!=='https:' || new URL(origin).origin!==origin))throw new Error('Set APP_ORIGIN to the exact HTTPS origin, such as https://your-app.example.com (no trailing slash).');
  const passwordHash=process.env.APP_PASSWORD_HASH ? validateHash(process.env.APP_PASSWORD_HASH) : await hashPassword(process.env.APP_PASSWORD);
  const port=Number(process.env.PORT||3000);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer between 1 and 65535.');
  const server=createApp({username:process.env.APP_USERNAME,passwordHash,origin,secureCookies:production,trustProxy:process.env.TRUST_PROXY==='true'});
  server.listen(port,process.env.HOST||(production?'0.0.0.0':'127.0.0.1'),()=>console.log(`Ism is ready on port ${port}${production?' (production)':' — open http://127.0.0.1:'+port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start().catch(error=>{console.error(`Cannot start Ism: ${error.message}`);process.exitCode=1;});
