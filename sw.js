// تحديث الـ Service Worker بيغيّر الكاش بس — قاعدة البيانات (IndexedDB) مش بتتلمس أبداً
const VER='v1';
const SHELL=['./','index.html','manifest.json','icon.svg','css/app.css','js/db.js','js/auth.js','js/app.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open('alr-shell-'+VER).then(c=>c.addAll(SHELL)));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('alr-shell-')&&k!=='alr-shell-'+VER).map(k=>caches.delete(k)))));});
self.addEventListener('message',e=>{if(e.data==='skipWaiting')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
    if(res.ok&&new URL(e.request.url).origin===location.origin){const cp=res.clone();caches.open('alr-shell-'+VER).then(c=>c.put(e.request,cp));}
    return res;}).catch(()=>caches.match('index.html'))));
});
