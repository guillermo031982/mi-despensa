/* Alimentos Sanos — complemento personal a Yuka. Vanilla JS, datos en IndexedDB (db.js). */
const APP_VERSION='1.0.1';
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const view=$('#view');
let scanner=null, pending=null; // pending = producto consultado aún sin guardar

const DEFAULT_CATS=[['Embutidos','🥓','#dc2626'],['Yogures','🥛','#2563eb'],['Quesos','🧀','#f59e0b'],['Bebidas','🧃','#0891b2'],['Snacks y dulces','🍫','#9333ea'],['Conservas','🥫','#ea580c'],['Cosmética','🧴','#db2777'],['Limpieza','🧽','#0d9488']];
const COLORS=['#16a34a','#dc2626','#2563eb','#f59e0b','#0891b2','#9333ea','#ea580c','#db2777','#0d9488','#4b5563'];
const VERD={bueno:'👍 Bueno',regular:'😐 Regular',evitar:'👎 Evitar'};
const ALLERG={milk:'Leche',gluten:'Gluten',eggs:'Huevo',nuts:'Frutos de cáscara',peanuts:'Cacahuete',soybeans:'Soja',fish:'Pescado',crustaceans:'Crustáceos',molluscs:'Moluscos',celery:'Apio',mustard:'Mostaza','sesame-seeds':'Sésamo','sulphur-dioxide-and-sulphites':'Sulfitos',lupin:'Altramuces'};
const NOVA={1:'Sin procesar o mínimamente procesado',2:'Ingrediente culinario procesado',3:'Alimento procesado',4:'Ultraprocesado'};

function toast(m,ms=2200){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,ms)}
function setTitle(t,back){$('#title').textContent=t;$('#backBtn').hidden=!back}
$('#backBtn').onclick=()=>history.length>1?history.back():location.hash='#/';
function tab(n){document.querySelectorAll('.tabs a').forEach(a=>a.classList.toggle('on',a.dataset.tab===n))}

async function cats(){return (await DB.all('cats')).sort((a,b)=>(a.order??0)-(b.order??0)||a.name.localeCompare(b.name))}
async function prods(){return DB.all('prods')}
async function ensureDefaults(){
  if(localStorage.getItem('md-init'))return;
  const ex=await DB.all('cats');
  if(!ex.length)await DB.bulkPut('cats',DEFAULT_CATS.map(([name,emoji,color],i)=>({id:uid(),name,emoji,color,order:i})));
  localStorage.setItem('md-init','1');
}

