/* Alimentos Sanos — complemento personal a Yuka. Vanilla JS, datos en IndexedDB (db.js). */
const APP_VERSION='1.0.9';
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const view=$('#view');
let pending=null; // pending = producto consultado aún sin guardar

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
const FIELDS='code,product_name,product_name_es,generic_name,generic_name_es,brands,quantity,image_front_url,image_url,image_front_small_url,ingredients_text_es,ingredients_text,nutriscore_grade,nutriscore_score,nutriscore_data,labels_tags,categories_tags,nova_group,ecoscore_grade,additives_tags,allergens_tags,traces_tags,categories,labels,nutriments,nutrition_data_per';
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
/* nombre de OFF: primero en español, luego genérico y, si no hay nada, la marca */
function offName(p){for(const k of ['product_name_es','product_name','generic_name_es','generic_name']){const v=(p[k]||'').trim();if(v)return v}return (p.brands||'').split(',')[0].trim()}
function normalize(p,code,src){
  const g=v=>v&&v!=='unknown'&&v!=='not-applicable'?v:'';
  return {code:p.code||code,src,name:offName(p),brand:(p.brands||'').split(',')[0].trim(),quantity:p.quantity||'',
    image:p.image_front_url||p.image_url||p.image_front_small_url||'',ingredients:p.ingredients_text_es||p.ingredients_text||'',
    nutriscore:g(p.nutriscore_grade),nova:p.nova_group||'',ecoscore:g(p.ecoscore_grade),
    additives:(p.additives_tags||[]).map(t=>t.replace(/^\w\w:/,'').toUpperCase()),
    allergens:(p.allergens_tags||[]).map(t=>{const k=t.replace(/^\w\w:/,'');return ALLERG[k]||k}),
    traces:(p.traces_tags||[]).map(t=>{const k=t.replace(/^\w\w:/,'');return ALLERG[k]||k}),
    offCategories:p.categories||'',catTags:p.categories_tags||[],labels:p.labels||'',nutr:offNutr(p),...SCORE.fromOFF(p)};
}
async function searchOnline(q){
  // 1º buscador nuevo de OFF (search-a-licious), 2º buscador clásico
  try{const r=await fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=24&langs=es&fields=code,product_name,product_name_es,generic_name,generic_name_es,brands,image_front_small_url,nutriscore_grade`);
    if(r.ok){const j=await r.json();return (j.hits||[]).map(h=>({...h,brands:Array.isArray(h.brands)?h.brands.join(', '):h.brands}))}}catch(e){}
  const u=`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&lc=es&fields=code,product_name,product_name_es,generic_name,generic_name_es,brands,image_front_small_url,nutriscore_grade`;
  const r=await fetch(u);if(!r.ok)throw new Error('http '+r.status);return (await r.json()).products||[];
}

/* ---------- Nutrición: regla de la fibra + declaraciones UE ---------- */
const fmt=v=>v==null||v===''?'—':String(Math.round(+v*100)/100).replace('.',',');
const pnum=v=>{v=String(v??'').trim().replace(',','.');return v===''||isNaN(+v)?null:+v};
const SMART={fibra:{t:'Cumple regla de la fibra',e:'🌾',c:'#b45309',d:'Fibra × 5 ≥ hidratos de carbono (por 100 g o 100 ml). Ordenados de mejor a peor proporción fibra/hidratos.'},
  altoFibra:{t:'Alto en fibra',e:'🥦',c:'#15803d',d:'Reglamento UE 1924/2006: al menos 6 g de fibra por 100 g o 3 g por 100 kcal.'},
  altoProteina:{t:'Alto en proteína',e:'💪',c:'#7c3aed',d:'Reglamento UE 1924/2006: las proteínas aportan al menos el 20 % de la energía (proteína × 4 / kcal).'}};
const SRC={off:'Open Food Facts',obf:'Open Beauty Facts',etiqueta:'Etiqueta escaneada',manual:'Escrito a mano',usuario:'Completado por ti (fotos)'};
function offNutr(p){
  const n=p.nutriments||{};const g=k=>n[k]==null||n[k]===''?null:Math.round(+n[k]*100)/100;
  let kcal=g('energy-kcal_100g');if(kcal==null&&n['energy_100g']!=null&&(n['energy_unit']||'kJ').toLowerCase()==='kj')kcal=Math.round(+n['energy_100g']/4.184);
  const o={fiber:g('fiber_100g'),carbs:g('carbohydrates_100g'),protein:g('proteins_100g'),kcal:kcal==null?null:Math.round(kcal),fat:g('fat_100g')};
  if(Object.values(o).every(v=>v==null))return null;
  o.base=/(^|\d|\s)(ml|cl|l)\b/i.test(p.quantity||'')||/ml/.test(p.nutrition_data_per||'')?'100 ml':'100 g';o.source='off';return o;
}
function smartBadges(p){
  if(!p.nutr&&!p.smart)return '';const s=NUTR.sections(p);
  return (s.fibra?`<span class="badge sb-fibra">🌾 Regla fibra</span>`:'')+(s.altoFibra?`<span class="badge sb-fib">🥦 Alto en fibra</span>`:'')+(s.altoProteina?`<span class="badge sb-pro">💪 Alto en proteína</span>`:'');
}
function nutrEvalHTML(n){
  n=n||{};const e=NUTR.evaluate(n),b=n.base||'100 g',f=pnum(n.fiber),c=pnum(n.carbs);
  let rule;
  if(e.rule==null)rule=`<div class="ev unk">❔ <b>Regla de la fibra:</b> ${f==null?'falta la fibra':'faltan los hidratos'}, no se puede saber (fibra sin dato ≠ 0).</div>`;
  else if(c===0)rule=`<div class="ev ${e.rule?'ok':'ko'}">${e.rule?'✅':'❌'} <b>Regla de la fibra:</b> 0 g de hidratos ${e.rule?'y tiene fibra: cumple':'y sin fibra: no cumple'}.</div>`;
  else rule=`<div class="ev ${e.rule?'ok':'ko'}">${e.rule?'✅ <b>Cumple</b>':'❌ <b>No cumple</b>'} la regla de la fibra: ${fmt(f)} g × 5 = ${fmt(f*5)} g ${e.rule?'≥':'<'} ${fmt(c)} g de hidratos <span class="muted">(1 g de fibra por cada ${fmt(c/f||0)} g de hidratos)</span>.</div>`;
  const fl={alto:'🥦 <b>Alto en fibra</b> (≥ 6 g/100 g o ≥ 3 g/100 kcal)',fuente:'🌱 <b>Fuente de fibra</b> (≥ 3 g/100 g o ≥ 1,5 g/100 kcal)',no:'Fibra: no llega a "fuente de fibra" (UE)'}[e.fiber]||'Fibra (UE): sin datos';
  const ps=e.proteinShare;const pl=e.protein==null?`Proteína (UE): ${pnum(n.kcal)?'falta la proteína':'faltan las kcal'} para calcularlo`:`${{alto:'💪 <b>Alto en proteínas</b>',fuente:'🥚 <b>Fuente de proteínas</b>',no:'Proteínas: no es fuente de proteínas'}[e.protein]}: aportan el ${fmt(Math.round(ps*1000)/10)} % de la energía <span class="muted">(alto ≥ 20 %, fuente ≥ 12 %)</span>`;
  const w=NUTR.warnings(n).map(x=>`<div class="ev warn">⚠️ ${esc(x)}</div>`).join('');
  return rule+`<div class="ev ${e.fiber==='alto'||e.fiber==='fuente'?'ok':'unk'}">${fl}</div><div class="ev ${e.protein==='alto'||e.protein==='fuente'?'ok':'unk'}">${pl}</div>${w}<div class="muted" style="font-size:12px;margin-top:4px">Valores por ${esc(b)}. Nunca se usan los azúcares como hidratos.</div>`;
}
function nutrSection(p){
  const n=p.nutr||{},s=NUTR.sections(p);
  const fld=(k,l,u)=>`<div><label for="n-${k}">${l}</label><input id="n-${k}" data-k="${k}" inputmode="decimal" placeholder="${u}" value="${n[k]==null?'':String(n[k]).replace('.',',')}"></div>`;
  return `<div class="nutr"><h3 style="margin:16px 0 2px">🥦 Fibra y proteína</h3>
  <div class="muted" id="n-src" style="font-size:13px">${n.source?'Fuente: '+SRC[n.source]:'Sin datos nutricionales: escanea la etiqueta o escríbelos'}</div>
  <div class="row" style="margin-top:8px"><button type="button" class="btn sec" id="n-scan">📷 Escanear etiqueta</button><label class="btn ghost" style="margin:0;flex:none;padding:0 14px" title="Elegir foto">🖼️<input type="file" id="n-file2" accept="image/*" hidden></label></div>
  <input type="file" id="n-file" accept="image/*" capture="environment" hidden>
  ${p.code&&p.src!=='manual'?`<button type="button" class="btn ghost block" id="n-off" style="margin-top:8px">⬇️ Traer valores de Open Food Facts</button>`:''}
  <div id="n-ocr"></div>
  <label>Valores por</label><select id="n-base"><option ${n.base!=='100 ml'?'selected':''}>100 g</option><option ${n.base==='100 ml'?'selected':''}>100 ml</option></select>
  <div class="ngrid">${fld('fiber','Fibra (g)','g')}${fld('carbs','Hidratos (g)','g')}${fld('protein','Proteínas (g)','g')}${fld('kcal','Energía (kcal)','kcal')}</div>
  <input type="hidden" id="n-fat" value="${n.fat==null?'':n.fat}">
  <div id="n-res" class="nres"></div>
  <label>Guardar también en las secciones</label>
  <div class="smartchk">${Object.entries(SMART).map(([k,v])=>`<label class="chk"><input type="checkbox" data-s="${k}" ${s[k]?'checked':''}> ${v.e} ${v.t}</label>`).join('')}</div>
  <div class="muted" style="font-size:12px">Se marcan solas según los valores; puedes cambiarlas a mano.</div></div>`;
}
function bindNutr(p){
  let source=p.nutr&&p.nutr.source||null;const touched=new Set(Object.keys(p.smart||{}));
  const read=()=>{const o={base:$('#n-base').value,source};for(const k of ['satfat','sugars','salt'])if(p.nutr&&p.nutr[k]!=null)o[k]=p.nutr[k];for(const k of ['fiber','carbs','protein','kcal'])o[k]=pnum($('#n-'+k).value);o.fat=pnum($('#n-fat').value);return o};
  const has=o=>['fiber','carbs','protein','kcal'].some(k=>o[k]!=null);
  const refresh=()=>{const o=read();$('#n-res').innerHTML=has(o)?nutrEvalHTML(o):'';
    const auto=NUTR.sections({nutr:o});document.querySelectorAll('.smartchk input').forEach(c=>{if(!touched.has(c.dataset.s))c.checked=auto[c.dataset.s]})};
  document.querySelectorAll('.ngrid input').forEach(i=>i.addEventListener('input',()=>{i.classList.remove('ocr','warn');if(source!=='etiqueta'||!i.dataset.edited){i.dataset.edited=1}if(!source||source==='off')source='manual';$('#n-src').textContent='Fuente: '+SRC[source];refresh()}));
  $('#n-base').onchange=refresh;
  document.querySelectorAll('.smartchk input').forEach(c=>c.onchange=()=>touched.add(c.dataset.s));
  const setVals=(o,cls)=>{for(const k of ['fiber','carbs','protein','kcal']){const i=$('#n-'+k);if(o[k]!=null){i.value=String(o[k]).replace('.',',');i.classList.add(cls)}}if(o.fat!=null)$('#n-fat').value=o.fat;if(o.base)$('#n-base').value=o.base};
  const scan=async f=>{if(!f)return;const box=$('#n-ocr');
    box.innerHTML=`<div class="ocrbox"><img src="${URL.createObjectURL(f)}" alt=""><div style="flex:1"><b id="n-pmsg">Preparando lector…</b><div class="pbar"><i id="n-pbar"></i></div><small class="muted">Se lee en el móvil, sin enviar la foto a ningún sitio.</small></div></div>`;
    try{const r=await OCR.read(f,(v,m)=>{const b=$('#n-pbar');if(b)b.style.width=Math.round(v*100)+'%';const t=$('#n-pmsg');if(t&&m)t.textContent=m});
      document.querySelectorAll('.ngrid input').forEach(i=>i.classList.remove('ocr','warn'));
      setVals(r,'ocr');(r.uncertain||[]).forEach(k=>{const i=$('#n-'+k);if(i)i.classList.add('warn')});
      source='etiqueta';$('#n-src').textContent='Fuente: '+SRC.etiqueta;
      const L={fiber:'fibra',carbs:'hidratos',protein:'proteínas',kcal:'kcal'};
      const miss=Object.keys(L).filter(k=>r[k]==null).map(k=>L[k]);const unc=(r.uncertain||[]).filter(k=>r[k]!=null).map(k=>L[k]);
      box.insertAdjacentHTML('beforeend',r.text?`<details class="rawtxt"><summary>📄 Ver el texto leído</summary><pre>${esc(r.text.trim())}</pre></details>`:'');
      box.querySelector('.ocrbox>div').innerHTML=`<b>${r.found.length>=2?'✓ Etiqueta leída':'⚠️ Apenas he podido leer la tabla: haz la foto más cerca, solo de la tabla, o escribe los valores'}</b><small>Comprueba los valores con la foto antes de guardar${r.base?' · columna '+esc(r.base):''}.</small>
        ${unc.length?`<small class="w">Lectura dudosa: ${unc.join(', ')}</small>`:''}${miss.length?`<small class="w">No encontrado: ${miss.join(', ')} (escríbelo si aparece)</small>`:''}${r.notes.some(n=>/kJ/.test(n))?'<small>kcal calculadas desde kJ</small>':''}${!r.headerFound&&r.found.length?'<small class="w">No vi la cabecera "por 100 g": confirma que es esa columna</small>':''}`;
      refresh();
    }catch(e){box.innerHTML=`<div class="ev warn">⚠️ ${esc(e.message||'No se pudo leer')}. Puedes escribir los valores a mano.</div>`}};
  $('#n-scan').onclick=()=>$('#n-file').click();
  $('#n-file').onchange=e=>{scan(e.target.files[0]);e.target.value=''};$('#n-file2').onchange=e=>{scan(e.target.files[0]);e.target.value=''};
  if($('#n-off'))$('#n-off').onclick=async()=>{const b=$('#n-off');b.textContent='Buscando…';try{const q=await lookup(p.code);const o=q&&q.nutr;if(!o){b.textContent='Open Food Facts no tiene estos valores';return}
    setVals(o,'ocr');source='off';$('#n-src').textContent='Fuente: '+SRC.off;b.textContent='✓ Valores de Open Food Facts';refresh()}catch(e){b.textContent='Sin conexión'}};
  refresh();
  return ()=>{const o=read();const smart={};document.querySelectorAll('.smartchk input').forEach(c=>{if(touched.has(c.dataset.s))smart[c.dataset.s]=c.checked});
    return {nutr:has(o)?o:null,smart:Object.keys(smart).length?smart:null}};
}

/* ---------- Componentes ---------- */
const nsBadge=g=>g&&/^[a-e]$/.test(g)?`<span class="badge ns ns-${g}">Nutri-Score ${g.toUpperCase()}</span>`:'';
const novaBadge=n=>n?`<span class="badge nova${n}">NOVA ${n}</span>`:'';
const vBadge=v=>v?`<span class="badge v-${v}">${VERD[v]}</span>`:'';
const starsTxt=n=>n?'★'.repeat(n)+'☆'.repeat(5-n):'';
/* ---------- Nota rápida 0-100 y riesgo de aditivos (score.js, additives-risk.js) ---------- */
const adCode=c=>String(c||'').replace(/^(E\d+)(.*)$/i,(m,a,b)=>a.toUpperCase()+b.toLowerCase());
function qsBadge(p){const r=SCORE.evaluate(p);if(r.score==null)return '';return `<span class="badge qsb" style="--c:${r.grade.c}" title="Nota rápida: ${r.grade.t}"><i></i>${r.score}</span>`}
function riskList(items,codes){
  return `<div class="addl">${items.map(a=>`<details class="add"><summary><i class="dot" style="background:${a.c}"></i><span class="an">${codes?`<b>${esc(adCode(a.code))}</b> `:''}${esc(a.name||'(sin nombre en la tabla)')}</span><span class="ar" style="color:${a.c}">${esc(a.t)}</span></summary><p>${esc(a.desc)}</p></details>`).join('')}</div>`;
}
const RISK_NOTE='<p class="rnote">Clasificación orientativa elaborada a partir de fuentes públicas (opiniones de la EFSA, clasificación de la IARC y estudios publicados). No es consejo médico ni procede de Yuka.</p>';
function riskCounts(items){const n=[0,0,0,0];let u=0;items.forEach(a=>a.level==null?u++:n[a.level]++);
  return [[3,'alto'],[2,'moderado'],[1,'limitado'],[0,'sin riesgo']].filter(([l])=>n[l]).map(([l,t])=>`<span class="rc" style="--c:${ADDITIVES.LEVELS[l].c}">${n[l]} ${t}</span>`).join('')+(u?`<span class="rc" style="--c:#9ca3af">${u} sin evaluar</span>`:'')}
function quickScoreHTML(p){
  const r=SCORE.evaluate(p);
  if(r.score==null){const miss=COMPLETE.missing(p);
    return `<div class="qs none"><div class="qs-c"><b>?</b></div><div class="qs-t"><b>${esc(r.reason)}</b><small>Nota rápida automática</small></div>
    <div class="qs-cta"><small>${miss.length?'Falta'+(miss.length>1?'n':'')+' '+esc(miss.join(' y '))+'. ':''}Haz una foto a la tabla nutricional y otra a los ingredientes: la app los lee, rellena el producto y calcula la nota.</small>
    <button type="button" class="btn block js-complete">📷 Completar con fotos</button></div></div>`}
  const g=r.grade;
  let h=`<div class="qs" style="--c:${g.c}"><div class="qs-c"><b>${r.score}</b><small>/100</small></div><div class="qs-t"><b>${g.t}</b><small>${r.type==='cosm'?'Nota rápida según los ingredientes':'Nota rápida automática'}</small></div></div>`;
  if(r.type==='cosm'){
    h+=r.capped?'<div class="qs-cap">⚠️ Contiene un ingrediente de riesgo alto: la nota no pasa de 49.</div>':'';
    h+=`<div class="qs-sec"><b>🧴 Ingredientes a vigilar</b>${r.hits.length?riskList(r.hits.map(x=>({...x,code:''})),false):'<p class="muted" style="margin:4px 0">No hemos encontrado ingredientes de riesgo de nuestra lista.</p>'}</div>${RISK_NOTE}`;
    return h;
  }
  h+=`<div class="qs-parts">${r.parts.map(x=>`<div class="qp"><span>${x.l} <small>(${x.w} %)</small></span><div class="qbar"><i style="width:${x.v}%;background:${SCORE.gradeOf(x.v).c}"></i></div><b>${x.pts}/${x.w}</b></div>`).join('')}</div>`;
  if(r.capped)h+='<div class="qs-cap">⚠️ Tiene un aditivo de riesgo alto: la nota se limita a 49.</div>';
  const it=(x,pos)=>`<li><i class="dot" style="background:${pos?(x.lv?'#65a30d':'#15803d'):(x.lv===3?'#dc2626':'#f97316')}"></i><span><b>${esc(x.t)}</b>${x.v?` <small class="muted">${esc(x.l)} ${esc(x.v)}</small>`:''}</span></li>`;
  const ad=r.additives;const adBad=ad.filter(a=>a.level>=2);
  const neg=r.hl.neg.map(x=>it(x,false)),pos=r.hl.pos.map(x=>it(x,true));
  if(adBad.length)neg.push(`<li><i class="dot" style="background:${adBad.some(a=>a.level===3)?'#dc2626':'#f97316'}"></i><span><b>Aditivos de riesgo</b> <small class="muted">${adBad.map(a=>adCode(a.code)).join(', ')}</small></span></li>`);
  else if(!ad.length)pos.push(`<li><i class="dot" style="background:#15803d"></i><span><b>Sin aditivos</b></span></li>`);
  if(r.bio)pos.push(`<li><i class="dot" style="background:#15803d"></i><span><b>Ecológico</b></span></li>`);
  if(neg.length||pos.length)h+=`<div class="qs-hl">${neg.length?`<div><b class="hlt">Puntos negativos</b><ul>${neg.join('')}</ul></div>`:''}${pos.length?`<div><b class="hlt">Puntos positivos</b><ul>${pos.join('')}</ul></div>`:''}</div>`;
  if(!r.detail)h+='<div class="muted" style="font-size:12px">Nota calculada con la letra del Nutri-Score. Para ver el detalle de nutrientes, vuelve a escanearlo y pulsa «Actualizar datos de la base».</div>';
  else if(r.computed)h+='<div class="muted" style="font-size:12px">Nutri-Score calculado con los valores nutricionales.</div>';
  return h;
}
function imgOf(p){return p.photo||p.image||''}
function pItem(p,catMap,extra){
  const im=imgOf(p);const c=catMap&&catMap[p.cat];
  return `<a class="pitem" href="#/p/${p.id}">${im?`<img loading="lazy" src="${esc(im)}" alt="">`:`<div class="noimg">📦</div>`}
  <div class="info"><b>${esc(p.name||'(sin nombre)')}</b><small>${esc(p.brand||'')}${c?` · ${esc(c.emoji||'')} ${esc(c.name)}`:''}${p.rating?` · <span style="color:#f59e0b">${starsTxt(p.rating)}</span>`:''}</small>
  <div class="badges">${qsBadge(p)}${vBadge(p.verdict)}${nsBadge(p.nutriscore)}${novaBadge(p.nova)}${smartBadges(p)}</div>${extra||''}</div></a>`;
}
function infoBlock(p){
  const sc=[];
  if(p.nutriscore)sc.push(`<div class="score ns-${p.nutriscore} ${p.nutriscore?'ns':''}"><b>${p.nutriscore.toUpperCase()}</b>Nutri-Score</div>`);
  if(p.nova)sc.push(`<div class="score nova${p.nova}"><b>${p.nova}</b>NOVA</div>`);
  if(p.ecoscore&&/^[a-e]$/.test(p.ecoscore))sc.push(`<div class="score"><b>${p.ecoscore.toUpperCase()}</b>Eco-Score</div>`);
  if(p.src!=='obf')sc.push(`<div class="score"><b>${(p.additives||[]).length}</b>Aditivos</div>`);
  return `<div class="card"><div class="hero">${imgOf(p)?`<img src="${esc(imgOf(p))}" alt="">`:''}<div><h3>${esc(p.name||'(sin nombre)')}</h3><div class="muted">${esc(p.brand||'')}${p.quantity?' · '+esc(p.quantity):''}</div>
  ${p.code?`<div class="muted" style="font-size:13px;margin-top:4px">Código: ${esc(p.code)}</div>`:''}
  <div class="muted" style="font-size:12px;margin-top:2px">${p.src==='off'?'Datos: Open Food Facts':p.src==='obf'?'Datos: Open Beauty Facts':'Añadido a mano'}${p.user?' + completados por ti':''}</div></div></div>
  ${p.user?`<div class="ubadge">✍️ Datos completados por ti${p.user.at?` <small>· ${new Date(p.user.at).toLocaleDateString('es-ES')}</small>`:''}</div>`:''}
  ${quickScoreHTML(p)}
  ${(()=>{const r=SCORE.evaluate(p),miss=COMPLETE.missing(p);if(r.score==null)return '';
    return miss.length?`<div class="fhint cta2">Falta${miss.length>1?'n':''} ${esc(miss.join(' y '))}: la nota puede no ser exacta.<button type="button" class="btn block js-complete" style="margin-top:8px">📷 Completar con fotos</button></div>`
      :`<button type="button" class="btn ghost block js-complete" style="margin-top:10px">📷 Completar / corregir datos</button>`})()}
  ${p.src!=='manual'||p.user?`<div class="scores">${sc.join('')}</div>`:''}
  ${p.nova?`<div class="muted" style="font-size:14px">NOVA ${p.nova}: ${NOVA[p.nova]||''}</div>`:''}</div>
  ${p.src!=='manual'||p.user?`
  <details ${p.ingredients?'':''}><summary>🧾 Ingredientes</summary><p class="list-add">${esc(p.ingredients||'No disponible')}</p></details>
  ${p.src==='obf'?'':(()=>{const items=(p.additives||[]).map(a=>ADDITIVES.info(a)).sort((a,b)=>(b.level??-1)-(a.level??-1));
    return `<details class="adds" ${items.length?'open':''}><summary>🧪 Aditivos (${items.length}) ${riskCounts(items)}</summary>${items.length?riskList(items,true)+RISK_NOTE:'<p class="list-add">Ninguno declarado</p>'}</details>`})()}
  <details><summary>⚠️ Alérgenos</summary><p class="list-add">${(p.allergens||[]).length?esc(p.allergens.join(', ')):'Ninguno declarado'}${(p.traces||[]).length?`<br><b>Trazas:</b> ${esc(p.traces.join(', '))}`:''}</p></details>`:''}`+recipesHTML(p);
}

/* Formulario guardar/editar (categoría, valoración, veredicto, notas) */
async function saveForm(p,isNew){
  const cs=await cats();
  return `<div class="card"><h3 style="margin:0 0 4px">${isNew?'Guardar en mis productos':'Mi clasificación'}</h3>
  <label for="f-name">Nombre <span class="req">*</span></label><input id="f-name" value="${esc(p.name||'')}" placeholder="Escribe el nombre del producto" autocomplete="off" enterkeyhint="next">
  ${p.name?'':'<div class="fhint" id="f-name-hint">Open Food Facts no tiene el nombre de este producto: escríbelo aquí.</div>'}
  <label for="f-brand">Marca</label><input id="f-brand" value="${esc(p.brand||'')}" placeholder="Marca (opcional)" autocomplete="off">
  <label>Categoría</label><div class="row"><select id="f-cat"><option value="">Sin categoría</option>${cs.map(c=>`<option value="${c.id}" ${c.id===p.cat?'selected':''}>${esc((c.emoji||'')+' '+c.name)}</option>`).join('')}</select>
  <button class="btn sec" style="flex:none" id="f-newcat" type="button">＋ Nueva</button></div>
  <label>Mi valoración</label><div class="stars" id="f-stars">${[1,2,3,4,5].map(i=>`<button type="button" data-v="${i}" class="${(p.rating||0)>=i?'on':''}" aria-label="${i} estrellas">★</button>`).join('')}</div>
  <label>Veredicto</label><div class="chips" id="f-verd">${Object.entries(VERD).map(([k,v])=>`<button type="button" class="chip v-${k} ${p.verdict===k?'on':''}" data-v="${k}">${v}</button>`).join('')}</div>
  <label>Foto propia ${p.photo?'':'(opcional)'}</label>
  <input type="file" id="f-photo" accept="image/*" capture="environment">
  ${p.photo?`<img class="photo-prev" id="f-prev" src="${p.photo}">`:'<img class="photo-prev" id="f-prev" hidden>'}
  ${nutrSection(p)}
  <label>Notas</label><textarea id="f-notes" placeholder="Dónde lo compro, precio, sabor, por qué sí o no...">${esc(p.notes||'')}</textarea>
  <div style="height:12px"></div><button class="btn block" id="f-save">💾 ${isNew?'Guardar':'Guardar cambios'}</button></div>`;
}
function bindForm(p,onSaved){
  let rating=p.rating||0,verdict=p.verdict||'',photo=p.photo||'';const getNutr=bindNutr(p);
  $('#f-stars').onclick=e=>{const b=e.target.closest('button');if(!b)return;const v=+b.dataset.v;rating=rating===v?0:v;[...$('#f-stars').children].forEach(x=>x.classList.toggle('on',+x.dataset.v<=rating))};
  $('#f-verd').onclick=e=>{const b=e.target.closest('button');if(!b)return;verdict=verdict===b.dataset.v?'':b.dataset.v;[...$('#f-verd').children].forEach(x=>x.classList.toggle('on',x.dataset.v===verdict))};
  $('#f-photo').onchange=async e=>{const f=e.target.files[0];if(!f)return;photo=await shrink(f);const pv=$('#f-prev');pv.src=photo;pv.hidden=false};
  const fn=$('#f-name');fn.oninput=()=>{fn.classList.remove('invalid');const h=document.querySelector('.hero h3');if(h)h.textContent=fn.value.trim()||'(sin nombre)'};
  if(!fn.value)setTimeout(()=>{fn.scrollIntoView({block:'center'});fn.focus({preventScroll:true})},300);
  $('#f-newcat').onclick=async()=>{const c=await editCat();if(c){const s=$('#f-cat');s.add(new Option((c.emoji||'')+' '+c.name,c.id));s.value=c.id}};
  $('#f-save').onclick=async()=>{
    const o={...p};
    o.name=$('#f-name').value.trim();o.brand=$('#f-brand').value.trim();
    if(!o.name){const f=$('#f-name');f.classList.add('invalid');f.scrollIntoView({block:'center',behavior:'smooth'});setTimeout(()=>f.focus({preventScroll:true}),250);toast('Escribe el nombre arriba ✏️');return}
    o.cat=$('#f-cat').value||null;o.rating=rating;o.verdict=verdict;o.photo=photo;o.notes=$('#f-notes').value.trim();const nn=getNutr();o.nutr=nn.nutr;o.smart=nn.smart;
    if(o.user&&o.user.nutr&&nn.nutr){const un={...o.user.nutr};let ch=false;for(const k of ['fiber','carbs','protein','kcal'])if(nn.nutr[k]!=null&&nn.nutr[k]!==un[k]){un[k]=nn.nutr[k];ch=true}if(ch){const keep={nutr:o.nutr};Object.assign(o,COMPLETE.applyUser(o,{...o.user,nutr:un}));o.nutr={...o.nutr,...keep.nutr,source:o.nutr.source}}}
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

/* ---------- Completar con fotos (complete.js + ocr.js) ---------- */
function bindComplete(p,onDone){document.querySelectorAll('.js-complete').forEach(b=>b.onclick=async()=>{const u=await completeSheet(p);if(u)await onDone(u)})}
const CX_F=[['kcal','Energía (kcal)'],['fat','Grasas (g)'],['satfat','…saturadas (g)'],['carbs','Hidratos (g)'],['sugars','…azúcares (g)'],['fiber','Fibra (g)'],['protein','Proteínas (g)'],['salt','Sal (g)']];
function completeSheet(p){return new Promise(res=>{
  const cosm=p.src==='obf',u0=p.user||{},n0={...(p.nutr||{}),...(u0.nutr||{})},nx=p.nx||{};
  const ini={kcal:n0.kcal??(nx.energy!=null?Math.round(nx.energy/4.184):null),fat:n0.fat,satfat:n0.satfat??nx.saturated_fat,carbs:n0.carbs,sugars:n0.sugars??nx.sugars,
    fiber:n0.fiber??nx.fiber,protein:n0.protein??nx.proteins,salt:n0.salt??nx.salt};
  const fv=v=>v==null||v===''?'':String(Math.round(+v*100)/100).replace('.',',');
  const bio0=p.bio!=null?!!p.bio:COMPLETE.detectBio(p.name,p.brand,p.labels);
  const ocrBtns=(id)=>`<div class="row"><label class="btn sec" style="margin:0">📷 Hacer foto<input type="file" id="${id}-cam" accept="image/*" capture="environment" hidden></label><label class="btn ghost" style="margin:0;flex:none;padding:0 14px" title="Elegir foto">🖼️ Galería<input type="file" id="${id}-gal" accept="image/*" hidden></label></div><div id="${id}-st"></div>`;
  const m=sheet(`<h3>📷 Completar / corregir datos</h3>
  <p class="muted" style="margin:0 0 6px;font-size:14px">${esc(p.name||'(sin nombre)')}${p.brand?' · '+esc(p.brand):''}. Las fotos se leen en el móvil; revisa los valores antes de guardar.</p>
  ${cosm?'':`<div class="cxstep"><b class="cxn">1</b><b>Tabla nutricional</b> <small class="muted">(por 100 g)</small></div>${ocrBtns('cx-n')}
  <label>Valores por</label><select id="cx-base"><option ${n0.base!=='100 ml'?'selected':''}>100 g</option><option ${n0.base==='100 ml'?'selected':''}>100 ml</option></select>
  <div class="ngrid cxgrid">${CX_F.map(([k,l])=>`<div><label for="cx-${k}">${l}</label><input id="cx-${k}" data-k="${k}" inputmode="decimal" value="${fv(ini[k])}" placeholder="—"></div>`).join('')}</div>
  <label for="cx-fvl">% fruta, verdura, legumbres o frutos secos <small class="muted">(opcional)</small></label><input id="cx-fvl" inputmode="decimal" value="${fv(u0.nutr&&u0.nutr.fvl)}" placeholder="0 si no lo sabes">`}
  <div class="cxstep"><b class="cxn">${cosm?1:2}</b><b>Ingredientes</b></div>${ocrBtns('cx-i')}
  <label for="cx-ing">Lista de ingredientes <small class="muted">(puedes corregirla)</small></label><textarea id="cx-ing" rows="5" placeholder="Ingredientes: …">${esc(p.ingredients||'')}</textarea>
  <div id="cx-det"></div>
  ${cosm?'':`<div class="cxstep"><b class="cxn">3</b><b>Otros datos</b></div>
  <label class="chk" style="margin-top:8px"><input type="checkbox" id="cx-bio" ${bio0?'checked':''}> 🌿 Ecológico / Bio</label>
  <label for="cx-ns">Nutri-Score impreso en el envase <small class="muted">(opcional)</small></label><select id="cx-ns"><option value="">No lo pone / no lo sé</option>${'abcde'.split('').map(l=>`<option value="${l}" ${u0.nsLetter===l?'selected':''}>${l.toUpperCase()}</option>`).join('')}</select>
  <div class="muted" style="font-size:12px">Si están los nutrientes, el Nutri-Score se calcula solo con ellos.</div>`}
  <div id="cx-prev" class="cxprev"></div>
  <div class="row" style="margin-top:12px"><button type="button" class="btn ghost" id="cx-cancel">Cancelar</button><button type="button" class="btn" id="cx-save">💾 Guardar datos</button></div>`);
  let touchedN=false,touchedI=false,busy=false;
  const done=v=>{closeSheet();res(v)};
  m.onclick=e=>{if(e.target===m&&!busy)done(null)};
  const draft=()=>{
    const u={at:Date.now()};
    if(!cosm){const n={base:$('#cx-base').value};for(const [k] of CX_F)n[k]=pnum($('#cx-'+k).value);n.fvl=pnum($('#cx-fvl').value);
      u.nutr=touchedN||u0.nutr?n:(u0.nutr||null);u.bio=$('#cx-bio').checked;u.nsLetter=$('#cx-ns').value||''}
    const t=$('#cx-ing').value.trim();
    if(t&&(touchedI||u0.ingredients||!String(p.ingredients||'').trim()||t!==String(p.ingredients||'').trim())){const a=COMPLETE.analyzeIngredients(t);Object.assign(u,{ingredients:t,additives:a.additives,allergens:a.allergens,traces:a.traces})}
    return u};
  const preview=()=>{
    const t=$('#cx-ing').value.trim(),a=COMPLETE.analyzeIngredients(t);
    const ads=a.additives.map(c=>ADDITIVES.info(c));
    $('#cx-det').innerHTML=t?`<div class="cxdet"><b>🧪 Aditivos detectados (${ads.length})</b>${ads.length?`<div class="cxchips">${ads.map(x=>`<span class="cxchip" style="--c:${x.c}" title="${esc(x.t)}"><i></i>${esc(adCode(x.code))}${x.name?' '+esc(x.name):''}</span>`).join('')}</div>`:'<div class="muted" style="font-size:13px">Ninguno</div>'}
      <b>⚠️ Alérgenos</b><div style="font-size:14px">${a.allergens.length?esc(a.allergens.join(', ')):'<span class="muted">Ninguno detectado</span>'}${a.traces.length?`<br><span class="muted">Trazas:</span> ${esc(a.traces.join(', '))}`:''}</div></div>`:'';
    const d=draft(),r=SCORE.evaluate(COMPLETE.applyUser(p,d));let w='';
    if(d.nutr){const n=d.nutr,ws=NUTR.warnings(n);if(n.satfat!=null&&n.fat!=null&&n.satfat>n.fat+1e-9)ws.push('Las saturadas superan a las grasas');if(n.sugars!=null&&n.carbs!=null&&n.sugars>n.carbs+1e-9)ws.push('Los azúcares superan a los hidratos');if(n.salt!=null&&n.salt>25)ws.push('Más de 25 g de sal: revisa la coma');
      w=ws.map(x=>`<div class="ev warn">⚠️ ${esc(x)}</div>`).join('')}
    $('#cx-prev').innerHTML=w+(r.score==null?`<div class="ev unk">Con estos datos aún no sale nota: ${cosm?'faltan los ingredientes':'hacen falta al menos calorías, azúcares, grasa saturada y sal'}.</div>`
      :`<div class="qs" style="--c:${r.grade.c};margin:12px 0 0"><div class="qs-c" style="width:62px;height:62px"><b style="font-size:26px">${r.score}</b></div><div class="qs-t"><b style="font-size:19px">${r.grade.t}</b><small>Nota con estos datos${r.nsGrade?' · Nutri-Score '+r.nsGrade.toUpperCase():''}</small></div></div>`)};
  const setSt=(id,h)=>{$('#'+id+'-st').innerHTML=h};
  const prog=(id,f)=>{setSt(id,`<div class="ocrbox"><img src="${URL.createObjectURL(f)}" alt=""><div style="flex:1"><b id="${id}-msg">Preparando lector…</b><div class="pbar"><i id="${id}-bar"></i></div><small class="muted">Se lee en el móvil. La 1ª vez descarga el lector (unos 5 MB).</small></div></div>`);
    return (v,msg)=>{const b=$('#'+id+'-bar');if(b)b.style.width=Math.round(v*100)+'%';const t=$('#'+id+'-msg');if(t&&msg)t.textContent=msg}};
  /* Tabla nutricional: nunca deja sin salida. Muestra lo leído (aunque sea poco), el texto en bruto y deja recortar, girar o reintentar. */
  let nFile=null,nRot=0,nCrop=null;
  const L8={kcal:'kcal',fat:'grasas',satfat:'saturadas',carbs:'hidratos',sugars:'azúcares',fiber:'fibra',protein:'proteínas',salt:'sal'};
  const tools=`<div class="cxtools"><button type="button" class="btn ghost" data-t="crop">✂️ Recortar tabla</button><button type="button" class="btn ghost" data-t="rot">↻ Girar 90°</button><button type="button" class="btn ghost" data-t="retry">🔁 Reintentar</button></div><div id="cx-crop"></div>`;
  const bindTools=()=>{$('#cx-n-st').querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{if(busy)return;const t=b.dataset.t;
    if(t==='rot'){nRot=(nRot+90)%360;nCrop=null;scanN(nFile)}else if(t==='retry'){scanN(nFile)}else cropUI()})};
  const cropUI=async()=>{const box=$('#cx-crop');if(!box||!nFile)return;
    box.innerHTML=`<div class="cropwrap"><p class="muted" style="margin:6px 0;font-size:14px">Arrastra el dedo para marcar <b>solo la tabla</b> (nombres y valores).</p><div class="cropstage"><canvas id="cx-cv"></canvas><i id="cx-sel" hidden></i></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn ghost" id="cx-cc">Cancelar</button><button type="button" class="btn" id="cx-co" disabled>✓ Leer esta zona</button></div></div>`;
    const cv=await OCR.preview(nFile,nRot,1000),dst=$('#cx-cv');dst.width=cv.width;dst.height=cv.height;dst.getContext('2d').drawImage(cv,0,0);
    const sel=$('#cx-sel');let a=null,rect=null;
    const pt=e=>{const r=dst.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}};
    const draw=()=>{if(!rect)return;sel.hidden=false;Object.assign(sel.style,{left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%'})};
    dst.style.touchAction='none';
    dst.onpointerdown=e=>{a=pt(e);dst.setPointerCapture(e.pointerId)};
    dst.onpointermove=e=>{if(!a)return;const b=pt(e);rect={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};draw()};
    dst.onpointerup=()=>{a=null;$('#cx-co').disabled=!(rect&&rect.w>0.05&&rect.h>0.05)};
    $('#cx-cc').onclick=()=>{box.innerHTML=''};
    $('#cx-co').onclick=()=>{nCrop=rect;box.innerHTML='';scanN(nFile)};
    box.scrollIntoView({block:'center'})};
  const scanN=async f=>{if(!f)return;if(f!==nFile){nFile=f;nRot=0;nCrop=null}busy=true;const id='cx-n';
    const stat=(head,body,r)=>{setSt(id,`<div class="ocrbox"><img src="${URL.createObjectURL(f)}" alt=""${nRot?` style="transform:rotate(${nRot}deg)"`:''}><div style="flex:1">${head}${body}</div></div>${tools}
      ${r&&r.text?`<details class="rawtxt"><summary>📄 Ver el texto leído</summary><pre>${esc(r.text.trim())}</pre></details>`:''}`);bindTools()};
    try{const r=await OCR.read(f,prog(id,f),{rot:nRot,crop:nCrop});
      document.querySelectorAll('.cxgrid input').forEach(i=>i.classList.remove('ocr','warn'));
      for(const k in L8){const i=$('#cx-'+k);if(r[k]!=null){i.value=fv(r[k]);i.classList.add('ocr')}}(r.uncertain||[]).forEach(k=>{const i=$('#cx-'+k);if(i&&r[k]!=null)i.classList.add('warn')});
      if(r.base)$('#cx-base').value=r.base;
      const got=Object.keys(L8).filter(k=>r[k]!=null);if(got.length)touchedN=true;
      const miss=Object.keys(L8).filter(k=>r[k]==null).map(k=>L8[k]);const unc=(r.uncertain||[]).filter(k=>r[k]!=null&&L8[k]).map(k=>L8[k]);
      const ok=got.length>=2;
      stat(`<b>${ok?`✓ Tabla leída (${got.length} de 8 valores)`:got.length?'⚠️ Solo he podido leer 1 valor':'⚠️ No he podido leer los valores'}</b>`,
        `<small>${ok?'Comprueba los valores con la foto.':'Prueba <b>✂️ Recortar tabla</b> (marca solo la tabla) o <b>↻ Girar</b>, o escribe los valores abajo.'}</small>
        ${unc.length?`<small class="w">Revisa (lectura dudosa): ${unc.join(', ')}</small>`:''}${miss.length&&ok?`<small class="w">Falta: ${miss.join(', ')} (escríbelo si aparece)</small>`:''}${r.notes.some(n=>/sodio/.test(n))?'<small>Sal calculada desde el sodio (× 2,5)</small>':''}${nCrop?'<small>Leído solo en la zona recortada</small>':''}`,r);
      preview()}catch(e){stat('<b>⚠️ No se pudo leer la foto</b>',`<small>${esc(e.message||'')}. Puedes reintentar, recortar o escribir los valores a mano.</small>`,null)}busy=false};
  const scanI=async f=>{if(!f)return;busy=true;const id='cx-i';
    try{const r=await OCR.readText(f,prog(id,f));const t=COMPLETE.cleanIngredients(r.text);$('#cx-ing').value=t;touchedI=true;
      if(!cosm){if(COMPLETE.detectBio(t))$('#cx-bio').checked=true;const l=COMPLETE.detectNutriLetter(r.text);if(l&&!$('#cx-ns').value)$('#cx-ns').value=l}
      $('#'+id+'-st .ocrbox>div').innerHTML=`<b>${t.length>15?'✓ Ingredientes leídos':'Apenas se ha podido leer texto'}</b><small>Revisa el texto abajo y corrige lo que haga falta.</small>${r.confidence<60?'<small class="w">Lectura poco segura: acerca más el móvil o usa más luz</small>':''}`;
      preview()}catch(e){setSt(id,`<div class="ev warn">⚠️ ${esc(e.message||'No se pudo leer')}. Puedes escribir los ingredientes a mano.</div>`)}busy=false};
  for(const [id,fn] of [['cx-n',scanN],['cx-i',scanI]])for(const s of ['cam','gal']){const i=$('#'+id+'-'+s);if(i)i.onchange=e=>{const f=e.target.files[0];e.target.value='';fn(f)}}
  m.querySelectorAll('.cxgrid input,#cx-fvl,#cx-base').forEach(i=>i.addEventListener('input',()=>{i.classList.remove('ocr','warn');touchedN=true;preview()}));
  $('#cx-ing').addEventListener('input',()=>{touchedI=true;preview()});
  if(!cosm){$('#cx-bio').onchange=preview;$('#cx-ns').onchange=preview}
  $('#cx-cancel').onclick=()=>done(null);
  $('#cx-save').onclick=()=>{if(busy){toast('Espera a que termine de leer la foto');return}const u=draft();
    if(!COMPLETE.hasNutr(u.nutr)&&!u.ingredients&&u.bio==null){toast('No hay datos que guardar');return}done(u)};
  preview();
})}

