/* Service worker de Alimentos Sanos. Al publicar una versión nueva, subir VERSION (y version.json y APP_VERSION en app.js).
   Nunca toca IndexedDB: los datos del usuario sobreviven a las actualizaciones. */
const VERSION='1.0.3';
const CACHE='md-shell-'+VERSION;
const IMG_CACHE='md-img';
const SHELL=['./','./index.html','./app.css','./app.js','./db.js','./html5-qrcode.min.js','./manifest.json','./icon-192.png','./icon-512.png','./icon-maskable.png','./apple-touch-icon.png','./favicon.ico','./header-icon.png','./nutrition.js','./ocr.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('md-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data==='skipWaiting')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin===location.origin){
    if(url.pathname.endsWith('version.json'))return; // siempre red
    // Red primero para la app: así cada versión nueva llega sola; caché si no hay conexión.
    e.respondWith(fetch(req,{cache:'no-cache'}).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp))}return r}).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
    return;
  }
  // Lector de etiquetas (Tesseract.js, motor e idiomas desde jsDelivr): caché primero, así funciona sin conexión tras el 1er uso
  if(url.hostname==='cdn.jsdelivr.net'&&/tesseract/.test(url.pathname)){
    e.respondWith(caches.open('md-ocr').then(c=>c.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok||r.type==='opaque')c.put(req,r.clone());return r}))));return;
  }
  // Fotos de productos de Open Food Facts: caché primero para verlas sin conexión.
  if(/images\.open(food|beauty)facts\.org$/.test(url.hostname)||/static\.open(food|beauty)facts\.org$/.test(url.hostname)){
    e.respondWith(caches.open(IMG_CACHE).then(c=>c.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok||r.type==='opaque')c.put(req,r.clone());return r}).catch(()=>hit))));
  }
});