/* ---------- Open Food Facts ---------- */
const FIELDS='code,product_name,product_name_es,generic_name_es,brands,quantity,image_front_url,image_url,image_front_small_url,ingredients_text_es,ingredients_text,nutriscore_grade,nova_group,ecoscore_grade,additives_tags,allergens_tags,traces_tags,categories,labels';
async function lookup(code){
  for(const [src,host] of [['off','world.openfoodfacts.org'],['obf','world.openbeautyfacts.org']]){
    try{
      const r=await fetch(`https://${host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}&lc=es`);
      if(!r.ok&&r.status!==404)continue;
      const j=await r.json();
      if(j.status===1&&j.product)return normalize(j.product,code,src);
    }catch(e){if(!navigator.onLine)throw new Error('offline')}
  }
  return null;
}
function normalize(p,code,src){
  const g=v=>v&&v!=='unknown'&&v!=='not-applicable'?v:'';
  return {code:p.code||code,src,name:p.product_name_es||p.product_name||p.generic_name_es||'',brand:(p.brands||'').split(',')[0].trim(),quantity:p.quantity||'',
    image:p.image_front_url||p.image_url||p.image_front_small_url||'',ingredients:p.ingredients_text_es||p.ingredients_text||'',
    nutriscore:g(p.nutriscore_grade),nova:p.nova_group||'',ecoscore:g(p.ecoscore_grade),
    additives:(p.additives_tags||[]).map(t=>t.replace(/^\w\w:/,'').toUpperCase()),
    allergens:(p.allergens_tags||[]).map(t=>{const k=t.replace(/^\w\w:/,'');return ALLERG[k]||k}),
    traces:(p.traces_tags||[]).map(t=>{const k=t.replace(/^\w\w:/,'');return ALLERG[k]||k}),
    offCategories:p.categories||'',labels:p.labels||''};
}
async function searchOnline(q){
  // 1º buscador nuevo de OFF (search-a-licious), 2º buscador clásico
  try{const r=await fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=24&langs=es&fields=code,product_name,product_name_es,brands,image_front_small_url,nutriscore_grade`);
    if(r.ok){const j=await r.json();return (j.hits||[]).map(h=>({...h,brands:Array.isArray(h.brands)?h.brands.join(', '):h.brands}))}}catch(e){}
  const u=`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&lc=es&fields=code,product_name,product_name_es,brands,image_front_small_url,nutriscore_grade`;
  const r=await fetch(u);if(!r.ok)throw new Error('http '+r.status);return (await r.json()).products||[];
}
/* ---------- Componentes ---------- */
const nsBadge=g=>g&&/^[a-e]$/.test(g)?`<span class="badge ns ns-${g}">Nutri-Score ${g.toUpperCase()}</span>`:'';
const novaBadge=n=>n?`<span class="badge nova${n}">NOVA ${n}</span>`:'';
const vBadge=v=>v?`<span class="badge v-${v}">${VERD[v]}</span>`:'';
const starsTxt=n=>n?'★'.repeat(n)+'☆'.repeat(5-n):'';
function imgOf(p){return p.photo||p.image||''}
function pItem(p,catMap){
  const im=imgOf(p);const c=catMap&&catMap[p.cat];
  return `<a class="pitem" href="#/p/${p.id}">${im?`<img loading="lazy" src="${esc(im)}" alt="">`:`<div class="noimg">📦</div>`}
  <div class="info"><b>${esc(p.name||'(sin nombre)')}</b><small>${esc(p.brand||'')}${c?` · ${esc(c.emoji||'')} ${esc(c.name)}`:''}${p.rating?` · <span style="color:#f59e0b">${starsTxt(p.rating)}</span>`:''}</small>
  <div class="badges">${vBadge(p.verdict)}${nsBadge(p.nutriscore)}${novaBadge(p.nova)}</div></div></a>`;
}
function infoBlock(p){
  const sc=[];
  if(p.nutriscore)sc.push(`<div class="score ns-${p.nutriscore} ${p.nutriscore?'ns':''}"><b>${p.nutriscore.toUpperCase()}</b>Nutri-Score</div>`);
  if(p.nova)sc.push(`<div class="score nova${p.nova}"><b>${p.nova}</b>NOVA</div>`);
  if(p.ecoscore&&/^[a-e]$/.test(p.ecoscore))sc.push(`<div class="score"><b>${p.ecoscore.toUpperCase()}</b>Eco-Score</div>`);
  sc.push(`<div class="score"><b>${(p.additives||[]).length}</b>Aditivos</div>`);
  return `<div class="card"><div class="hero">${imgOf(p)?`<img src="${esc(imgOf(p))}" alt="">`:''}<div><h3>${esc(p.name||'(sin nombre)')}</h3><div class="muted">${esc(p.brand||'')}${p.quantity?' · '+esc(p.quantity):''}</div>
  ${p.code?`<div class="muted" style="font-size:13px;margin-top:4px">Código: ${esc(p.code)}</div>`:''}
  <div class="muted" style="font-size:12px;margin-top:2px">${p.src==='off'?'Datos: Open Food Facts':p.src==='obf'?'Datos: Open Beauty Facts':'Añadido a mano'}</div></div></div>
  ${p.src!=='manual'?`<div class="scores">${sc.join('')}</div>`:''}
  ${p.nova?`<div class="muted" style="font-size:14px">NOVA ${p.nova}: ${NOVA[p.nova]||''}</div>`:''}</div>
  ${p.src!=='manual'?`
  <details ${p.ingredients?'':''}><summary>🧾 Ingredientes</summary><p class="list-add">${esc(p.ingredients||'No disponible')}</p></details>
  <details><summary>🧪 Aditivos (${(p.additives||[]).length})</summary><p class="list-add">${(p.additives||[]).length?p.additives.map(a=>`<span class="badge" style="margin:2px;display:inline-block">${esc(a)}</span>`).join(' '):'Ninguno declarado'}</p></details>
  <details><summary>⚠️ Alérgenos</summary><p class="list-add">${(p.allergens||[]).length?esc(p.allergens.join(', ')):'Ninguno declarado'}${(p.traces||[]).length?`<br><b>Trazas:</b> ${esc(p.traces.join(', '))}`:''}</p></details>`:''}`;
}

/* Formulario guardar/editar (categoría, valoración, veredicto, notas) */
async function saveForm(p,isNew){
  const cs=await cats();
  return `<div class="card"><h3 style="margin:0 0 4px">${isNew?'Guardar en mis productos':'Mi clasificación'}</h3>
  ${p.src==='manual'||!isNew?`<label>Nombre</label><input id="f-name" value="${esc(p.name)}" placeholder="Nombre del producto">
  <label>Marca</label><input id="f-brand" value="${esc(p.brand||'')}" placeholder="Marca (opcional)">`:''}
  <label>Categoría</label><div class="row"><select id="f-cat"><option value="">Sin categoría</option>${cs.map(c=>`<option value="${c.id}" ${c.id===p.cat?'selected':''}>${esc((c.emoji||'')+' '+c.name)}</option>`).join('')}</select>
  <button class="btn sec" style="flex:none" id="f-newcat" type="button">＋ Nueva</button></div>
  <label>Mi valoración</label><div class="stars" id="f-stars">${[1,2,3,4,5].map(i=>`<button type="button" data-v="${i}" class="${(p.rating||0)>=i?'on':''}" aria-label="${i} estrellas">★</button>`).join('')}</div>
  <label>Veredicto</label><div class="chips" id="f-verd">${Object.entries(VERD).map(([k,v])=>`<button type="button" class="chip v-${k} ${p.verdict===k?'on':''}" data-v="${k}">${v}</button>`).join('')}</div>
  <label>Foto propia ${p.photo?'':'(opcional)'}</label>
  <input type="file" id="f-photo" accept="image/*" capture="environment">
  ${p.photo?`<img class="photo-prev" id="f-prev" src="${p.photo}">`:'<img class="photo-prev" id="f-prev" hidden>'}
  <label>Notas</label><textarea id="f-notes" placeholder="Dónde lo compro, precio, sabor, por qué sí o no...">${esc(p.notes||'')}</textarea>
  <div style="height:12px"></div><button class="btn block" id="f-save">💾 ${isNew?'Guardar':'Guardar cambios'}</button></div>`;
}
function bindForm(p,onSaved){
  let rating=p.rating||0,verdict=p.verdict||'',photo=p.photo||'';
  $('#f-stars').onclick=e=>{const b=e.target.closest('button');if(!b)return;const v=+b.dataset.v;rating=rating===v?0:v;[...$('#f-stars').children].forEach(x=>x.classList.toggle('on',+x.dataset.v<=rating))};
  $('#f-verd').onclick=e=>{const b=e.target.closest('button');if(!b)return;verdict=verdict===b.dataset.v?'':b.dataset.v;[...$('#f-verd').children].forEach(x=>x.classList.toggle('on',x.dataset.v===verdict))};
  $('#f-photo').onchange=async e=>{const f=e.target.files[0];if(!f)return;photo=await shrink(f);const pv=$('#f-prev');pv.src=photo;pv.hidden=false};
  $('#f-newcat').onclick=async()=>{const c=await editCat();if(c){const s=$('#f-cat');s.add(new Option((c.emoji||'')+' '+c.name,c.id));s.value=c.id}};
  $('#f-save').onclick=async()=>{
    const o={...p};
    if($('#f-name'))o.name=$('#f-name').value.trim();
    if($('#f-brand'))o.brand=$('#f-brand').value.trim();
    if(!o.name){toast('Ponle un nombre');return}
    o.cat=$('#f-cat').value||null;o.rating=rating;o.verdict=verdict;o.photo=photo;o.notes=$('#f-notes').value.trim();
    o.id=o.id||uid();o.created=o.created||Date.now();o.updated=Date.now();
    await DB.put('prods',o);toast('✓ Guardado');onSaved(o);
  };
}
function shrink(file,max=900){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>{const k=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(img.src);res(c.toDataURL('image/jpeg',.78))};img.onerror=rej;img.src=URL.createObjectURL(file)})}

/* Modal genérico */
function sheet(html){const m=$('#modal');m.innerHTML=`<div class="sheet">${html}</div>`;m.hidden=false;m.onclick=e=>{if(e.target===m)closeSheet()};return m}
function closeSheet(){const m=$('#modal');m.hidden=true;m.innerHTML=''}
function editCat(c){return new Promise(res=>{
  const isNew=!c;c=c||{name:'',emoji:'📦',color:COLORS[0]};
  sheet(`<h3>${isNew?'Nueva categoría':'Editar categoría'}</h3><label>Nombre</label><input id="c-name" value="${esc(c.name)}" placeholder="Ej. Embutidos">
  <label>Emoji</label><input id="c-emo" value="${esc(c.emoji||'')}" maxlength="4" style="font-size:24px">
  <label>Color</label><div class="chips" id="c-col">${COLORS.map(x=>`<button type="button" class="chip ${x===c.color?'on':''}" data-c="${x}" style="background:${x};width:46px;padding:0;${x===c.color?'outline:3px solid #111':''}"></button>`).join('')}</div>
  <div style="height:16px"></div><div class="row"><button class="btn ghost" id="c-cancel">Cancelar</button><button class="btn" id="c-ok">Guardar</button></div>`);
  let col=c.color;
  $('#c-col').onclick=e=>{const b=e.target.closest('button');if(!b)return;col=b.dataset.c;[...$('#c-col').children].forEach(x=>x.style.outline=x.dataset.c===col?'3px solid #111':'')};
  $('#c-cancel').onclick=()=>{closeSheet();res(null)};
  $('#c-ok').onclick=async()=>{const name=$('#c-name').value.trim();if(!name){toast('Escribe un nombre');return}
    const all=await DB.all('cats');const o={...c,id:c.id||uid(),name,emoji:$('#c-emo').value.trim(),color:col,order:c.order??all.length};await DB.put('cats',o);closeSheet();res(o)};
  setTimeout(()=>$('#c-name').focus(),50);
})}

/* ---------- Vistas ---------- */
async function vHome(){
  setTitle('Alimentos Sanos');tab('home');
  const [cs,ps]=await Promise.all([cats(),prods()]);
  const count={};ps.forEach(p=>count[p.cat||'']=(count[p.cat||'']||0)+1);
  const recent=ps.sort((a,b)=>b.updated-a.updated).slice(0,5);const cm=Object.fromEntries(cs.map(c=>[c.id,c]));
  view.innerHTML=`<div class="search"><input id="q" type="search" placeholder="Buscar en mis productos" enterkeyhint="search"></div>
  <div class="row" style="margin-bottom:6px"><a class="btn" href="#/scan">📷 Escanear</a><a class="btn sec" href="#/manual">✍️ Añadir a mano</a></div>
  <h2>Mis categorías <span class="muted" style="font-weight:400">(${ps.length} productos)</span></h2>
  <div class="grid">${cs.map(c=>`<a class="cat" href="#/cat/${c.id}" style="--c:${c.color}"><span class="emo">${esc(c.emoji||'📦')}</span><div><b>${esc(c.name)}</b><br><small>${count[c.id]||0} producto${(count[c.id]||0)===1?'':'s'}</small></div></a>`).join('')}
  ${count['']?`<a class="cat" href="#/cat/none" style="--c:#9ca3af"><span class="emo">🗂️</span><div><b>Sin categoría</b><br><small>${count['']} productos</small></div></a>`:''}
  <a class="cat" href="#" id="addCat" style="--c:#d1d5db;align-items:center;justify-content:center;color:var(--g)"><span class="emo">＋</span><b>Nueva categoría</b></a></div>
  ${recent.length?`<h2>Últimos guardados</h2><div class="plist">${recent.map(p=>pItem(p,cm)).join('')}</div>`:`<div class="empty"><div class="big">🛒</div>Escanea tu primer producto y guárdalo en una categoría.</div>`}`;
  $('#addCat').onclick=async e=>{e.preventDefault();if(await editCat())vHome()};
  $('#q').addEventListener('keydown',e=>{if(e.key==='Enter')location.hash='#/buscar?q='+encodeURIComponent(e.target.value)});
}

async function vCat(id){
  tab('home');
  const cs=await cats();const c=id==='none'?{id:'none',name:'Sin categoría',emoji:'🗂️'}:cs.find(x=>x.id===id);
  if(!c){location.hash='#/';return}
  setTitle(`${c.emoji||''} ${c.name}`,true);
  const all=(await prods()).filter(p=>id==='none'?!p.cat||!cs.some(x=>x.id===p.cat):p.cat===id);
  const st=JSON.parse(sessionStorage.getItem('md-sort')||'{"s":"recent","f":"","q":""}');
  view.innerHTML=`<div class="search"><input id="q" type="search" placeholder="Filtrar en ${esc(c.name)}" value="${esc(st.q)}"></div>
  <div class="toolbar"><select id="s"><option value="recent">Más recientes</option><option value="name">Nombre A-Z</option><option value="rating">Mejor valorados</option><option value="ns">Nutri-Score</option><option value="brand">Marca</option></select>
  <select id="f"><option value="">Todos</option><option value="bueno">👍 Buenos</option><option value="regular">😐 Regulares</option><option value="evitar">👎 Evitar</option></select></div>
  <div class="plist" id="list"></div>
  ${id!=='none'?`<div style="height:18px"></div><div class="row"><button class="btn ghost" id="ren">✏️ Editar categoría</button><button class="btn danger" id="del">🗑️ Borrar</button></div>`:''}
  <a class="fab" href="#/scan?cat=${id}" aria-label="Escanear">📷</a>`;
  $('#s').value=st.s;$('#f').value=st.f;
  const draw=()=>{const q=$('#q').value.trim().toLowerCase(),s=$('#s').value,f=$('#f').value;sessionStorage.setItem('md-sort',JSON.stringify({s,f,q}));
    let l=all.filter(p=>(!f||p.verdict===f)&&(!q||[p.name,p.brand,p.notes,p.code].join(' ').toLowerCase().includes(q)));
    const cmp={recent:(a,b)=>b.updated-a.updated,name:(a,b)=>(a.name||'').localeCompare(b.name||''),brand:(a,b)=>(a.brand||'').localeCompare(b.brand||''),rating:(a,b)=>(b.rating||0)-(a.rating||0),ns:(a,b)=>(a.nutriscore||'z').localeCompare(b.nutriscore||'z')}[s];
    l.sort(cmp);$('#list').innerHTML=l.length?l.map(p=>pItem(p)).join(''):`<div class="empty"><div class="big">${esc(c.emoji||'📦')}</div>${all.length?'Nada coincide con el filtro.':'Aún no hay productos aquí. Pulsa 📷 para escanear uno.'}</div>`};
  ['q','s','f'].forEach(k=>$('#'+k).addEventListener('input',draw));draw();
  if(id!=='none'){
    $('#ren').onclick=async()=>{if(await editCat(c))vCat(id)};
    $('#del').onclick=async()=>{if(!confirm(`¿Borrar la categoría "${c.name}"? Sus ${all.length} productos pasarán a "Sin categoría" (no se borran).`))return;
      for(const p of all){p.cat=null;await DB.put('prods',p)}await DB.del('cats',id);toast('Categoría borrada');location.hash='#/'};
  }
}

async function vScan(params){
  setTitle('Escanear',true);tab('scan');
  view.innerHTML=`<div id="reader"></div><p class="muted" style="text-align:center;margin:8px 0" id="scanMsg">Apunta al código de barras del producto</p>
  <div class="card"><label style="margin-top:0">¿No lee el código? Escríbelo</label><div class="row"><input id="code" inputmode="numeric" pattern="[0-9]*" placeholder="Ej. 3017620422003"><button class="btn" style="flex:none" id="go">Buscar</button></div>
  <label>O busca por nombre</label><div class="row"><input id="name" type="search" placeholder="Ej. yogur griego"><button class="btn sec" style="flex:none" id="goName">Buscar</button></div></div>
  <a class="btn ghost block" href="#/manual">✍️ No está: añadirlo a mano</a>`;
  const go=c=>{c=String(c).replace(/\D/g,'');if(c.length<6){toast('Código no válido');return}stopScan();location.hash=`#/lookup/${c}${params.get('cat')?'?cat='+params.get('cat'):''}`};
  $('#go').onclick=()=>go($('#code').value);$('#code').onkeydown=e=>{if(e.key==='Enter')go(e.target.value)};
  const gn=()=>{const q=$('#name').value.trim();if(q){stopScan();location.hash='#/buscar?online=1&q='+encodeURIComponent(q)}};
  $('#goName').onclick=gn;$('#name').onkeydown=e=>{if(e.key==='Enter')gn()};
  startScan(go);
}
async function startScan(onCode){
  if(!window.Html5Qrcode){$('#scanMsg').textContent='Cargando escáner…';await new Promise(r=>setTimeout(r,600));if(!window.Html5Qrcode)return}
  if(!window.isSecureContext){$('#scanMsg').textContent='La cámara necesita HTTPS';return}
  try{
    const F=Html5QrcodeSupportedFormats;
    scanner=new Html5Qrcode('reader',{formatsToSupport:[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.ITF],useBarCodeDetectorIfSupported:true,verbose:false});
    let done=false;
    await scanner.start({facingMode:'environment'},{fps:12,qrbox:(w,h)=>({width:Math.min(w*0.85,340),height:Math.min(h*0.5,170)}),aspectRatio:1.333},
      txt=>{if(done)return;done=true;navigator.vibrate&&navigator.vibrate(80);onCode(txt)},()=>{});
  }catch(e){console.warn(e);$('#scanMsg').innerHTML='⚠️ No se pudo abrir la cámara. Revisa el permiso de cámara del navegador o escribe el código abajo.';$('#reader').style.minHeight='0'}
}
async function stopScan(){const s=scanner;scanner=null;if(s){try{if(s.isScanning)await s.stop();s.clear()}catch(e){}}}

async function vLookup(code,params){
  setTitle('Producto',true);tab('scan');
  const existing=(await prods()).find(p=>p.code===code);
  view.innerHTML=`<div class="empty"><div class="big">⏳</div>Buscando ${esc(code)} en Open Food Facts…</div>`;
  let p;try{p=await lookup(code)}catch(e){view.innerHTML=`<div class="empty"><div class="big">📡</div>Sin conexión. Conéctate para consultar el producto.</div><a class="btn ghost block" href="#/manual?code=${code}">✍️ Añadirlo a mano</a>`;return}
  if(!p){view.innerHTML=`<div class="empty"><div class="big">🤷</div>El código <b>${esc(code)}</b> no está en Open Food Facts ni en Open Beauty Facts.</div><a class="btn block" href="#/manual?code=${code}">✍️ Añadirlo a mano</a><div style="height:10px"></div><a class="btn ghost block" href="#/scan">📷 Escanear otro</a>`;return}
  if(existing){view.innerHTML=infoBlock(p)+`<div class="card"><b>Ya lo tienes guardado.</b><div style="height:10px"></div><a class="btn block" href="#/p/${existing.id}">Ver mi ficha</a><div style="height:8px"></div><button class="btn sec block" id="refresh">🔄 Actualizar datos de la base</button></div>`;
    $('#refresh').onclick=async()=>{const {photo,notes,rating,verdict,cat,id,created,name}=existing;await DB.put('prods',{...p,photo,notes,rating,verdict,cat,id,created,name:p.name||name,updated:Date.now()});toast('✓ Datos actualizados');location.hash='#/p/'+id};return}
  p.cat=params.get('cat')&&params.get('cat')!=='none'?params.get('cat'):(localStorage.getItem('md-lastcat')||null);
  view.innerHTML=infoBlock(p)+await saveForm(p,true)+`<a class="btn ghost block" href="#/scan">📷 Escanear otro</a>`;
  bindForm(p,o=>{if(o.cat)localStorage.setItem('md-lastcat',o.cat);location.hash='#/p/'+o.id});
}

async function vProduct(id){
  tab('home');const p=await DB.get('prods',id);if(!p){location.hash='#/';return}
  setTitle(p.name||'Producto',true);
  view.innerHTML=infoBlock(p)+(p.notes?`<div class="card"><b>📝 Mis notas</b><p style="white-space:pre-wrap;margin:6px 0 0">${esc(p.notes)}</p></div>`:'')+await saveForm(p,false)+
  `<div class="row">${p.code&&p.src!=='manual'?`<a class="btn ghost" href="https://world.${p.src==='obf'?'openbeautyfacts':'openfoodfacts'}.org/product/${esc(p.code)}" target="_blank" rel="noopener">🌐 Ver en ${p.src==='obf'?'OBF':'OFF'}</a>`:''}<button class="btn danger" id="pdel">🗑️ Borrar</button></div>`;
  bindForm(p,()=>vProduct(id));
  $('#pdel').onclick=async()=>{if(confirm('¿Borrar este producto de tu despensa?')){await DB.del('prods',id);toast('Borrado');history.back()}};
}

async function vManual(params){
  setTitle('Añadir a mano',true);tab('scan');
  const p={src:'manual',code:params.get('code')||'',name:'',brand:'',cat:localStorage.getItem('md-lastcat')||null};
  view.innerHTML=`<div class="card"><label style="margin-top:0">Código de barras (opcional)</label><input id="m-code" inputmode="numeric" value="${esc(p.code)}" placeholder="Si lo tiene"></div>`+await saveForm(p,true);
  bindForm(p,o=>{if(o.cat)localStorage.setItem('md-lastcat',o.cat);location.hash='#/p/'+o.id});
  // el código se lee antes de guardar
  const sv=$('#f-save'),orig=sv.onclick;sv.onclick=()=>{p.code=$('#m-code').value.replace(/\D/g,'');return orig()};
}

async function vBuscar(params){
  setTitle('Buscar');tab('buscar');
  const q0=params.get('q')||'';let online=params.get('online')==='1';
  view.innerHTML=`<div class="search"><input id="q" type="search" placeholder="Nombre, marca, notas o código" value="${esc(q0)}" enterkeyhint="search"></div>
  <div class="chips" style="margin-bottom:12px"><button class="chip" id="t-local">📦 Mis productos</button><button class="chip" id="t-online">🌐 Open Food Facts</button></div><div id="res"></div>`;
  const [cs,ps]=await Promise.all([cats(),prods()]);const cm=Object.fromEntries(cs.map(c=>[c.id,c]));
  const draw=async()=>{
    $('#t-local').classList.toggle('on',!online);$('#t-online').classList.toggle('on',online);
    const q=$('#q').value.trim().toLowerCase();const res=$('#res');
    if(!online){const l=ps.filter(p=>!q||[p.name,p.brand,p.notes,p.code,cm[p.cat]?.name].join(' ').toLowerCase().includes(q)).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
      res.innerHTML=l.length?`<div class="muted" style="margin-bottom:8px">${l.length} resultado${l.length===1?'':'s'}</div><div class="plist">${l.map(p=>pItem(p,cm)).join('')}</div>`:`<div class="empty"><div class="big">🔎</div>${ps.length?'Nada coincide.':'Aún no tienes productos guardados.'}</div>`;return}
    if(q.length<2){res.innerHTML='<div class="empty">Escribe al menos 2 letras y pulsa buscar.</div>';return}
    res.innerHTML='<div class="empty"><div class="big">⏳</div>Buscando en Open Food Facts…</div>';
    try{const l=await searchOnline(q);res.innerHTML=l.length?`<div class="plist">${l.map(p=>`<a class="pitem" href="#/lookup/${esc(p.code)}">${p.image_front_small_url?`<img loading="lazy" src="${esc(p.image_front_small_url)}">`:'<div class="noimg">📦</div>'}<div class="info"><b>${esc(p.product_name_es||p.product_name||'(sin nombre)')}</b><small>${esc(p.brands||'')} · ${esc(p.code)}</small><div class="badges">${nsBadge(p.nutriscore_grade)}</div></div></a>`).join('')}</div>`:'<div class="empty">Sin resultados.</div>'}
    catch(e){res.innerHTML='<div class="empty"><div class="big">📡</div>No se pudo buscar (¿sin conexión?). La búsqueda de Open Food Facts a veces va lenta: reinténtalo.</div>'}
  };
  $('#t-local').onclick=()=>{online=false;draw()};$('#t-online').onclick=()=>{online=true;draw()};
  let t;$('#q').addEventListener('input',()=>{if(!online){clearTimeout(t);t=setTimeout(draw,150)}});
  $('#q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.target.blur();draw()}});
  draw();
}

async function vAjustes(){
  setTitle('Ajustes');tab('ajustes');
  const [cs,ps]=await Promise.all([cats(),prods()]);const count={};ps.forEach(p=>count[p.cat]=(count[p.cat]||0)+1);
  let est='';try{if(navigator.storage?.estimate){const e=await navigator.storage.estimate();est=` · ${(e.usage/1048576).toFixed(1)} MB usados`}}catch(e){}
  view.innerHTML=`<div class="card"><h3 style="margin:0 0 8px">🗂️ Categorías</h3><div class="plist" id="clist">${cs.map((c,i)=>`<div class="pitem" style="border-left:6px solid ${c.color}"><div class="noimg">${esc(c.emoji||'📦')}</div><div class="info"><b>${esc(c.name)}</b><small>${count[c.id]||0} productos</small></div>
    <button class="iconbtn" style="background:#f3f4f6;color:#111;font-size:18px" data-up="${i}" ${i?'':'disabled'} aria-label="Subir">▲</button><button class="iconbtn" style="background:#f3f4f6;color:#111;font-size:18px" data-ed="${c.id}" aria-label="Editar">✏️</button></div>`).join('')}</div>
    <div style="height:10px"></div><button class="btn sec block" id="addc">＋ Nueva categoría</button></div>
  <div class="card"><h3 style="margin:0 0 6px">💾 Copia de seguridad</h3><p class="muted" style="margin:0 0 10px">Tus datos se guardan solo en este móvil (${ps.length} productos${est}). Exporta de vez en cuando un archivo para no perderlos o pasarlos a otro móvil.</p>
    <button class="btn block" id="exp">⬇️ Exportar copia (JSON)</button><div style="height:8px"></div>
    <label class="btn ghost block" style="margin:0">⬆️ Importar copia<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
  <div class="card"><h3 style="margin:0 0 6px">ℹ️ Acerca de</h3><div class="kv"><dt>App</dt><dd><b>Alimentos Sanos</b></dd><dt>Versión</dt><dd><b>${APP_VERSION}</b> <span id="updState" class="muted"></span></dd><dt>Datos</dt><dd>Open Food Facts / Open Beauty Facts (licencia ODbL)</dd><dt>Almacenamiento</dt><dd>Local (IndexedDB), no se envía a ningún servidor</dd></div>
    <div style="height:10px"></div><button class="btn ghost block" id="chk">🔄 Buscar actualización</button>
    <p class="muted" style="font-size:13px">La app se actualiza sola cuando hay versión nueva. Actualizar nunca borra tus productos.</p></div>`;
  $('#addc').onclick=async()=>{if(await editCat())vAjustes()};
  $('#clist').onclick=async e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.ed){if(await editCat(cs.find(c=>c.id===b.dataset.ed)))vAjustes()}
    if(b.dataset.up){const i=+b.dataset.up;[cs[i-1],cs[i]]=[cs[i],cs[i-1]];cs.forEach((c,k)=>c.order=k);await DB.bulkPut('cats',cs);vAjustes()}};
  $('#exp').onclick=exportData;
  $('#imp').onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
  $('#chk').onclick=()=>checkUpdate(true);
}
async function exportData(){
  const data={app:'mi-despensa',name:'Alimentos Sanos',version:APP_VERSION,exported:new Date().toISOString(),cats:await DB.all('cats'),prods:await DB.all('prods')};
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});const name=`alimentos-sanos-${new Date().toISOString().slice(0,10)}.json`;
  const file=new File([blob],name,{type:'application/json'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'Copia Alimentos Sanos'});return}catch(e){if(e.name==='AbortError')return}}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);toast('Copia descargada');
}
async function importData(f){
  try{const d=JSON.parse(await f.text());if(d.app!=='mi-despensa'||!Array.isArray(d.prods))throw 0;
    const replace=confirm(`Copia con ${d.prods.length} productos y ${d.cats.length} categorías.\n\nAceptar = REEMPLAZAR todo lo actual\nCancelar = AÑADIR / combinar con lo actual`);
    if(replace){await DB.clear('prods');await DB.clear('cats')}
    await DB.bulkPut('cats',d.cats);await DB.bulkPut('prods',d.prods);localStorage.setItem('md-init','1');toast('✓ Copia importada');vAjustes();
  }catch(e){alert('Ese archivo no es una copia válida de Alimentos Sanos.')}
}