/* ---------- Vistas ---------- */

/* ---------- Recetas caseras (recipes.js): solo si la nota es 50 o más ---------- */
function favId(r,p){return r.id+'__'+String((p&&(p.code||p.id||p.name))||r.product||'')}
function recipesHTML(p){
  const ev=SCORE.evaluate(p);
  if(p.src==='obf'||!ev||ev.score==null||ev.score<50)return '';
  const got=RECIPES.forProduct(p,{page:0});
  if(!got.ok)return '';
  return `<div class="rcsec" id="rcsec"><h3 style="margin:0 0 4px">🍳 Recetas con este producto</h3>
    <p class="muted" id="rcsub" style="font-size:14px;margin:0 0 10px">Platos sencillos de hasta 6 ingredientes, con lo que suele haber en casa.</p>
    <div id="rlist"></div>
    <button type="button" class="btn ghost block" id="rmore" hidden>🔄 Otras ideas</button>
    <a class="muted" href="#/recetas" style="display:block;text-align:center;margin-top:8px;font-size:13px">💛 Ver mis recetas guardadas</a></div>`;
}
function recipeCard(r,on,saved){
  const basics=r.ings.filter(i=>i.b),main=r.ings.filter(i=>!i.b);
  const li=i=>`<li${i.b?' class="bas"':''}><b>${esc(i.n)}</b>${i.q?` <span class="muted">${esc(i.q)}</span>`:''}</li>`;
  return `<details class="rcard" data-rid="${esc(r.id)}"${saved&&r.id?` data-fid="${esc(r.id)}"`:''}><summary>
    <span class="remo">${r.e||'🍽️'}</span>
    <div class="rtit"><b>${esc(r.t)}</b><small>${r.min?r.min+' min':''}${r.srv?` · ${r.srv} ración${r.srv===1?'':'es'}`:''}${saved&&r.product?` · <span class="muted">${esc(r.product)}</span>`:''}</small></div>
    <button type="button" class="rfav ${on?'on':''}" data-fav="${esc(r.id)}" aria-label="${on?'Quitar de mis recetas':'Guardar en mis recetas'}">${on?'💛':'🤍'}</button>
  </summary>
  <div class="rbody">
    <b>Ingredientes</b>
    <ul class="rings">${main.map(li).join('')}${basics.map(li).join('')}</ul>
    <b>Preparación</b>
    <ol class="rsteps">${r.steps.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>
  </div></details>`;
}
async function bindRecipes(p){
  const box=$('#rcsec');if(!box)return;
  let catName='';
  if(p.cat){try{const c=(await cats()).find(x=>x.id===p.cat);if(c)catName=c.name}catch(e){}}
  let page=0;
  const draw=async()=>{
    const got=RECIPES.forProduct(p,{catName,page});
    if(!got.ok||!got.recipes.length){box.hidden=true;return}
    box.hidden=false;
    const sub=$('#rcsub');if(sub&&got.label)sub.textContent=`Ideas con ${got.label}: platos sencillos de hasta 6 ingredientes, con lo que suele haber en casa.`;
    let favs=[];try{favs=await DB.all('favs')}catch(e){}
    const ids=new Set(favs.map(f=>f.id));
    $('#rlist').innerHTML=got.recipes.map(r=>recipeCard(r,ids.has(favId(r,p)),false)).join('');
    const more=$('#rmore');if(more){more.hidden=got.total<=4;more.onclick=()=>{page++;draw()}}
    $('#rlist').querySelectorAll('.rcard summary').forEach(sm=>sm.addEventListener('click',ev=>{if(ev.target.closest('.rfav'))ev.preventDefault()}));
    $('#rlist').querySelectorAll('.rfav').forEach(b=>b.onclick=async ev=>{
      ev.preventDefault();ev.stopPropagation();
      const rec=got.recipes.find(x=>x.id===b.dataset.fav);if(!rec)return;
      const id=favId(rec,p);
      try{
        const has=await DB.get('favs',id);
        if(has){await DB.del('favs',id);b.classList.remove('on');b.textContent='🤍';b.setAttribute('aria-label','Guardar en mis recetas');toast('Quitada de mis recetas')}
        else{await DB.put('favs',{id,rid:rec.id,code:p.code||'',product:p.name||'',productId:p.id||'',e:rec.e,t:rec.t,min:rec.min,srv:rec.srv,ings:rec.ings,steps:rec.steps,g:rec.g,at:Date.now()});b.classList.add('on');b.textContent='💛';b.setAttribute('aria-label','Quitar de mis recetas');toast('💛 Guardada en mis recetas')}
      }catch(e){toast('No se pudo guardar')}
    });
  };
  await draw();
}

