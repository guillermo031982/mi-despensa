/* Alimentos Sanos · nutrición: regla de la fibra (Detecta Fibra), declaraciones UE (Reglamento 1924/2006)
   y lector de tablas nutricionales a partir de las palabras del OCR (con posición). Funciones puras. */
(function(root){
const num=v=>v===''||v==null||isNaN(+v)?null:+v;

/* Regla de la fibra: fibra × 5 ≥ hidratos (mismo base 100 g/100 ml). Hidratos 0 → cumple solo si fibra > 0.
   Fibra ausente = desconocido (null), nunca cero. Los azúcares nunca se usan como hidratos. */
function fiberRule(fiber,carbs){
  const f=num(fiber),c=num(carbs);
  if(f==null||c==null)return null;
  if(c===0)return f>0;
  return f*5>=c-1e-9;
}
/* Clave de ranking: fibra/hidratos descendente; hidratos 0 con fibra primero (Infinity). */
function fiberRatio(fiber,carbs){
  const f=num(fiber),c=num(carbs);
  if(f==null||c==null)return null;
  if(c===0)return f>0?Infinity:0;
  return f/c;
}
/* Reglamento (CE) 1924/2006 */
function fiberClaim(fiber,kcal){
  const f=num(fiber),k=num(kcal);if(f==null)return null;
  const per100kcal=k>0?f*100/k:null;
  if(f>=6||(per100kcal!=null&&per100kcal>=3))return 'alto';
  if(f>=3||(per100kcal!=null&&per100kcal>=1.5))return 'fuente';
  return 'no';
}
function proteinShare(protein,kcal){const p=num(protein),k=num(kcal);if(p==null||!(k>0))return null;return p*4/k}
function proteinClaim(protein,kcal){const s=proteinShare(protein,kcal);if(s==null)return null;return s>=0.20-1e-9?'alto':s>=0.12-1e-9?'fuente':'no'}

/* Evalúa un objeto nutr {fiber,carbs,protein,kcal,base} */
function evaluate(n){
  n=n||{};
  return {rule:fiberRule(n.fiber,n.carbs),ratio:fiberRatio(n.fiber,n.carbs),fiber:fiberClaim(n.fiber,n.kcal),protein:proteinClaim(n.protein,n.kcal),proteinShare:proteinShare(n.protein,n.kcal)};
}
/* Pertenencia a secciones inteligentes: la marca manual del usuario manda; si no, lo calculado. */
function sections(p){
  const e=evaluate(p.nutr),o=p.smart||{};
  return {fibra:o.fibra!=null?!!o.fibra:e.rule===true, altoFibra:o.altoFibra!=null?!!o.altoFibra:e.fiber==='alto', altoProteina:o.altoProteina!=null?!!o.altoProteina:e.protein==='alto'};
}

/* Comprobaciones de verosimilitud (no se adivinan decimales: solo se avisa) */
function warnings(n){
  const w=[],f=num(n.fiber),c=num(n.carbs),p=num(n.protein),k=num(n.kcal),fat=num(n.fat);
  for(const [v,l] of [[f,'fibra'],[c,'hidratos'],[p,'proteínas'],[fat,'grasas']])if(v!=null&&v>100)w.push(`${l} > 100 g: ¿falta una coma decimal?`);
  if(k!=null&&k>900)w.push('Más de 900 kcal por 100: revisa el valor energético');
  const s=[f,c,p,fat].filter(v=>v!=null).reduce((a,b)=>a+b,0);if(s>100.5)w.push('La suma de nutrientes supera 100 g: revisa los decimales');
  if(k!=null&&c!=null&&p!=null&&fat!=null){const calc=4*c+4*p+9*fat+2*(f||0);if(Math.abs(calc-k)>Math.max(30,0.25*k))w.push(`Las kcal no cuadran con los nutrientes (≈${Math.round(calc)} kcal calculadas): revisa decimales`)}
  return w;
}

/* ---------- Lector de tabla nutricional ----------
   words: [{text, bbox:{x0,y0,x1,y1}}] (salida de Tesseract). Devuelve {fiber,carbs,protein,kcal,fat,base,found,notes} */
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const LABELS={
  fiber:/(fibra|fibre|fiber|ballaststoff)/,
  carbs:/(hidratos|carbohidrat|carbohydrat|glucid|kohlenhydrat)/,
  protein:/(protein|proteina|eiweiss)/,
  fat:/(^|[^a-z])(grasa|grasas|fat|fats|lipidos|fett)([^a-z]|$)/,
  energy:/(energ|kcal|kj\b|calorias)/,
};
const EXCL={carbs:/(azucar|sugar|zucker|polialcohol|almidon|starch)/,fat:/(saturad|saturat|insatur|unsatur|trans|gesatt)/,fiber:/$^/,protein:/$^/,energy:/$^/};
function cleanTok(t){
  // corrige confusiones típicas del OCR solo dentro de tokens que ya parecen números
  let s=String(t).trim().replace(/[‚]/g,',').replace(/[‘’'`´]/g,'').replace(/^[T|\[!¡«»](?=\d)/,'');
  if(/\d/.test(s)&&/^[<≤~]?[\dOoIl|SB.,]+(g|mg|kcal|kj|ml|%)?$/i.test(s))s=s.replace(/[Oo](?=[\d.,]|$|g)/g,'0').replace(/[Il|](?=[\d.,])/g,'1');
  return s;
}
/* Inclinación de la foto: pendiente mediana de las líneas base que da Tesseract (o de pares de palabras de la misma línea) */
function skewOf(words){
  const sl=[];const seen=new Set();
  for(const w of words){const l=w.line;if(!l||seen.has(l))continue;seen.add(l);const b=l.baseline;
    if(b&&b.x1-b.x0>60&&Math.abs((b.y1-b.y0)/(b.x1-b.x0))<0.2)sl.push({s:(b.y1-b.y0)/(b.x1-b.x0),w:b.x1-b.x0})}
  if(!sl.length)return 0;sl.sort((a,b)=>a.s-b.s);
  let tot=sl.reduce((a,b)=>a+b.w,0),acc=0;for(const x of sl){acc+=x.w;if(acc>=tot/2)return x.s}return 0;
}
function buildRows(words){
  const k=skewOf(words);
  const ws=words.filter(w=>w&&w.text&&w.text.trim()&&w.bbox).map(w=>{const b=w.bbox,xc=(b.x0+b.x1)/2,dy=-k*xc;return {t:cleanTok(w.text),x0:b.x0,x1:b.x1,y0:b.y0+dy,y1:b.y1+dy,yc:(b.y0+b.y1)/2+dy,h:Math.max(1,b.y1-b.y0),xc,oy0:b.y0,oy1:b.y1}}).sort((a,b)=>a.yc-b.yc);
  const hs=ws.map(w=>w.h).sort((a,b)=>a-b);const mh=hs[Math.floor(hs.length/2)]||10;
  const rows=[];
  for(const w of ws){
    let best=null,bd=1e9;
    for(const r of rows.slice(-4)){const d=Math.abs(r.yc-w.yc);if(d<Math.max(0.55*mh,0.45*Math.min(w.h,r.h)*1.2)&&d<bd){bd=d;best=r}}
    if(best){best.w.push(w);best.yc=(best.yc*(best.w.length-1)+w.yc)/best.w.length;best.h=Math.max(best.h,w.h)}else rows.push({w:[w],yc:w.yc,h:w.h});
  }
  rows.forEach(r=>{r.w.sort((a,b)=>a.x0-b.x0);r.text=norm(r.w.map(x=>x.t).join(' '))});
  return {rows,mh};
}
/* Extrae números de una fila (a partir de un índice), uniendo "2 ,5"/"2, 5" y descartando porcentajes (%IR) */
function numbersIn(row,from){
  const w=row.w,out=[];
  for(let i=from;i<w.length;i++){
    let t=w[i].t,x0=w[i].x0,x1=w[i].x1,y0=w[i].oy0??w[i].y0,y1=w[i].oy1??w[i].y1;
    // unir decimales partidos en varios tokens
    if(/^\d+$/.test(t)&&w[i+1]&&/^[.,]\d+/.test(w[i+1].t)&&w[i+1].x0-x1<row.h*0.6){t+=w[i+1].t;x1=w[i+1].x1;y0=Math.min(y0,w[i+1].oy0??w[i+1].y0);y1=Math.max(y1,w[i+1].oy1??w[i+1].y1);i++}
    else if(/^\d+[.,]$/.test(t)&&w[i+1]&&/^\d+/.test(w[i+1].t)&&w[i+1].x0-x1<row.h*0.6){t+=w[i+1].t;x1=w[i+1].x1;y0=Math.min(y0,w[i+1].oy0??w[i+1].y0);y1=Math.max(y1,w[i+1].oy1??w[i+1].y1);i++}
    const nextT=w[i+1]?norm(w[i+1].t):'';
    for(const part of t.split('/')){
      const m=norm(part).match(/^[(\[]?([<≤~]?)(\d{1,5}(?:[.,]\d{1,3})?)\s*(g|gr|mg|kcal|kj|ml|%)?[)\],;:*]*$/);
      if(!m)continue;
      let unit=m[3]||'';
      if(!unit&&/^(g|gr|mg|kcal|kj|ml|%)[)\],;:*]*$/.test(nextT))unit=nextT.replace(/[^a-z%]/g,'');
      if(!unit&&/^%/.test(nextT))unit='%';
      if(unit==='%')continue;
      // número entero de varios dígitos seguido por "%": ya descartado; los valores sin unidad se aceptan
      let v=parseFloat(m[2].replace(',','.'));if(unit==='mg')v=v/1000;
      out.push({v,raw:m[1]+m[2],lt:!!m[1],unit,xc:(x0+x1)/2,x0,x1,y0,y1,parts:t.split('/').length,tok:t});
    }
  }
  return out;
}
function findHeader(rows){
  let col100=null,portion=null,base=null;
  for(const r of rows){
    const t=r.text;
    for(let i=0;i<r.w.length;i++){
      const a=norm(r.w[i].t),b=r.w[i+1]?norm(r.w[i+1].t):'';
      const m=(a+' '+b).replace(/\b(mi|m1|mt)\b/,'ml').match(/^(?:por|per|pro|\/)?\s*100\s*(g|gr|ml)\b/)||a.replace(/(mi|m1)$/,'ml').match(/100(g|gr|ml)/);
      if(m&&!col100){const end=/^(g|gr|ml|mi|m1)/.test(b)&&!/100(g|gr|ml)/.test(a)?r.w[i+1]:r.w[i];col100={xc:(r.w[i].x0+end.x1)/2,y:r.yc};base=/ml/.test(m[1])?'100 ml':'100 g'}
    }
    if(!portion&&/(porcion|racion|serving|envase|unidad|portion|por toma|per pack|por vaso|por barrita|por galleta)/.test(t)){
      const i=r.w.findIndex(w=>/(porcion|racion|serving|envase|unidad|portion|toma|vaso|barrita|galleta)/.test(norm(w.t)));
      if(i>=0)portion={xc:r.w[i].xc,y:r.yc};
    }
  }
  return {col100,portion,base};
}
function pickColumn(nums,hdr){
  if(!nums.length)return null;
  if(hdr.col100){const n=nums.slice().sort((a,b)=>Math.abs(a.xc-hdr.col100.xc)-Math.abs(b.xc-hdr.col100.xc))[0];
    // si solo queda la columna de la porción, mejor vacío que un valor de otra columna
    if(hdr.portion&&Math.abs(n.xc-hdr.portion.xc)<Math.abs(n.xc-hdr.col100.xc))return null;return n}
  if(hdr.portion){const far=nums.filter(n=>Math.abs(n.xc-hdr.portion.xc)>30);if(far.length)return far[0]}
  return nums[0]; // en las etiquetas UE la primera columna es por 100 g/100 ml
}
function parseNutritionWords(words){
  const {rows,mh}=buildRows(words);
  const hdr=findHeader(rows);
  const res={fiber:null,carbs:null,protein:null,kcal:null,fat:null,base:hdr.base||null,found:[],notes:[],boxes:{}};
  const labelEnd=(r,re)=>{for(let i=0;i<r.w.length;i++){if(re.test(norm(r.w[i].t))){let j=i+1;while(j<r.w.length&&!/\d/.test(r.w[j].t))j++;return j}}
    // etiqueta partida en varios tokens: cuenta palabras sin dígitos al inicio
    let j=0;while(j<r.w.length&&!/\d/.test(r.w[j].t))j++;return j};
  for(const key of ['fiber','carbs','protein','fat']){
    for(let ri=0;ri<rows.length;ri++){
      const r=rows[ri];if(!LABELS[key].test(r.text)||EXCL[key].test(r.text))continue;
      if(key==='carbs'&&/(de los cuales|de las cuales|of which)/.test(r.text)&&!/hidratos|carbohidrat|carbohydrat/.test(r.text))continue;
      let nums=numbersIn(r,labelEnd(r,LABELS[key])).filter(n=>!/kcal|kj/.test(n.unit));
      // etiqueta en dos líneas ("Hidratos de / carbono"): mirar la fila siguiente si esta no tiene números
      if(!nums.length&&rows[ri+1]&&rows[ri+1].yc-r.yc<mh*2.2&&!Object.values(LABELS).some(re=>re.test(rows[ri+1].text)))nums=numbersIn(rows[ri+1],0).filter(n=>!/kcal|kj/.test(n.unit));
      const n=pickColumn(nums,hdr);if(n){res[key]=n.v;res.boxes[key]=n;res.found.push(key);if(n.lt)res.notes.push(`${key}: "<${n.raw}" en la etiqueta`);break}
    }
  }
  // Energía: buscar kcal en la columna por 100 (fila de energía y la siguiente)
  for(let ri=0;ri<rows.length&&res.kcal==null;ri++){
    const r=rows[ri];if(!/(energ|valor energetico|calorias|kcal|kj)/.test(r.text))continue;
    let nums=numbersIn(r,labelEnd(r,LABELS.energy));
    if(rows[ri+1]&&rows[ri+1].yc-r.yc<mh*2.2&&!/(grasa|fat|hidratos|protein|fibra)/.test(rows[ri+1].text))nums=nums.concat(numbersIn(rows[ri+1],0).map(n=>({...n,next:true})));
    let kc=nums.filter(n=>n.unit==='kcal');
    if(!kc.length&&/kj\s*\/?\s*kcal|kj.*kcal/.test(r.text)){ // "Valor energético kJ/kcal 1500/360"
      const nn=nums.filter(n=>!n.unit);for(let i=0;i+1<nn.length;i++){if(nn[i].v>0&&Math.abs(nn[i].v/nn[i+1].v-4.184)<0.45){kc.push({...nn[i+1]});}}
    }
    if(!kc.length){const nn=nums.filter(n=>n.unit!=='kj');for(const a of nums)for(const b of nn)if(a!==b&&b.v>0&&Math.abs(a.v/b.v-4.184)<0.45)kc.push(b)}
    if(kc.length){const n=pickColumn(kc,hdr);res.kcal=n.v;if(n.parts===1)res.boxes.kcal=n;res.found.push('kcal');break}
    const kj=nums.filter(n=>n.unit==='kj');
    if(kj.length){res.kcal=Math.round(pickColumn(kj,hdr).v/4.184);res.found.push('kcal');res.notes.push('kcal calculadas a partir de kJ');break}
  }
  if(!res.base)res.base=rows.some(r=>/100\s*ml/.test(r.text))?'100 ml':'100 g';
  if(!hdr.col100)res.notes.push('No se encontró la cabecera "por 100 g": se tomó la primera columna');
  res.headerFound=!!hdr.col100;
  return res;
}
const api={skewOf,fiberRule,fiberRatio,fiberClaim,proteinClaim,proteinShare,evaluate,sections,warnings,parseNutritionWords,buildRows};
if(typeof module!=='undefined')module.exports=api;else root.NUTR=api;
})(this);
