/* Alimentos Sanos · nota rápida 0-100 (inspirada en el método público de Yuka: 60 % calidad nutricional
   según el Nutri-Score, 30 % aditivos, 10 % ecológico; un aditivo de riesgo alto limita la nota a 49).
   Para cosméticos: nota según el riesgo de los ingredientes. Cálculo propio y orientativo. Funciones puras. */
(function(root){
const AD=()=>root.ADDITIVES;
const num=v=>v===''||v==null||isNaN(+v)?null:+v;
const GRADES=[{min:75,k:'ex',t:'Excelente',c:'#15803d'},{min:50,k:'bu',t:'Bueno',c:'#65a30d'},{min:25,k:'me',t:'Mediocre',c:'#f97316'},{min:0,k:'ma',t:'Malo',c:'#dc2626'}];
const gradeOf=s=>GRADES.find(g=>s>=g.min);

/* ---- Nutri-Score 2023 (tablas oficiales) por si OFF no trae el cálculo ---- */
const pts=(v,th)=>{if(v==null)return null;let p=0;for(const t of th)if(v>t)p++;return p};
const T={food:{energy:[335,670,1005,1340,1675,2010,2345,2680,3015,3350],sugars:[3.4,6.8,10,14,17,20,24,27,31,34,37,41,44,48,51],
    saturated_fat:[1,2,3,4,5,6,7,8,9,10],salt:[.2,.4,.6,.8,1,1.2,1.4,1.6,1.8,2,2.2,2.4,2.6,2.8,3,3.2,3.4,3.6,3.8,4],
    fiber:[3,4.1,5.2,6.3,7.4],proteins:[2.4,4.8,7.2,9.6,12,14,17]},
  bev:{energy:[30,90,150,210,240,270,300,330,360,390],sugars:[.5,2,3.5,5,6,7,8,9,10,11],
    saturated_fat:[1,2,3,4,5,6,7,8,9,10],salt:[.2,.4,.6,.8,1,1.2,1.4,1.6,1.8,2,2.2,2.4,2.6,2.8,3,3.2,3.4,3.6,3.8,4],
    fiber:[3,4.1,5.2,6.3,7.4],proteins:[1.2,1.5,1.8,2.1,2.4,2.7,3]}};
const MAX={food:{energy:10,sugars:15,saturated_fat:10,salt:20,fiber:5,proteins:7,fruits_vegetables_legumes:5},bev:{energy:10,sugars:10,saturated_fat:10,salt:20,fiber:5,proteins:7,fruits_vegetables_legumes:6,non_nutritive_sweeteners:4}};
function fvlPts(v,bev){if(v==null)return 0;return bev?(v>80?6:v>60?4:v>40?2:0):(v>80?5:v>60?2:v>40?1:0)}
/* nx = {energy(kJ),sugars,saturated_fat,salt,fiber,proteins,fvl,bev,water} por 100 g/ml */
function computeNS(nx){
  if(!nx)return null;const bev=!!nx.bev,t=bev?T.bev:T.food;
  if(nx.water)return {bev:true,water:true,score:-99,grade:'a',cmp:{}};
  const need=['energy','sugars','saturated_fat','salt'];if(need.some(k=>num(nx[k])==null))return null;
  const cmp={};for(const k of ['energy','sugars','saturated_fat','salt','fiber','proteins']){const v=num(nx[k]);cmp[k]={v,p:v==null?0:pts(v,t[k]),m:MAX[bev?'bev':'food'][k]}}
  cmp.fruits_vegetables_legumes={v:num(nx.fvl),p:fvlPts(num(nx.fvl),bev),m:MAX[bev?'bev':'food'].fruits_vegetables_legumes};
  const N=cmp.energy.p+cmp.sugars.p+cmp.saturated_fat.p+cmp.salt.p;
  const prot=(!bev&&N>=11)?0:cmp.proteins.p; // regla 2023: con N ≥ 11 no cuentan las proteínas (alimentos)
  const score=N-(prot+cmp.fiber.p+cmp.fruits_vegetables_legumes.p);
  const grade=bev?(score<=2?'b':score<=6?'c':score<=9?'d':'e'):(score<=0?'a':score<=2?'b':score<=10?'c':score<=18?'d':'e');
  return {bev,score,grade,cmp,computed:true};
}
/* Datos compactos desde el JSON de OFF (nutriscore_data + nutriments) */
function fromOFF(p){
  const d=p.nutriscore_data||null,n=p.nutriments||{};let nsd=null;
  if(d&&d.components){const cmp={};for(const side of ['negative','positive'])for(const c of d.components[side]||[])cmp[c.id]={v:num(c.value),p:num(c.points)||0,m:num(c.points_max)};
    nsd={bev:!!d.is_beverage,water:!!d.is_water,score:num(d.score),grade:d.grade||'',cmp}}
  const g=k=>num(n[k]);
  let energy=g('energy-kj_100g');if(energy==null&&g('energy-kcal_100g')!=null)energy=Math.round(g('energy-kcal_100g')*4.184);if(energy==null&&(n.energy_unit||'kJ').toLowerCase()==='kj')energy=g('energy_100g');
  const cats=p.categories_tags||[];
  const nx={energy,sugars:g('sugars_100g'),saturated_fat:g('saturated-fat_100g'),salt:g('salt_100g')??(g('sodium_100g')!=null?g('sodium_100g')*2.5:null),fiber:g('fiber_100g'),proteins:g('proteins_100g'),
    fvl:g('fruits-vegetables-legumes-estimate-from-ingredients_100g')??g('fruits-vegetables-nuts-estimate-from-ingredients_100g'),
    bev:cats.includes('en:beverages')&&!cats.includes('en:alcoholic-beverages'),water:cats.includes('en:waters')&&!cats.includes('en:flavoured-waters')};
  const labels=(p.labels_tags||[]).join(' ');
  const bio=/en:organic|en:eu-organic|bio\b|ecolog|biolog/i.test(labels)||/(^|,|\s)(bio|ecológico|ecologico|organic|biológico|agricultura ecológica)(\s|,|$)/i.test(p.labels||'');
  const na=p.nutriscore_grade==='not-applicable'||cats.includes('en:alcoholic-beverages');
  return {nsd,nsScore:num(p.nutriscore_score),nx,bio,nsNA:na};
}

/* Nutri-Score → 0-100. Bandas por letra (A 80-100 · B 60-79 · C 40-59 · D 20-39 · E 0-19) con interpolación por puntos. */
const BANDS={food:{a:[-8,0],b:[1,2],c:[3,10],d:[11,18],e:[19,40]},bev:{a:[0,0],b:[-4,2],c:[3,6],d:[7,9],e:[10,25]}};
const OUT={a:[100,80],b:[79,60],c:[59,40],d:[39,20],e:[19,0]};
function nutriPart(grade,score,bev,water){
  if(water)return 100;if(!/^[a-e]$/.test(grade||''))return null;
  const [o1,o2]=OUT[grade];if(score==null)return Math.round((o1+o2)/2);
  const [s1,s2]=BANDS[bev?'bev':'food'][grade];if(s1===s2)return o1;
  const x=Math.max(s1,Math.min(s2,score));return Math.round(o1+(o2-o1)*(x-s1)/(s2-s1));
}
function additivesPart(list){
  const items=(list||[]).map(c=>AD().info(c));let v=100;
  for(const a of items)v-=a.level===3?60:a.level===2?30:a.level===1?10:a.level===0?0:5;
  return {v:Math.max(0,v),items,high:items.some(a=>a.level===3)};
}
/* Puntos fuertes y débiles a partir de los puntos del Nutri-Score de cada nutriente */
const NEG={energy:{l:'Calorías',u:'kcal',f:[1,3],t:['Pocas calorías','Algo calórico','Muy calórico']},
  sugars:{l:'Azúcar',u:'g',f:[1,5],t:['Poco azúcar','Azúcar moderado','Mucho azúcar']},
  saturated_fat:{l:'Grasa saturada',u:'g',f:[1,4],t:['Poca grasa saturada','Algo de grasa saturada','Mucha grasa saturada']},
  salt:{l:'Sal',u:'g',f:[2,7],t:['Poca sal','Sal moderada','Mucha sal']}};
const POS={fiber:{l:'Fibra',u:'g',min:1,t:['Algo de fibra','Rico en fibra'],hi:3},proteins:{l:'Proteína',u:'g',min:3,t:['Fuente de proteína','Rico en proteína'],hi:5},
  fruits_vegetables_legumes:{l:'Fruta/verdura',u:'%',min:1,t:['Algo de fruta/verdura','Mucha fruta/verdura'],hi:2}};
function highlights(ns){
  const pos=[],neg=[];if(!ns||!ns.cmp)return {pos,neg};
  const fmtv=(k,v)=>v==null?'':(k==='energy'?Math.round(v/4.184)+' kcal':String(Math.round(v*10)/10).replace('.',',')+' '+(k==='fruits_vegetables_legumes'?'%':'g'));
  for(const [k,d] of Object.entries(NEG)){const c=ns.cmp[k];if(!c||c.v==null)continue;
    if(c.p<=d.f[0])pos.push({k,l:d.l,v:fmtv(k,c.v),t:d.t[0],lv:0});else if(c.p<=d.f[1])neg.push({k,l:d.l,v:fmtv(k,c.v),t:d.t[1],lv:2});else neg.push({k,l:d.l,v:fmtv(k,c.v),t:d.t[2],lv:3})}
  const sw=ns.cmp.non_nutritive_sweeteners;if(sw&&sw.v>0)neg.push({k:'sw',l:'Edulcorantes',v:'',t:'Contiene edulcorantes',lv:2});
  for(const [k,d] of Object.entries(POS)){const c=ns.cmp[k];if(!c||c.v==null)continue;
    if(c.p>=d.hi)pos.push({k,l:d.l,v:fmtv(k,c.v),t:d.t[1],lv:0});else if(c.p>=d.min)pos.push({k,l:d.l,v:fmtv(k,c.v),t:d.t[0],lv:1})}
  neg.sort((a,b)=>b.lv-a.lv);return {pos,neg};
}

/* ---- Cosméticos: riesgo de ingredientes (INCI) ---- */
const COSM=[
 [3,'Triclosán',/triclos[aá]n/,'Antibacteriano; disruptor endocrino, muy restringido en la UE.'],
 [3,'Triclocarbán',/triclocarban/,'Antibacteriano; posible disruptor endocrino.'],
 [3,'Butilparabeno / propilparabeno',/(butyl|propyl)paraben/,'Parabenos de cadena larga: posibles disruptores endocrinos (restringidos en la UE).'],
 [3,'Isobutil / isopropilparabeno',/iso(butyl|propyl)paraben/,'Parabenos prohibidos en la UE desde 2014.'],
 [3,'Metilisotiazolinona',/methyl(chloro)?isothiazolinone/,'Conservante muy alergénico; prohibido en productos sin aclarado.'],
 [3,'Liberador de formaldehído',/dmdm hydantoin|quaternium-15|imidazolidinyl urea|diazolidinyl urea|bronopol|bromo-2-nitropropane|sodium hydroxymethylglycinate|\bformaldehyde\b|methenamine/,'Libera formaldehído, cancerígeno (IARC grupo 1) y alergénico.'],
 [3,'Oxibenzona (benzofenona-3)',/benzophenone-3|oxybenzone/,'Filtro UV, posible disruptor endocrino; la UE limitó su concentración.'],
 [3,'4-MBC',/4-methylbenzylidene camphor/,'Filtro UV, posible disruptor endocrino.'],
 [3,'BHA',/\bbha\b|butylated hydroxyanisole/,'Posible cancerígeno (IARC 2B) y disruptor endocrino.'],
 [3,'Lilial',/butylphenyl methylpropional|\blilial\b/,'Perfume tóxico para la reproducción, prohibido en la UE desde 2022.'],
 [3,'Hidroquinona',/hydroquinone/,'Despigmentante prohibido en cosmética de venta libre en la UE.'],
 [3,'Ciclotetrasiloxano (D4)',/cyclotetrasiloxane/,'Silicona tóxica para la reproducción y persistente; restringida en la UE.'],
 [2,'Ciclopentasiloxano (D5) / D6',/cyclopentasiloxane|cyclohexasiloxane|cyclomethicone/,'Siliconas persistentes en el medio ambiente; restringidas en la UE.'],
 [2,'BHT',/\bbht\b|butylated hydroxytoluene/,'Antioxidante; posible disruptor endocrino.'],
 [2,'Filtro UV dudoso',/ethylhexyl methoxycinnamate|octinoxate|homosalate|octocrylene/,'Filtro UV; posible disruptor endocrino o fuente de benzofenona.'],
 [2,'Sales de aluminio',/alumin(i)?um chlorohydrate|aluminum zirconium|aluminium zirconium|aluminum chloride|aluminium chloride/,'Antitranspirante; dudas sobre la exposición al aluminio.'],
 [2,'Talco',/\btalc\b/,'La IARC lo clasificó como probable cancerígeno (2A) en 2024.'],
 [2,'Resorcinol',/resorcinol/,'Tinte capilar; posible disruptor del tiroides y alergénico.'],
 [1,'Perfume',/\bparfum\b|\bfragrance\b|\baroma\b/,'Mezcla no detallada; puede contener alérgenos.'],
 [1,'Alérgenos de perfume',/\blimonene\b|\blinalool\b|\bcitral\b|\bgeraniol\b|\beugenol\b|\bcoumarin\b|\bcitronellol\b|hexyl cinnamal|benzyl salicylate|alpha-isomethyl ionone|benzyl benzoate|cinnamal/,'Alérgenos de declaración obligatoria.'],
 [1,'Sulfatos',/sodium lauryl sulfate|ammonium lauryl sulfate|sodium laureth sulfate|ammonium laureth sulfate/,'Tensioactivos que pueden irritar la piel.'],
 [1,'PEG',/\bpeg-\d+|\bppg-\d+/,'Pueden contener impurezas (óxido de etileno, 1,4-dioxano).'],
 [1,'Metil / etilparabeno',/(^|[^l])(methyl|ethyl)paraben/,'Parabenos cortos: seguros según la UE a dosis permitidas.'],
 [1,'Fenoxietanol',/phenoxyethanol/,'Conservante; seguro según la UE hasta el 1 %, irritante en sensibles.'],
 [1,'Aceites minerales',/paraffinum liquidum|mineral oil|petrolatum|cera microcristallina|microcrystalline wax/,'Derivados del petróleo; posible contaminación por hidrocarburos (MOAH).'],
 [1,'Polímeros sintéticos',/\bpolyethylene\b|acrylates.{0,20}copolymer|\bnylon-\d+/,'Plásticos/microplásticos persistentes.'],
 [1,'Trietanolamina',/triethanolamine|\btea\b/,'Puede formar nitrosaminas.']];
function cosmetic(text){
  const s=String(text||'').toLowerCase();if(s.trim().length<8)return null;
  const hits=[];for(const [lv,name,re,desc] of COSM)if(re.test(s))hits.push({level:lv,name,desc,...AD().LEVELS[lv]});
  let v=100;for(const h of hits)v-=h.level===3?40:h.level===2?20:5;v=Math.max(0,v);
  const high=hits.some(h=>h.level===3);if(high)v=Math.min(v,49);
  hits.sort((a,b)=>b.level-a.level);
  return {type:'cosm',score:v,grade:gradeOf(v),hits,capped:high};
}

/* ---- Nota principal ---- */
function evaluate(p){
  if(!p)return {score:null,reason:'Sin nota (faltan datos)'};
  if(p.src==='obf'){const c=cosmetic(p.ingredients);return c||{type:'cosm',score:null,reason:'Sin nota (faltan los ingredientes)'}}
  if(p.nsNA)return {score:null,reason:'Sin nota (el Nutri-Score no se aplica a este producto)'};
  let ns=p.nsd&&p.nsd.cmp?p.nsd:null;
  if(!ns&&p.nx)ns=computeNS(p.nx);
  const grade=(ns&&/^[a-e]$/.test(ns.grade)?ns.grade:'')||(/^[a-e]$/.test(p.nutriscore||'')?p.nutriscore:'');
  const score=ns&&ns.score!=null&&ns.score!==-99?ns.score:num(p.nsScore);
  const nutri=nutriPart(grade,score,ns?ns.bev:!!(p.nx&&p.nx.bev),ns&&ns.water);
  if(nutri==null)return {score:null,reason:'Sin nota (faltan datos)'};
  const ad=additivesPart(p.additives);
  const bio=p.bio!=null?!!p.bio:/(^|,|\s)(bio|ecológico|ecologico|organic|biológico|en:organic)(\s|,|$)/i.test(p.labels||'');
  let total=Math.round(nutri*0.6+ad.v*0.3+(bio?100:0)*0.1);
  const capped=ad.high&&total>49;if(ad.high)total=Math.min(total,49);
  return {type:'food',score:total,grade:gradeOf(total),capped,nsGrade:grade,computed:!!(ns&&ns.computed),
    parts:[{k:'nutri',l:'Nutrición',w:60,v:nutri,pts:Math.round(nutri*0.6)},{k:'add',l:'Aditivos',w:30,v:ad.v,pts:Math.round(ad.v*0.3)},{k:'bio',l:'Ecológico',w:10,v:bio?100:0,pts:bio?10:0}],
    additives:ad.items,bio,hl:highlights(ns),detail:!!ns};
}
root.SCORE={evaluate,fromOFF,computeNS,nutriPart,additivesPart,cosmetic,gradeOf,GRADES};
})(typeof window!=='undefined'?window:globalThis);