async function vRecetas(){
  setTitle('Mis recetas',true);tab('home');
  let favs=[];try{favs=(await DB.all('favs')).sort((a,b)=>(b.at||0)-(a.at||0))}catch(e){}
  if(!favs.length){view.innerHTML=`<div class="empty"><div class="big">💛</div>Aún no has guardado recetas. Cuando un alimento saque 50 o más en la nota rápida, verás 4 ideas: pulsa la estrella para guardarlas aquí.</div>`;return}
  view.innerHTML=`<p class="muted" style="margin:0 0 10px">Las recetas que has marcado con la estrella. Se quedan en este móvil (${favs.length}).</p><div id="rlist">${favs.map(r=>recipeCard(r,true,true)).join('')}</div>`;
  $('#rlist').querySelectorAll('.rfav').forEach(b=>b.onclick=async ev=>{
    ev.preventDefault();ev.stopPropagation();
    const id=b.closest('.rcard')?.dataset.fid;if(!id)return;await DB.del('favs',id);toast('Quitada de mis recetas');vRecetas();
  });
}


async function vHome(){
  setTitle('Alimentos Sanos');tab('home');
  const [cs,ps]=await Promise.all([cats(),prods()]);
  const count={};ps.forEach(p=>count[p.cat||'']=(count[p.cat||'']||0)+1);
  const smartCount={fibra:0,altoFibra:0,altoProteina:0};ps.forEach(p=>{const x=NUTR.sections(p);for(const k in smartCount)if(x[k])smartCount[k]++});
  let nFav=0;try{nFav=(await DB.all('favs')).length}catch(e){}
  const recent=ps.sort((a,b)=>b.updated-a.updated).slice(0,5);const cm=Object.fromEntries(cs.map(c=>[c.id,c]));
  view.innerHTML=`<div class="search"><input id="q" type="search" placeholder="Buscar en mis productos" enterkeyhint="search"></div>
  <div class="row" style="margin-bottom:6px"><a class="btn" href="#/scan">📷 Escanear</a><a class="btn sec" href="#/manual">✍️ Añadir a mano</a></div>
  <h2>Mis categorías <span class="muted" style="font-weight:400">(${ps.length} productos)</span></h2>
  <div class="grid">${cs.map(c=>`<a class="cat" href="#/cat/${c.id}" style="--c:${c.color}"><span class="emo">${esc(c.emoji||'📦')}</span><div><b>${esc(c.name)}</b><br><small>${count[c.id]||0} producto${(count[c.id]||0)===1?'':'s'}</small></div></a>`).join('')}
  ${count['']?`<a class="cat" href="#/cat/none" style="--c:#9ca3af"><span class="emo">🗂️</span><div><b>Sin categoría</b><br><small>${count['']} productos</small></div></a>`:''}
  <a class="cat" href="#" id="addCat" style="--c:#d1d5db;align-items:center;justify-content:center;color:var(--g)"><span class="emo">＋</span><b>Nueva categoría</b></a></div>
  <h2>Secciones <span class="muted" style="font-weight:400;font-size:14px">(automáticas)</span></h2>
  <div class="grid">${Object.entries(SMART).map(([k,v])=>`<a class="cat smart" href="#/smart/${k}" style="--c:${v.c}"><span class="emo">${v.e}</span><div><b>${v.t}</b><br><small>${smartCount[k]} producto${smartCount[k]===1?'':'s'}</small></div></a>`).join('')}
  <a class="cat smart" href="#/recetas" style="--c:#e11d48"><span class="emo">💛</span><div><b>Mis recetas</b><br><small>${nFav?nFav+' guardada'+(nFav===1?'':'s'):'Las que marques con estrella'}</small></div></a></div>
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
  <div class="toolbar"><select id="s"><option value="recent">Más recientes</option><option value="name">Nombre A-Z</option><option value="rating">Mejor valorados</option><option value="qs">Nota rápida</option><option value="ns">Nutri-Score</option><option value="brand">Marca</option></select>
  <select id="f"><option value="">Todos</option><option value="bueno">👍 Buenos</option><option value="regular">😐 Regulares</option><option value="evitar">👎 Evitar</option></select></div>
  <div class="plist" id="list"></div>
  ${id!=='none'?`<div style="height:18px"></div><div class="row"><button class="btn ghost" id="ren">✏️ Editar categoría</button><button class="btn danger" id="del">🗑️ Borrar</button></div>`:''}
  <a class="fab" href="#/scan?cat=${id}" aria-label="Escanear">📷</a>`;
  $('#s').value=st.s;$('#f').value=st.f;
  const draw=()=>{const q=$('#q').value.trim().toLowerCase(),s=$('#s').value,f=$('#f').value;sessionStorage.setItem('md-sort',JSON.stringify({s,f,q}));
    let l=all.filter(p=>(!f||p.verdict===f)&&(!q||[p.name,p.brand,p.notes,p.code].join(' ').toLowerCase().includes(q)));
    const cmp={recent:(a,b)=>b.updated-a.updated,name:(a,b)=>(a.name||'').localeCompare(b.name||''),brand:(a,b)=>(a.brand||'').localeCompare(b.brand||''),rating:(a,b)=>(b.rating||0)-(a.rating||0),ns:(a,b)=>(a.nutriscore||'z').localeCompare(b.nutriscore||'z'),qs:(a,b)=>(SCORE.evaluate(b).score??-1)-(SCORE.evaluate(a).score??-1)}[s];
    l.sort(cmp);$('#list').innerHTML=l.length?l.map(p=>pItem(p)).join(''):`<div class="empty"><div class="big">${esc(c.emoji||'📦')}</div>${all.length?'Nada coincide con el filtro.':'Aún no hay productos aquí. Pulsa 📷 para escanear uno.'}</div>`};
  ['q','s','f'].forEach(k=>$('#'+k).addEventListener('input',draw));draw();
  if(id!=='none'){
    $('#ren').onclick=async()=>{if(await editCat(c))vCat(id)};
    $('#del').onclick=async()=>{if(!confirm(`¿Borrar la categoría "${c.name}"? Sus ${all.length} productos pasarán a "Sin categoría" (no se borran).`))return;
      for(const p of all){p.cat=null;await DB.put('prods',p)}await DB.del('cats',id);toast('Categoría borrada');location.hash='#/'};
  }
}


