/* Alimentos Sanos · "Completar con fotos": funciones puras para leer la lista de ingredientes
   (aditivos por número E o por nombre, alérgenos y trazas, ecológico, letra del Nutri-Score impresa)
   y para mezclar los datos que pone el usuario con los de Open Food Facts. */
(function(root){
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const num=v=>v===''||v==null||isNaN(+v)?null:+v;

/* Nombre del aditivo (sin tildes, en minúsculas) → número E. Se busca como expresión regular sobre el texto normalizado. */
const NAMES=[
 ['acido citrico','E330'],['citratos? (de )?sod(io|ico)|citrato trisodico','E331'],['citratos? (de )?potas(io|ico)','E332'],['citratos? (de )?calc(io|ico)','E333'],
 ['acido ascorbico','E300'],['ascorbato (de )?sod(io|ico)','E301'],['ascorbato (de )?calc(io|ico)','E302'],['palmitato de ascorbilo','E304'],
 ['acido lactico','E270'],['lactato (de )?sod(io|ico)','E325'],['lactato (de )?calc(io|ico)','E327'],
 ['acido acetico','E260'],['diacetato (de )?sod(io|ico)|acetatos? (de )?sod(io|ico)','E262'],['acetato (de )?calc(io|ico)','E263'],
 ['acido malico','E296'],['acido tartarico','E334'],['acido fosforico','E338'],['acido fumarico','E297'],
 ['acido sorbico','E200'],['sorbato (de )?potas(io|ico)','E202'],['sorbato (de )?calc(io|ico)','E203'],
 ['acido benzoico','E210'],['benzoato (de )?sod(io|ico)','E211'],['benzoato (de )?potas(io|ico)','E212'],
 ['acido propionico','E280'],['propionato (de )?sod(io|ico)','E281'],['propionato (de )?calc(io|ico)','E282'],['propionato (de )?potas(io|ico)','E283'],
 ['nitrito (de )?sod(io|ico)','E250'],['nitrito (de )?potas(io|ico)','E249'],['nitrato (de )?sod(io|ico)','E251'],['nitrato (de )?potas(io|ico)','E252'],
 ['anhidrido sulfuroso|dioxido de azufre','E220'],['sulfito (de )?sod(io|ico)','E221'],['bisulfito (de )?sod(io|ico)','E222'],['metabisulfito (de )?sod(io|ico)|disulfito (de )?sod(io|ico)','E223'],['metabisulfito (de )?potas(io|ico)|disulfito (de )?potas(io|ico)','E224'],
 ['lecitinas?( de (soja|girasol|colza))?','E322'],
 ['goma xantana|xantana','E415'],['goma guar|harina de guar','E412'],['goma (de )?garrofin|harina de (semillas de )?algarrobo','E410'],['goma arabiga|goma acacia','E414'],['goma gellan','E418'],['goma tara','E417'],
 ['carrageni?n(a|o)s?|carragenanos?|carrageninas?','E407'],['agar(-agar)?','E406'],['alginato (de )?sod(io|ico)','E401'],['pectinas?','E440'],
 ['carboximetilcelulosa|carboximetil celulosa','E466'],['metilcelulosa','E461'],['celulosa microcristalina','E460'],['hidroxipropilmetilcelulosa','E464'],
 ['mono( |-)?y di( |-)?gliceridos( de (los )?acidos grasos)?|monogliceridos y digliceridos','E471'],['esteres? (mono( y )?)?diacetil ?tartaric','E472e'],
 ['estearoil-?2-?lactilato (de )?sod(io|ico)','E481'],['estearoil-?2-?lactilato (de )?calc(io|ico)','E482'],['polisorbato 80','E433'],['polirricinoleato de poliglicerol','E476'],
 ['glutamato monosodico|glutamato (de )?sodio','E621'],['inosinato disodico','E631'],['guanilato disodico','E627'],['ribonucleotidos? disodicos?','E635'],
 ['aspartamo','E951'],['acesulfamo( k| potasico)?','E950'],['sucralosa','E955'],['sacarina( sodica)?','E954'],['ciclamato( sodico)?','E952'],['glucosidos de esteviol|estevia|stevia','E960'],
 ['sorbitol','E420'],['maltitol','E965'],['xilitol','E967'],['eritritol','E968'],['isomalt(ita)?','E953'],['manitol','E421'],['glicerol|glicerina','E422'],
 ['caramelo (de )?sulfito amonico|caramelo sulfito-amonico','E150d'],['caramelo amonico','E150c'],['caramelo (de )?sulfito caustico','E150b'],['caramelo natural|caramelo normal|colorante:? caramelo','E150a'],
 ['carmin|acido carminico|cochinilla','E120'],['curcumina','E100'],['extracto de pimenton|paprika extracto|extracto de paprika|capsantina','E160c'],['beta-?carotenos?','E160a'],['annatto|bixina|norbixina|achiote','E160b'],
 ['dioxido de titanio','E171'],['clorofilas?','E140'],['antocianinas?','E163'],['rojo de remolacha|betanina','E162'],['luteina','E161b'],['licopeno','E160d'],
 ['carbonato (de )?calc(io|ico)','E170'],['bicarbonato (de )?sod(io|ico)|carbonato acido de sodio|carbonatos? de sodio','E500'],['carbonatos? (de )?potas(io|ico)','E501'],['bicarbonato (de )?amon(io|ico)|carbonatos? de amonio|carbonato amonico','E503'],
 ['difosfato disodico|pirofosfato acido de sodio|difosfatos?','E450'],['trifosfatos?|tripolifosfato','E451'],['polifosfatos?','E452'],['fosfatos? (mono|di|tri)?calcicos?|fosfatos? de calcio','E341'],['fosfatos? (mono|di|tri)?sodicos?|fosfatos? de sodio','E339'],['fosfatos? (mono|di|tri)?potasicos?|fosfatos? de potasio','E340'],
 ['cloruro (de )?calc(io|ico)','E509'],['sulfato (de )?calc(io|ico)','E516'],['cloruro (de )?magnesio','E511'],['hidroxido (de )?sod(io|ico)','E524'],
 ['extractos? ricos? en tocoferoles|tocoferoles','E306'],['alfa-?tocoferol','E307'],['extracto de romero','E392'],['butilhidroxianisol|\\bbha\\b','E320'],['butilhidroxitolueno|\\bbht\\b','E321'],['galato de propilo','E310'],['edta|etilendiaminotetraacetato','E385'],
 ['goma laca','E904'],['cera de abejas','E901'],['cera carnauba|cera de carnauba','E903'],['dimetilpolisiloxano','E900'],['dioxido de silicio|silice','E551'],['jarabe de sorbitol','E420'],['polidextrosa','E1200'],
];
const NAME_RE=NAMES.map(([re,code])=>[new RegExp('(^|[^a-z])('+re+')(?![a-z])','g'),code]);

/* E-330, E 330, E330, e-330i, E-450(i), E 150 d … (con arreglos de OCR: O→0, l/I→1) */
const ERE=/(^|[^a-z0-9])e\s?[-–.]?\s?([0-9oil]{3,4})(?:\s?([a-f])(?![a-z]))?(?:\s?\(?\s?(iii|ii|iv|i|v|vi)\s?\)?(?![a-z]))?/g;
function detectAdditives(text){
  const t=norm(text),out=[],seen=new Set(),add=(code,how,raw)=>{if(seen.has(code))return;seen.add(code);out.push({code,how,raw})};
  let m;ERE.lastIndex=0;
  while((m=ERE.exec(t))){const d=m[2].replace(/o/g,'0').replace(/[il]/g,'1');if(!/^\d{3,4}$/.test(d)||(d.match(/\d/g)||[]).length<3)continue;
    const n=+d;if(n<100||n>1599)continue;
    add('E'+d+(m[3]||'')+(m[4]||''),'número',m[0].replace(/^[^a-z0-9]/,''))}
  for(const [re,code] of NAME_RE){re.lastIndex=0;const mm=re.exec(t);if(mm){
    // el número de la ficha manda: si ya está E322 por número, no repetir
    const base=code.replace(/^(E\d+).*$/,'$1');if([...seen].some(c=>c.replace(/^(E\d+).*$/,'$1')===base))continue;add(code,'nombre',mm[2])}}
  return out;
}

/* Alérgenos del Reglamento 1169/2011 (anexo II). Etiquetas como las de app.js (ALLERG). */
const ALLER=[
 ['Gluten',/(^|[^a-z])(gluten|trigo|centeno|cebada|avena|espelta|kamut|triticale|escanda|seitan|salvado de trigo|malta|harina de malta)(?![a-z])/],
 ['Leche',/(^|[^a-z])(leche(?! de (coco|almendra|avena|soja|arroz))|lactosa|lacteos?|nata|mantequilla|queso|suero (de leche|lacteo)|caseina(to)?s?|yogur|lactoproteinas?|proteinas? de (la )?leche|leche en polvo)(?![a-z])/],
 ['Huevo',/(^|[^a-z])(huevos?|ovoproductos?|clara de huevo|yema|ovoalbumina|albumina de huevo|lisozima)(?![a-z])/],
 ['Soja',/(^|[^a-z])(soja|soya)(?![a-z])/],
 ['Frutos de cáscara',/(^|[^a-z])(almendras?|avellanas?|nuez(?! moscada)|nueces|anacardos?|pistachos?|pacanas?|nueces de (brasil|macadamia)|macadamias?|frutos de cascara|frutos secos)(?![a-z])/],
 ['Cacahuete',/(^|[^a-z])(cacahuetes?|cacahuates?|mani)(?![a-z])/],
 ['Sésamo',/(^|[^a-z])(sesamo|ajonjoli|tahini|tahin)(?![a-z])/],
 ['Mostaza',/(^|[^a-z])(mostaza)(?![a-z])/],
 ['Apio',/(^|[^a-z])(apio)(?![a-z])/],
 ['Pescado',/(^|[^a-z])(pescados?|atun|salmon|anchoas?|bacalao|merluza|sardinas?|caballa|boqueron(es)?|surimi)(?![a-z])/],
 ['Crustáceos',/(^|[^a-z])(crustaceos?|gambas?|langostinos?|cangrejos?|camarones|camaron|cigalas?|langostas?|bogavante)(?![a-z])/],
 ['Moluscos',/(^|[^a-z])(moluscos?|mejillon(es)?|almejas?|calamar(es)?|pulpo|sepia|ostras?|berberechos?|vieiras?|chipiron(es)?)(?![a-z])/],
 ['Altramuces',/(^|[^a-z])(altramuz|altramuces|lupino|lupin)(?![a-z])/],
 ['Sulfitos',/(^|[^a-z])(sulfitos?|metabisulfito|bisulfito|disulfito|anhidrido sulfuroso|dioxido de azufre|e\s?-?\s?22[0-8])(?![a-z0-9])/],
];
const TRACE_RE=/(puede contener( trazas( de)?)?|contiene trazas( de)?|trazas( de)?|elaborado en (una )?(fabrica|instalaciones?)( que (utiliza|manipula|procesa)[^:]*)?|may contain)/;
function detectAllergens(text){
  let t=norm(text).replace(/\s+/g,' ').replace(/sin gluten|libre de gluten|sin lactosa/g,' ');
  const i=t.search(TRACE_RE);let main=t,tr='';
  if(i>=0){const end=t.indexOf('.',i);main=t.slice(0,i)+(end>=0?t.slice(end):'');tr=end>=0?t.slice(i,end):t.slice(i)}
  const f=s=>ALLER.filter(([,re])=>re.test(s)).map(([n])=>n);
  const allergens=f(main),traces=f(tr).filter(n=>!allergens.includes(n));
  return {allergens,traces};
}
/* Ecológico: bio, ecológico, orgánico, biológico, código de control "ES-ECO-…" */
function detectBio(...txts){const t=norm(txts.join(' '));return /(^|[^a-z])(bio|ecologic[oa]s?|organic[oa]?s?|biologic[oa]s?|agricultura ecologica)([^a-z]|$)|[a-z]{2}-eco-\d{2,3}/.test(t)}
/* Letra del Nutri-Score impresa en texto ("Nutri-Score: B"). En el logo gráfico casi nunca se lee: el usuario la elige. */
function detectNutriLetter(text){const m=norm(text).match(/nutri\s?-?\s?score\s*[:\-]?\s*([a-e])(?![a-z])/);return m?m[1]:''}
/* Limpia el texto de la foto: une palabras partidas, quita saltos y se queda desde "Ingredientes" hasta antes de la tabla */
function cleanIngredients(raw){
  let s=String(raw||'').replace(/\r/g,'').replace(/[-‐]\n(?=[a-záéíóúñ])/gi,'').replace(/\s*\n\s*/g,' ').replace(/[ \t]{2,}/g,' ').replace(/[|]/g,'').trim();
  const n=norm(s);const i=n.search(/ingredientes|ingredients|zutaten/);
  if(i>=0)s=s.slice(i);
  const n2=norm(s);const j=n2.search(/(informacion nutricional|valores? nutricionales?|valor energetico|consumir preferentemente|fecha de caducidad|conservar en|peso neto|nutrition)/);
  if(j>20)s=s.slice(0,j);
  return s.replace(/^ingredientes\s*[:;.]?\s*/i,'Ingredientes: ').trim();
}
function analyzeIngredients(text){
  const ad=detectAdditives(text),al=detectAllergens(text);
  return {additives:ad.map(a=>a.code),additivesFound:ad,allergens:al.allergens,traces:al.traces,bio:detectBio(text),nsLetter:detectNutriLetter(text)};
}

/* ---- Mezcla: u = datos del usuario {nutr:{kcal,fat,satfat,carbs,sugars,fiber,protein,salt,fvl,base},ingredients,additives,allergens,traces,bio,nsLetter,at}
   Lo que pone el usuario manda sobre lo de la base; lo que deja vacío se toma de la base. */
const NK=['kcal','fat','satfat','carbs','sugars','fiber','protein','salt'];
function hasNutr(n){return !!n&&NK.some(k=>num(n[k])!=null)}
function applyUser(p,u){
  if(!u)return p;const o={...p,user:u};
  if(u.ingredients&&String(u.ingredients).trim()){o.ingredients=u.ingredients;o.additives=u.additives||[];o.allergens=u.allergens||[];o.traces=u.traces||[]}
  if(hasNutr(u.nutr)){
    const n=u.nutr,b=p.nx||{},pick=(a,c)=>num(a)!=null?num(a):(c??null);
    o.nx={energy:num(n.kcal)!=null?Math.round(num(n.kcal)*4.184):(b.energy??null),sugars:pick(n.sugars,b.sugars),saturated_fat:pick(n.satfat,b.saturated_fat),
      salt:pick(n.salt,b.salt),fiber:pick(n.fiber,b.fiber),proteins:pick(n.protein,b.proteins),fvl:pick(n.fvl,b.fvl)??0,bev:!!b.bev,water:false};
    o.nsd=null;o.nsScore=null;o.nsNA=false;
    const old=p.nutr||{},nu={...old,base:n.base||old.base||'100 g',source:'usuario'};
    for(const [k,ok] of [['fiber','fiber'],['carbs','carbs'],['protein','protein'],['kcal','kcal'],['fat','fat'],['satfat','satfat'],['sugars','sugars'],['salt','salt']])if(num(n[k])!=null)nu[ok]=num(n[k]);
    o.nutr=nu;
    const ns=root.SCORE&&root.SCORE.computeNS(o.nx);
    o.nutriscore=ns&&ns.grade?ns.grade:(u.nsLetter||p.nutriscore||'');
  }else if(u.nsLetter)o.nutriscore=u.nsLetter;
  if(u.bio!=null){o.bio=!!u.bio;o.labels=u.bio?(/ecol|bio|organic/i.test(o.labels||'')?o.labels:((o.labels?o.labels+', ':'')+'Ecológico')):o.labels}
  return o;
}
/* ¿Le faltan datos para una nota completa? */
function missing(p){
  const m=[];if(!p)return m;
  if(p.src==='obf'){if(!String(p.ingredients||'').trim())m.push('ingredientes');return m}
  const nx=p.nx||{},hasNS=p.nsd&&p.nsd.cmp;
  if(!hasNS&&['energy','sugars','saturated_fat','salt'].some(k=>num(nx[k])==null))m.push('tabla nutricional');
  if(!String(p.ingredients||'').trim())m.push('ingredientes');
  return m;
}
root.COMPLETE={detectAdditives,detectAllergens,detectBio,detectNutriLetter,cleanIngredients,analyzeIngredients,applyUser,missing,hasNutr,NAMES,NK};
})(typeof window!=='undefined'?window:globalThis);
