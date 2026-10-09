// تحديث الـ Service Worker بيغيّر الكاش بس — قاعدة البيانات (IndexedDB) مش بتتلمس أبداً
const VER='v2', SHELL_CACHE='alr-shell-'+VER, IMG_CACHE='alr-img-v1';
const SHELL=['./','index.html','manifest.json','icon.svg','products.json','css/app.css','js/db.js','js/auth.js','js/ui.js','js/products.js','js/app.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(SHELL_CACHE).then(c=>c.addAll(SHELL)))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  for(const k of await caches.keys()) if(k.startsWith('alr-shell-')&&k!==SHELL_CACHE) await caches.delete(k);
  await self.clients.claim()})())});
const timeout=(ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms));
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin===location.origin){
    // أونلاين: أحدث نسخة (مع مهلة 3 ثواني)، أوفلاين: من الكاش
    e.respondWith((async()=>{
      try{const res=await Promise.race([fetch(req),timeout(3000)]);
        if(res.ok){const cp=res.clone();caches.open(SHELL_CACHE).then(c=>c.put(req,cp))}return res}
      catch{return (await caches.match(req))||(await caches.match('index.html'))}})());
  }else if(req.destination==='image'){
    // صور المنتجات: كاش أولاً، وبتتحفظ عند أول عرض (لو الموقع المصدر سمح بـ CORS)
    e.respondWith((async()=>{
      const c=await caches.open(IMG_CACHE),hit=await c.match(req.url);if(hit)return hit;
      try{const res=await fetch(req.url,{mode:'cors',referrerPolicy:'no-referrer'});
        if(res.ok){c.put(req.url,res.clone());return res}}catch{}
      try{return await fetch(req)}catch{return Response.error()}})());
  }
});