async function vSmart(key){
  tab('home');const S=SMART[key];if(!S){location.hash='#/';return}
  setTitle(`${S.e} ${S.t}`,true);
  const [cs,ps]=await Promise.all([cats(),prods()]);const cm=Object.fromEntries(cs.map(c=>[c.id,c]));
  const l=ps.filter(p=>NUTR.sections(p)[key]);
  const key2={fibra:p=>{const r=NUTR.fiberRatio(p.nutr?.fiber,p.nutr?.carbs);return r==null?-1:r},altoFibra:p=>p.nutr?.fiber??-1,altoProteina:p=>NUTR.proteinShare(p.nutr?.protein,p.nutr?.kcal)??-1}[key];
  l.sort((a,b)=>key2(b)-key2(a)||(a.name||'').localeCompare(b.name||''));
  const ex=p=>{const n=p.nutr||{};const r=NUTR.fiberRatio(n.fiber,n.carbs),sh=NUTR.proteinShare(n.protein,n.kcal);
    const t=key==='fibra'?(r==null?'Marcado a mano':r===Infinity?`Fibra ${fmt(n.fiber)} g · 0 g hidratos`:`Fibra ${fmt(n.fiber)} g · hidratos ${fmt(n.carbs)} g · 1:${fmt(1/r)}`):key==='altoFibra'?(n.fiber!=null?`Fibra ${fmt(n.fiber)} g / ${esc(n.base||'100 g')}${n.kcal?` · ${fmt(n.fiber*100/n.kcal)} g/100 kcal`:''}`:'Marcado a mano'):(sh!=null?`Proteínas ${fmt(n.protein)} g · ${fmt(Math.round(sh*1000)/10)} % de la energía`:'Marcado a mano');
    return `<small class="muted" style="display:block">${t}</small>`};
  view.innerHTML=`<div class="card" style="font-size:14px">${S.d}</div><div class="plist">${l.length?l.map((p,i)=>pItem(p,cm,ex(p)).replace('<div class="info">',`<div class="info">${key==='fibra'?`<span class="rank">${i+1}</span>`:''}`)).join(''):`<div class="empty"><div class="big">${S.e}</div>Aún no hay productos aquí. Guarda productos con sus valores nutricionales (o escanea la etiqueta) y aparecerán solos.</div>`}</div>`;
}