/* ---------- Router ---------- */
async function route(){
  await stopScan();closeSheet();
  const h=location.hash.slice(1)||'/';const [path,qs]=h.split('?');const params=new URLSearchParams(qs||'');const seg=path.split('/').filter(Boolean);
  window.scrollTo(0,0);
  try{
    if(!seg.length)return vHome();
    switch(seg[0]){case 'cat':return vCat(seg[1]);case 'scan':return vScan(params);case 'lookup':return vLookup(seg[1],params);case 'p':return vProduct(seg[1]);case 'manual':return vManual(params);case 'buscar':return vBuscar(params);case 'ajustes':return vAjustes();default:location.hash='#/'}
  }catch(e){console.error(e);view.innerHTML=`<div class="empty">Error: ${esc(e.message)}</div>`}
}
addEventListener('hashchange',route);

/* ---------- Auto-actualización ---------- */
let swReg=null,reloading=false;
async function checkUpdate(manual){
  try{
    const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'});const v=(await r.json()).v;
    if(swReg)await swReg.update();
    if(v!==APP_VERSION){if(!manual&&sessionStorage.getItem('md-upd-try')===v)return;sessionStorage.setItem('md-upd-try',v);toast('Nueva versión '+v+', actualizando…',4000);setTimeout(hardReload,manual||!navigator.serviceWorker?.controller?1500:8000)}
    else if(manual){toast('✓ Ya tienes la última versión');const s=$('#updState');if(s)s.textContent='(al día)'}
  }catch(e){if(manual)toast('No se pudo comprobar (¿sin conexión?)')}
}
async function hardReload(){if(reloading)return;reloading=true;try{const ks=await caches.keys();await Promise.all(ks.filter(k=>k.startsWith('md-shell-')).map(k=>caches.delete(k)))}catch(e){}location.reload()}
if('serviceWorker' in navigator){
  const hadCtrl=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadCtrl||reloading)return;reloading=true;toast('Nueva versión, actualizando…',3000);setTimeout(()=>location.reload(),900)});
  navigator.serviceWorker.register('sw.js').then(r=>{swReg=r;r.addEventListener('updatefound',()=>{const w=r.installing;w&&w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)w.postMessage('skipWaiting')})})}).catch(e=>console.warn('SW',e));
}
addEventListener('load',()=>setTimeout(()=>checkUpdate(false),3000));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkUpdate(false)});
setInterval(()=>checkUpdate(false),30*60*1000);
if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});

ensureDefaults().then(route);