async function vScan(params){
  setTitle('Escanear',true);tab('scan');
  view.innerHTML=`<div class="scanwrap" id="scanwrap"><div class="cam"><div class="frame"><i></i></div><div class="focus-ring"></div>
    <div class="camctl"><button type="button" class="cbtn" id="torchBtn" hidden aria-label="Linterna">🔦</button><button type="button" class="cbtn" id="camBtn" hidden aria-label="Cambiar cámara">🔄</button><span class="eng" id="engine"></span></div>
    <div class="zoomwrap" id="zoomWrap" hidden><button type="button" class="cbtn" data-z="1">1×</button><button type="button" class="cbtn" data-z="2">2×</button><input type="range" id="zoom"><b id="zoomLbl">1×</b></div></div></div>
  <p class="scanhint" id="scanMsg">📏 Aleja un poco el móvil (15-20 cm) y usa el zoom. Toca la imagen para enfocar.</p>
  <label class="btn block" style="margin:0 0 12px">📸 Hacer foto del código<input type="file" id="snap" accept="image/*" capture="environment" hidden></label>
  <div class="card"><label style="margin-top:0">¿No lee el código? Escríbelo</label><div class="row"><input id="code" inputmode="numeric" pattern="[0-9]*" placeholder="Ej. 3017620422003"><button class="btn" style="flex:none" id="go">Buscar</button></div>
  <label>O busca por nombre</label><div class="row"><input id="name" type="search" placeholder="Ej. yogur griego"><button class="btn sec" style="flex:none" id="goName">Buscar</button></div></div>
  <a class="btn ghost block" href="#/manual">✍️ No está: añadirlo a mano</a>`;
  const go=c=>{c=String(c).replace(/\D/g,'');if(c.length<6){toast('Código no válido');return}stopScan();location.hash=`#/lookup/${c}${params.get('cat')?'?cat='+params.get('cat'):''}`};
  $('#go').onclick=()=>go($('#code').value);$('#code').onkeydown=e=>{if(e.key==='Enter')go(e.target.value)};
  const gn=()=>{const q=$('#name').value.trim();if(q){stopScan();location.hash='#/buscar?online=1&q='+encodeURIComponent(q)}};
  $('#goName').onclick=gn;$('#name').onkeydown=e=>{if(e.key==='Enter')gn()};
  $('#snap').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const m=$('#scanMsg');m.textContent='🔎 Leyendo el código de la foto…';
    try{const c=await Scanner.decodeImage(f);if(c){navigator.vibrate&&navigator.vibrate(80);go(c)}else m.innerHTML='⚠️ No se ve el código en la foto. Hazla de cerca pero <b>nítida</b>, con el código recto y bien iluminado, o escribe los números.'}catch(err){m.textContent='⚠️ No se pudo leer la foto'}};
  const ui={torchBtn:$('#torchBtn'),camBtn:$('#camBtn'),engine:$('#engine'),zoom:$('#zoom'),zoomWrap:$('#zoomWrap'),zoomLbl:$('#zoomLbl')};
  $('#torchBtn').onclick=()=>Scanner.toggleTorch();$('#camBtn').onclick=()=>Scanner.nextCamera();
  ui.zoom.oninput=e=>Scanner.setZoom(e.target.value);
  $('#zoomWrap').onclick=e=>{const b=e.target.closest('[data-z]');if(b)Scanner.setZoom(b.dataset.z)};
  $('#scanwrap .cam').addEventListener('click',e=>{if(e.target.closest('.camctl,.zoomwrap'))return;Scanner.tapFocus(e)});
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('#scanMsg').textContent='La cámara en vivo no está disponible aquí: usa "Hacer foto del código".';$('#scanwrap').hidden=true;return}
  try{await Scanner.start($('#scanwrap'),go,ui)}
  catch(e){console.warn(e);$('#scanwrap').hidden=true;$('#scanMsg').innerHTML=e&&e.name==='NotAllowedError'?'⚠️ Sin permiso de cámara. Actívalo en los ajustes del navegador, o usa "Hacer foto del código".':'⚠️ No se pudo abrir la cámara. Usa "Hacer foto del código" o escribe los números.'}
}
async function stopScan(){await Scanner.stop()}

async function vLookup(code,params){
  setTitle('Producto',true);tab('scan');
  const existing=(await prods()).find(p=>p.code===code);
  view.innerHTML=`<div class="empty"><div class="big">⏳</div>Buscando ${esc(code)} en Open Food Facts…</div>`;
  let p;try{p=await lookup(code)}catch(e){view.innerHTML=`<div class="empty"><div class="big">📡</div>Sin conexión. Conéctate para consultar el producto.</div><a class="btn ghost block" href="#/manual?code=${code}">✍️ Añadirlo a mano</a>`;return}
  if(!p){view.innerHTML=`<div class="empty"><div class="big">🤷</div>El código <b>${esc(code)}</b> no está en Open Food Facts ni en Open Beauty Facts.</div><a class="btn block" href="#/manual?code=${code}">✍️ Añadirlo a mano</a><div style="height:10px"></div><a class="btn ghost block" href="#/scan">📷 Escanear otro</a>`;return}
  if(existing){const shown=existing.user?COMPLETE.applyUser(p,existing.user):p;
    view.innerHTML=infoBlock(shown)+`<div class="card"><b>Ya lo tienes guardado.</b><div style="height:10px"></div><a class="btn block" href="#/p/${existing.id}">Ver mi ficha</a><div style="height:8px"></div><button class="btn sec block" id="refresh">🔄 Actualizar datos de la base</button>${existing.user?'<div class="muted" style="font-size:12px;margin-top:6px">Tus datos completados se conservan, salvo que elijas lo contrario.</div>':''}</div>`;
    bindComplete(existing,async u=>{await DB.put('prods',{...COMPLETE.applyUser(existing,u),updated:Date.now()});toast('✓ Datos completados');location.hash='#/p/'+existing.id});
    bindRecipes(shown);
    $('#refresh').onclick=async()=>{const {photo,notes,rating,verdict,cat,id,created,name}=existing;
      const keepUser=existing.user?confirm('Tienes datos completados por ti con fotos.\n\nAceptar = conservarlos encima de los de la base\nCancelar = borrarlos y usar solo los de la base'):false;
      const keep=existing.nutr&&existing.nutr.source!=='off'&&(keepUser||existing.nutr.source!=='usuario')?existing.nutr:p.nutr||(existing.nutr&&existing.nutr.source==='usuario'?null:existing.nutr);
      let rec={...p,photo,notes,rating,verdict,cat,id,created,name:p.name||name,nutr:keep,smart:existing.smart,updated:Date.now()};
      if(keepUser)rec=COMPLETE.applyUser(rec,existing.user);else delete rec.user;
      await DB.put('prods',rec);toast('✓ Datos actualizados');location.hash='#/p/'+id};return}
  p.cat=params.get('cat')&&params.get('cat')!=='none'?params.get('cat'):(localStorage.getItem('md-lastcat')||null);
  await renderNew(p);
}
/* Producto consultado y aún sin guardar: se puede completar con fotos antes de guardarlo */
async function renderNew(p){
  view.innerHTML=infoBlock(p)+await saveForm(p,true)+`<a class="btn ghost block" href="#/scan">📷 Escanear otro</a>`;
  bindForm(p,o=>{if(o.cat)localStorage.setItem('md-lastcat',o.cat);location.hash='#/p/'+o.id});
  bindRecipes(p);
  bindComplete(p,async u=>{
    // conservar lo ya escrito en el formulario
    const v=id=>{const e=$(id);return e?e.value:undefined};
    const st={name:v('#f-name'),brand:v('#f-brand'),cat:v('#f-cat'),notes:v('#f-notes'),rating:document.querySelectorAll('#f-stars .on').length,verdict:(document.querySelector('#f-verd .on')||{}).dataset?.v||''};
    Object.assign(p,COMPLETE.applyUser(p,u));
    if(st.name!=null){p.name=st.name.trim()||p.name;p.brand=st.brand.trim();p.cat=st.cat||null;p.notes=st.notes;p.rating=st.rating;p.verdict=st.verdict}
    await renderNew(p);toast('✓ Datos completados: ahora guárdalo');
    const q=document.querySelector('.qs');if(q)q.scrollIntoView({block:'center'});
  });
}

async function vProduct(id){
  tab('home');const p=await DB.get('prods',id);if(!p){location.hash='#/';return}
  setTitle(p.name||'Producto',true);
  view.innerHTML=infoBlock(p)+(p.notes?`<div class="card"><b>📝 Mis notas</b><p style="white-space:pre-wrap;margin:6px 0 0">${esc(p.notes)}</p></div>`:'')+await saveForm(p,false)+
  `<div class="row">${p.code&&p.src!=='manual'?`<a class="btn ghost" href="https://world.${p.src==='obf'?'openbeautyfacts':'openfoodfacts'}.org/product/${esc(p.code)}" target="_blank" rel="noopener">🌐 Ver en ${p.src==='obf'?'OBF':'OFF'}</a>`:''}<button class="btn danger" id="pdel">🗑️ Borrar</button></div>`;
  bindForm(p,()=>vProduct(id));
  bindRecipes(p);
  bindComplete(p,async u=>{const cur=await DB.get('prods',id)||p;await DB.put('prods',{...COMPLETE.applyUser(cur,u),updated:Date.now()});toast('✓ Datos completados');await vProduct(id);const q=document.querySelector('.qs');if(q)q.scrollIntoView({block:'center'})});
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
    try{const l=await searchOnline(q);res.innerHTML=l.length?`<div class="plist">${l.map(p=>`<a class="pitem" href="#/lookup/${esc(p.code)}">${p.image_front_small_url?`<img loading="lazy" src="${esc(p.image_front_small_url)}">`:'<div class="noimg">📦</div>'}<div class="info"><b>${esc(offName(p)||'(sin nombre)')}</b><small>${esc(p.brands||'')} · ${esc(p.code)}</small><div class="badges">${nsBadge(p.nutriscore_grade)}</div></div></a>`).join('')}</div>`:'<div class="empty">Sin resultados.</div>'}
    catch(e){res.innerHTML='<div class="empty"><div class="big">📡</div>No se pudo buscar (¿sin conexión?). La búsqueda de Open Food Facts a veces va lenta: reinténtalo.</div>'}
  };
  $('#t-local').onclick=()=>{online=false;draw()};$('#t-online').onclick=()=>{online=true;draw()};
  let t;$('#q').addEventListener('input',()=>{if(!online){clearTimeout(t);t=setTimeout(draw,150)}});
  $('#q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.target.blur();draw()}});
  draw();
}

async function vAjustes(){
  setTitle('Ajustes');tab('ajustes');
  const [cs,ps]=await Promise.all([cats(),prods()]);const count={};ps.forEach(p=>count[p.cat]=(count[p.cat]||0)+1);let nFav=0;try{nFav=(await DB.all('favs')).length}catch(e){}
  let est='';try{if(navigator.storage?.estimate){const e=await navigator.storage.estimate();est=` · ${(e.usage/1048576).toFixed(1)} MB usados`}}catch(e){}
  view.innerHTML=`<div class="card"><h3 style="margin:0 0 8px">🗂️ Categorías</h3><div class="plist" id="clist">${cs.map((c,i)=>`<div class="pitem" style="border-left:6px solid ${c.color}"><div class="noimg">${esc(c.emoji||'📦')}</div><div class="info"><b>${esc(c.name)}</b><small>${count[c.id]||0} productos</small></div>
    <button class="iconbtn" style="background:#f3f4f6;color:#111;font-size:18px" data-up="${i}" ${i?'':'disabled'} aria-label="Subir">▲</button><button class="iconbtn" style="background:#f3f4f6;color:#111;font-size:18px" data-ed="${c.id}" aria-label="Editar">✏️</button></div>`).join('')}</div>
    <div style="height:10px"></div><button class="btn sec block" id="addc">＋ Nueva categoría</button></div>
  <div class="card"><h3 style="margin:0 0 6px">💾 Copia de seguridad</h3><p class="muted" style="margin:0 0 10px">Tus datos se guardan solo en este móvil (${ps.length} productos${est}). Exporta de vez en cuando un archivo para no perderlos o pasarlos a otro móvil.</p>
    <button class="btn block" id="exp">⬇️ Exportar copia (JSON)</button><div style="height:8px"></div>
    <label class="btn ghost block" style="margin:0">⬆️ Importar copia<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
  <div class="card"><h3 style="margin:0 0 6px">🟢 Nota rápida (0-100)</h3><p style="font-size:14px;margin:4px 0">Se calcula sola: <b>60 %</b> calidad nutricional (Nutri-Score), <b>30 %</b> aditivos y <b>10 %</b> ecológico. Si hay un aditivo de riesgo alto, la nota no pasa de 49. En cosméticos se mira el riesgo de los ingredientes.</p>
    <div class="badges"><span class="badge qsb" style="--c:#15803d"><i></i>75-100 Excelente</span><span class="badge qsb" style="--c:#65a30d"><i></i>50-74 Bueno</span><span class="badge qsb" style="--c:#f97316"><i></i>25-49 Mediocre</span><span class="badge qsb" style="--c:#dc2626"><i></i>0-24 Malo</span></div>
    <p class="muted" style="font-size:13px">Es independiente de tu valoración personal (estrellas y veredicto). La clasificación de ${ADDITIVES.count} aditivos es orientativa, elaborada a partir de fuentes públicas (EFSA, IARC); no procede de Yuka.</p></div>
  <div class="card"><h3 style="margin:0 0 6px">💛 Mis recetas</h3><p class="muted" style="margin:0 0 10px">Las recetas que marques con la estrella en un producto (cuando la nota sea 50 o más) se guardan en este móvil.</p>
    <a class="btn ghost block" href="#/recetas">Ver mis recetas${nFav?` (${nFav})`:''}</a></div>
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
  const data={app:'mi-despensa',name:'Alimentos Sanos',version:APP_VERSION,exported:new Date().toISOString(),cats:await DB.all('cats'),prods:await DB.all('prods')};try{data.favs=await DB.all('favs')}catch(e){data.favs=[]}
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});const name=`alimentos-sanos-${new Date().toISOString().slice(0,10)}.json`;
  const file=new File([blob],name,{type:'application/json'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'Copia Alimentos Sanos'});return}catch(e){if(e.name==='AbortError')return}}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);toast('Copia descargada');
}
async function importData(f){
  try{const d=JSON.parse(await f.text());if(d.app!=='mi-despensa'||!Array.isArray(d.prods))throw 0;
    const replace=confirm(`Copia con ${d.prods.length} productos y ${d.cats.length} categorías.\n\nAceptar = REEMPLAZAR todo lo actual\nCancelar = AÑADIR / combinar con lo actual`);
    if(replace){await DB.clear('prods');await DB.clear('cats')}
    await DB.bulkPut('cats',d.cats);await DB.bulkPut('prods',d.prods);if(Array.isArray(d.favs)){try{if(replace)await DB.clear('favs');await DB.bulkPut('favs',d.favs)}catch(e){}}localStorage.setItem('md-init','1');toast('✓ Copia importada');vAjustes();
  }catch(e){alert('Ese archivo no es una copia válida de Alimentos Sanos.')}
}

/* ---------- Router ---------- */
async function route(){
  await stopScan();closeSheet();
  const h=location.hash.slice(1)||'/';const [path,qs]=h.split('?');const params=new URLSearchParams(qs||'');const seg=path.split('/').filter(Boolean);
  window.scrollTo(0,0);
  try{
    if(!seg.length)return vHome();
    switch(seg[0]){case 'cat':return vCat(seg[1]);case 'smart':return vSmart(seg[1]);case 'scan':return vScan(params);case 'lookup':return vLookup(seg[1],params);case 'p':return vProduct(seg[1]);case 'manual':return vManual(params);case 'buscar':return vBuscar(params);case 'ajustes':return vAjustes();case 'recetas':return vRecetas();default:location.hash='#/'}
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
// cámara: soltarla al salir de la app y reabrirla al volver a la pantalla de escanear
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(Scanner.active())Scanner.stop()}else if(location.hash.startsWith('#/scan')&&!Scanner.active())route()});
