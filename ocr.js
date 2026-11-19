/* Lectura de etiquetas en el propio móvil con Tesseract.js, cargado bajo demanda desde CDN.
   Tabla nutricional: es+en+de+fr+it+pt (envases multilingües); ingredientes: es+en.
   El service worker guarda en caché el script, el motor y los idiomas tras el primer uso. */
const OCR=(()=>{
  const TESS='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const LANGS={table:['spa','eng','deu','fra','ita','por'],text:['spa','eng']};
  let workerP=null,curLangs='',progressCb=()=>{};
  function loadScript(src){return new Promise((res,rej)=>{if(window.Tesseract)return res();const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('No se pudo descargar el lector (¿sin conexión?)'));document.head.appendChild(s)})}
  const logger=m=>{if(m.status==='recognizing text')progressCb(null,null,m.progress);else if(/load|init/.test(m.status))progressCb(0.25*(m.progress||0),m.status.includes('language')?'Descargando idiomas (solo la 1ª vez)…':'Preparando lector…')};
  async function worker(kind){
    const langs=LANGS[kind||'text'];
    if(!workerP){curLangs=langs.join('+');workerP=(async()=>{await loadScript(TESS);const w=await Tesseract.createWorker(langs,1,{logger:m=>logger(m)});await w.setParameters({tessedit_pageseg_mode:'3',preserve_interword_spaces:'1'});return w})().catch(e=>{workerP=null;throw e})}
    const w=await workerP;
    if(curLangs!==langs.join('+')){progressCb(0.05,'Cargando idiomas…');await w.reinitialize(langs,1);curLangs=langs.join('+');await w.setParameters({preserve_interword_spaces:'1'})}
    return w;
  }
  /* Carga respetando la orientación EXIF (el navegador la aplica al dibujar <img>), escala y mejora contraste */
  function loadImage(file){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=()=>rej(new Error('Imagen no válida'));img.src=typeof file==='string'?file:URL.createObjectURL(file)})}
  function prepare(img,rot,mode,opt){
    opt=opt||{};const W=img.naturalWidth||img.width,H=img.naturalHeight||img.height;const long=Math.max(W,H);
    const k=opt.k||(long>2600?2600/long:long<2000?Math.min(3,2200/long):1);
    const w=Math.round(W*k),h=Math.round(H*k);const sw=rot%180?h:w,sh=rot%180?w:h;
    const c=document.createElement('canvas');c.width=sw;c.height=sh;const g=c.getContext('2d',{willReadFrequently:true});
    g.translate(sw/2,sh/2);g.rotate(rot*Math.PI/180);g.drawImage(img,-w/2,-h/2,w,h);g.setTransform(1,0,0,1,0,0);
    const d=g.getImageData(0,0,sw,sh),px=d.data,N=sw*sh,gray=new Uint8Array(N);
    for(let i=0,j=0;j<N;i+=4,j++)gray[j]=(px[i]*299+px[i+1]*587+px[i+2]*114)/1000|0;
    // texto claro sobre fondo oscuro (envases de color): invertir para que el texto quede oscuro sobre claro
    let inv=opt.invert===true;
    if(opt.invert==='auto'){const hs=new Float64Array(256);for(let j=0;j<N;j++)hs[gray[j]]++;let sum=0;for(let i=0;i<256;i++)sum+=i*hs[i];let sB=0,wB=0,mx=-1,thr=128;
      for(let t=0;t<256;t++){wB+=hs[t];if(!wB)continue;const wF=N-wB;if(!wF)break;sB+=t*hs[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>mx){mx=v;thr=t}}
      let dk=0;for(let i=0;i<=thr;i++)dk+=hs[i];inv=dk/N>0.55}
    if(inv)for(let j=0;j<N;j++)gray[j]=255-gray[j];
    c.inverted=inv;
    if(mode==='gray'){let lo=255,hi=0;const hs=new Uint32Array(256);for(let j=0;j<N;j++)hs[gray[j]]++;let acc=0;for(let i=0;i<256;i++){acc+=hs[i];if(acc>N*0.01){lo=i;break}}acc=0;for(let i=255;i>=0;i--){acc+=hs[i];if(acc>N*0.01){hi=i;break}}
      const sc=255/Math.max(1,hi-lo);for(let j=0,i=0;j<N;j++,i+=4){const v=Math.max(0,Math.min(255,(gray[j]-lo)*sc));gray[j]=v;px[i]=px[i+1]=px[i+2]=v}g.putImageData(d,0,0);c.gray=c;c.k=k;return c}
    // umbral adaptativo (media local con imagen integral): soporta sombras, fondos de color y texto blanco sobre color
    const S=new Float64Array((sw+1)*(sh+1));
    for(let y=0;y<sh;y++){let row=0;for(let x=0;x<sw;x++){row+=gray[y*sw+x];S[(y+1)*(sw+1)+x+1]=S[y*(sw+1)+x+1]+row}}
    const R=Math.max(8,Math.round(Math.max(sw,sh)/45)),bin=new Uint8Array(N);let dark=0;
    for(let y=0;y<sh;y++){const y0=Math.max(0,y-R),y1=Math.min(sh,y+R+1);for(let x=0;x<sw;x++){const x0=Math.max(0,x-R),x1=Math.min(sw,x+R+1);
      const m=(S[y1*(sw+1)+x1]-S[y0*(sw+1)+x1]-S[y1*(sw+1)+x0]+S[y0*(sw+1)+x0])/((y1-y0)*(x1-x0));const v=gray[y*sw+x];
      if(v<m-10){bin[y*sw+x]=1;dark++}}}
    // texto claro sobre fondo oscuro (p. ej. tabla blanca sobre azul): invertir si hay demasiada "tinta"
    // quitar líneas de la tabla: tramos oscuros muy largos en horizontal o vertical
    const LH=Math.round(sw*0.12),LV=Math.round(sh*0.08);
    for(let y=0;y<sh;y++){let run=0;for(let x=0;x<=sw;x++){if(x<sw&&bin[y*sw+x])run++;else{if(run>LH)for(let k=x-run;k<x;k++)bin[y*sw+k]=2;run=0}}}
    for(let x=0;x<sw;x++){let run=0;for(let y=0;y<=sh;y++){if(y<sh&&bin[y*sw+x]===1)run++;else if(y<sh&&bin[y*sw+x]===2){run++}else{if(run>LV)for(let k=y-run;k<y;k++)bin[k*sw+x]=2;run=0}}}
    for(let j=0,i=0;j<N;j++,i+=4){const v=bin[j]===1?0:255;px[i]=px[i+1]=px[i+2]=v}
    const gc=document.createElement('canvas');gc.width=sw;gc.height=sh;const gg=gc.getContext('2d');const gd=gg.createImageData(sw,sh);for(let j=0,i=0;j<N;j++,i+=4){gd.data[i]=gd.data[i+1]=gd.data[i+2]=gray[j];gd.data[i+3]=255}gg.putImageData(gd,0,0);c.gray=gc;
    g.putImageData(d,0,0);c.k=k;return c;
  }
  /* Analiza las componentes conexas de la celda (imagen binarizada): dígitos = altos y alineados; coma/punto = mancha
     pequeña en la parte baja entre dígitos; "g" = empieza más abajo (altura x) o baja de la línea base.
     Solo se pone decimal si hay una coma/punto física en la imagen: nunca se inventan decimales. */
  function refine(cv,bx){
    try{
      const h=Math.max(6,bx.y1-bx.y0),X0=Math.max(0,Math.floor(bx.x0-h*0.3)),X1=Math.min(cv.width,Math.ceil(bx.x1+h*1.3)),Y0=Math.max(0,Math.floor(bx.y0-h*0.25)),Y1=Math.min(cv.height,Math.ceil(bx.y1+h*0.6));
      const W=X1-X0,H=Y1-Y0;if(W<4||H<4)return null;
      const d=cv.getContext('2d').getImageData(X0,Y0,W,H).data,ink=new Uint8Array(W*H);
      // umbral de Otsu local de la celda
      const hs=new Float64Array(256);for(let i=0;i<W*H;i++)hs[d[i*4]]++;let sum=0;for(let i=0;i<256;i++)sum+=i*hs[i];let sB=0,wB=0,mx=-1,thr=128;
      for(let t=0;t<256;t++){wB+=hs[t];if(!wB)continue;const wF=W*H-wB;if(!wF)break;sB+=t*hs[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>mx){mx=v;thr=t}}
      for(let i=0;i<W*H;i++)ink[i]=d[i*4]<=thr?1:0;
      const lab=new Int32Array(W*H),comps=[];let id=0;
      for(let i=0;i<W*H;i++){if(!ink[i]||lab[i])continue;id++;const st=[i];lab[i]=id;let c={x0:1e9,x1:-1,y0:1e9,y1:-1,n:0};
        while(st.length){const j=st.pop(),x=j%W,y=(j/W)|0;c.n++;if(x<c.x0)c.x0=x;if(x>c.x1)c.x1=x;if(y<c.y0)c.y0=y;if(y>c.y1)c.y1=y;
          for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const k=ny*W+nx;if(ink[k]&&!lab[k]){lab[k]=id;st.push(k)}}}
        if(c.n>=3)comps.push(c)}
      // los componentes que tocan el borde superior/inferior son de otras filas
      let cs=comps.filter(c=>c.y0>0&&c.y1<H-1).sort((a,b)=>a.x0-b.x0);
      const tall=cs.filter(c=>c.y1-c.y0+1>=h*0.55).map(c=>c.y1-c.y0+1).sort((a,b)=>a-b);if(!tall.length){refine.why='notall';return null}
      const Hd=tall[Math.floor(tall.length/2)];
      const tops=cs.filter(c=>c.y1-c.y0+1>=Hd*0.8).map(c=>c.y0).sort((a,b)=>a-b),bots=cs.filter(c=>c.y1-c.y0+1>=Hd*0.8).map(c=>c.y1).sort((a,b)=>a-b);
      const top=tops[0],base=bots[Math.floor(bots.length/2)];
      let seq='',started=false,last=null;const dl=[];
      for(const c of cs){
        const ch=c.y1-c.y0+1,cw=c.x1-c.x0+1;
        if(started&&last&&c.x0-last.x1>Hd*0.42)break; // espacio: empieza la unidad
        const isD=ch>=Hd*0.8&&Math.abs(c.y0-top)<=Hd*0.18&&Math.abs(c.y1-base)<=Hd*0.18&&cw<=Hd*1.1;
        const isP=ch<=Hd*0.5&&cw<=Hd*0.45&&c.y0>=top+Hd*0.45&&c.y1<=base+Hd*0.45;
        // cifra pegada a la "g" (letra estrecha): una mancha ancha que empieza arriba y baja de la línea base
        const isDg=started&&Math.abs(c.y0-top)<=Hd*0.18&&c.y1>base+Hd*0.12&&cw>Hd*0.9&&cw<=Hd*2.1;
        if(isD){seq+='D';started=true;last=c;dl.push(c)}
        else if(isDg){seq+='D';break}
        else if(isP&&started){seq+='P';last=c}
        else if(started)break; // "g" (empieza más abajo o desciende), "%", etc.
        else if(c.x1>bx.x0+h*0.2&&!isP){refine.why='raro '+JSON.stringify([c.x0,c.y0,c.x1,c.y1,top,base,Hd,bx.x0-X0]);return null} // algo raro antes de la cifra
      }
      // coma pegada a la cifra de su izquierda ("2," en una sola mancha): esa mancha es más ancha y baja más que las demás
      if(!seq.includes('P')&&dl.length>=2&&/^D+$/.test(seq)){
        const minB=Math.min(...dl.map(c=>c.y1)),ws=dl.map(c=>c.x1-c.x0+1);
        for(let i=0;i<dl.length-1;i++){const others=ws.filter((_,j)=>j!==i&&ws[j]>Hd*0.25);if(!others.length)continue;
          if(dl[i].y1-minB>Hd*0.12&&ws[i]>1.25*Math.min(...others)){seq=seq.slice(0,i+1)+'P'+seq.slice(i+1);break}}
      }
      seq=seq.replace(/P+$/,'');
      if(!/^D+(PD+)?$/.test(seq)){refine.why='seq '+seq;return null}
      const nD=seq.replace(/P/g,'').length,dec=seq.indexOf('P');
      let digits=(bx.tok||bx.raw||'').replace(/[^\d]/g,'');
      if(digits.length===nD+1&&/[98]$/.test(digits))digits=digits.slice(0,-1); // la "g" leída como 9/8
      if(digits.length!==nD){refine.why='nd '+digits+' '+seq;return null}
      const str=dec>0?digits.slice(0,dec)+'.'+digits.slice(dec):digits;
      return {value:parseFloat(str),seq};
    }catch(e){return null}
  }
  function finalize(parsed,cv){
    // 2ª pasada geométrica: reconstruir cada cifra a partir de las manchas de tinta de su celda
    for(const [key,bx] of Object.entries(parsed.boxes||{})){
      if(key==='kcal')continue;
      const r=refine(cv.gray,bx);
      if(r&&r.value!==parsed[key]){parsed.notes.push(`${key}: ${parsed[key]} → ${r.value} (coma/unidad por geometría)`);parsed[key]=r.value}
      else if(!r){parsed.uncertain=(parsed.uncertain||[]).concat(key);if(window.OCR_DEBUG)parsed.notes.push('refine '+key+' '+bx.tok+': '+refine.why)}
    }
    // "g" leída como 9 de forma sistemática (letra pegada a la cifra): si casi todos los valores sin unidad acaban en 9,
    // quitar ese 9 final en los que llevan coma y quedan con al menos un decimal ("0,59" → 0,5; "35,9" se deja)
    const bx=Object.entries(parsed.boxes||{}).filter(([k,b])=>k!=='kcal'&&!b.unit);
    const n9=bx.filter(([k,b])=>/[98]$/.test(String(b.tok||'').replace(/[^\d.,]/g,''))).length;
    if(bx.length>=3&&n9/bx.length>=0.6){
      for(const [k,b] of bx){if(!(parsed.uncertain||[]).includes(k))continue;const t=String(b.tok||'').replace(/[^\d.,]/g,'');
        const m=t.match(/^(\d+[.,]\d+)[98]$/);if(m){const v=parseFloat(m[1].replace(',','.'));if(v!==parsed[k]){parsed.notes.push(`${k}: ${parsed[k]} → ${v} (la "g" leída como 9)`);parsed[k]=v}}}
    }
    // valores imposibles por 100 g: se dejan vacíos para que el usuario los escriba (no se adivinan decimales)
    for(const k of ['fiber','carbs','protein','fat','satfat','sugars','salt','sodium'])if(parsed[k]!=null&&parsed[k]>100){parsed.notes.push(`${k}: "${parsed[k]}" no es posible por 100 g, escríbelo a mano`);parsed[k]=null}
    if(parsed.kcal!=null&&parsed.kcal>900){parsed.notes.push('kcal ilegibles');parsed.kcal=null}
    return parsed;
  }
  /* ---------- Tabla nutricional: búsqueda de la tabla, lectura de cerca y varias pasadas ---------- */
  const KEYS=['kcal','fat','satfat','carbs','sugars','fiber','protein','salt'];
  const MAXSRC=4096; // fotos de 12-50 MP: se trabaja como mucho a 4096 px de lado largo
  /* Imagen orientada (EXIF ya aplicado por el navegador), girada rot° y recortada (crop normalizado 0-1 sobre la imagen girada) */
  function source(img,rot,crop){
    rot=((rot%360)+360)%360;const W=img.naturalWidth||img.width,H=img.naturalHeight||img.height;const k=Math.min(1,MAXSRC/Math.max(W,H));
    const w=Math.round(W*k),h=Math.round(H*k),sw=rot%180?h:w,sh=rot%180?w:h;
    let c=document.createElement('canvas');c.width=sw;c.height=sh;const g=c.getContext('2d');
    g.translate(sw/2,sh/2);g.rotate(rot*Math.PI/180);g.drawImage(img,-w/2,-h/2,w,h);
    if(crop&&crop.w>0.02&&crop.h>0.02){const x=Math.round(crop.x*sw),y=Math.round(crop.y*sh),cw=Math.max(8,Math.round(crop.w*sw)),ch=Math.max(8,Math.round(crop.h*sh));
      const c2=document.createElement('canvas');c2.width=cw;c2.height=ch;c2.getContext('2d').drawImage(c,x,y,cw,ch,0,0,cw,ch);c=c2}
    return c;
  }
  function cropRotate(src,box,angle){
    const c=document.createElement('canvas'),rad=angle*Math.PI/180,cs=Math.abs(Math.cos(rad)),sn=Math.abs(Math.sin(rad));
    c.width=Math.round(box.w*cs+box.h*sn);c.height=Math.round(box.w*sn+box.h*cs);const g=c.getContext('2d');g.fillStyle='#fff';
    g.translate(c.width/2,c.height/2);g.rotate(rad);g.drawImage(src,box.x,box.y,box.w,box.h,-box.w/2,-box.h/2,box.w,box.h);return c;
  }
  const isNumTok=t=>/^[<(]?\d{1,4}([.,]\d{1,3})?\s*(g|gr|kcal|kj|mg|ml)?[),;]*$/i.test(t.trim());
  function quality(p){
    const n=KEYS.filter(k=>p[k]!=null).length;let q=n+(p.headerFound?0.5:0)-0.7*NUTR.warnings(p).length-0.3*(p.uncertain||[]).length;
    if(p.kcal!=null&&p.fat!=null&&p.carbs!=null&&p.protein!=null){const calc=4*p.carbs+4*p.protein+9*p.fat+2*(p.fiber||0);if(Math.abs(calc-p.kcal)<=Math.max(15,0.15*p.kcal))q+=2}
    if(p.satfat!=null&&p.fat!=null&&p.satfat>p.fat)q-=1;if(p.sugars!=null&&p.carbs!=null&&p.sugars>p.carbs)q-=1;
    return {n,q};
  }
  async function pass(w,src,k,mode,invert,psm,label){
    const cv=prepare(src,0,mode,{k,invert});
    await w.setParameters({tessedit_pageseg_mode:psm});
    const {data}=await w.recognize(mode==='gray'?cv.gray:cv);
    const p=finalize(NUTR.parseNutritionWords(data.words||[]),cv);
    const {n,q}=quality(p);return {data,parsed:p,cv,k,n,q,label,src,inverted:cv.inverted};
  }
  /* Zona de la tabla en la foto: palabras de nutrientes y cifras con unidad (en coordenadas de la imagen fuente) */
  function findROI(r){
    const ws=(r.data.words||[]).filter(x=>x.bbox&&x.text&&x.text.trim());const k=r.k;
    const hits=[];let kw=0;
    for(const x of ws){const t=NUTR.norm(x.text);const isK=t.length>=3&&NUTR.rowKeys(t).size>0;const isN=isNumTok(x.text)&&/\d/.test(x.text);
      if(isK||isN){hits.push(x);if(isK)kw++}}
    if(hits.length<3||kw<1)return null;
    // quedarse con el grupo principal (quita cifras sueltas lejos de la tabla)
    const hs=hits.map(x=>x.bbox.y1-x.bbox.y0).sort((a,b)=>a-b),hm=hs[Math.floor(hs.length*0.4)]||10;
    const xs=hits.map(x=>(x.bbox.x0+x.bbox.x1)/2).sort((a,b)=>a-b),ys=hits.map(x=>(x.bbox.y0+x.bbox.y1)/2).sort((a,b)=>a-b);
    const mx=xs[Math.floor(xs.length/2)],my=ys[Math.floor(ys.length/2)];
    const W=r.src.width*k,H=r.src.height*k;
    const core=hits.filter(x=>Math.abs((x.bbox.y0+x.bbox.y1)/2-my)<Math.max(H*0.45,hm*14)&&Math.abs((x.bbox.x0+x.bbox.x1)/2-mx)<Math.max(W*0.45,hm*30));
    const use=core.length>=3?core:hits;
    let x0=Math.min(...use.map(x=>x.bbox.x0)),x1=Math.max(...use.map(x=>x.bbox.x1)),y0=Math.min(...use.map(x=>x.bbox.y0)),y1=Math.max(...use.map(x=>x.bbox.y1));
    // a la derecha de los nombres suelen estar las cifras (que en la vista general a veces no se leen): ampliar mucho hacia la derecha
    const bw=x1-x0,onlyLabels=use.filter(x=>isNumTok(x.text)&&/\d\s*(g|kcal|kj|mg)/i.test(x.text)).length<3;x0-=Math.max(hm*4,bw*0.2);x1+=onlyLabels?Math.max(hm*45,bw*1.7):Math.max(hm*10,bw*0.4);y0-=hm*4;y1+=hm*7;
    x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(W,x1);y1=Math.min(H,y1);
    return {x:x0/k,y:y0/k,w:(x1-x0)/k,h:(y1-y0)/k,hm:hm/k,hits:hits.length,kw,area:(x1-x0)*(y1-y0)/(W*H)};
  }
  /* Caja ajustada a la tabla a partir de una lectura: palabras de nutrientes + valores encontrados (coordenadas de la fuente) */
  function tightBox(r){
    const k=r.k,ws=(r.data.words||[]).filter(x=>x.bbox&&x.text&&NUTR.norm(x.text).length>=3&&NUTR.rowKeys(NUTR.norm(x.text)).size);
    const vb=Object.values(r.parsed.boxes||{});if(vb.length<2||ws.length<2)return null;
    const hs=vb.map(b=>b.y1-b.y0).sort((a,b)=>a-b),dh=hs[Math.floor(hs.length/2)];
    const all=[...ws.map(x=>x.bbox),...vb];
    let x0=Math.min(...ws.map(x=>x.bbox.x0))-dh*1.5,x1=Math.max(...vb.map(b=>b.x1))+dh*2.5,y0=Math.min(...all.map(b=>b.y0))-dh*2.5,y1=Math.max(...all.map(b=>b.y1))+dh*2.5;
    const W=r.src.width*k,H=r.src.height*k;x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(W,x1);y1=Math.min(H,y1);
    if(x1-x0<dh*4||y1-y0<dh*4)return null;
    return {x:x0/k,y:y0/k,w:(x1-x0)/k,h:(y1-y0)/k,dh:dh/k};
  }
  /* Votación entre pasadas: para cada nutriente, el valor que más se repite (pesado por la calidad de la pasada) */
  function vote(passes,best){
    const out={...best.parsed,found:[],uncertain:[...(best.parsed.uncertain||[])],notes:[...(best.parsed.notes||[])]};
    const good=passes.filter(p=>p.n>=2);
    for(const key of KEYS){
      const tally=new Map();for(const p of good){const v=p.parsed[key];if(v==null)continue;const cur=tally.get(v)||{w:0,c:0};const q=Math.max(0.5,p.q);cur.w+=q*q*(p===best?1.5:1)*((p.parsed.uncertain||[]).includes(key)?0.6:1);cur.c++;tally.set(v,cur)}
      if(!tally.size){out[key]=null;continue}
      const arr=[...tally.entries()].sort((a,b)=>b[1].w-a[1].w);const [v,t]=arr[0];
      if(out[key]!==v){if(out[key]!=null)out.notes.push(`${key}: ${out[key]} → ${v} (coinciden más lecturas)`);out[key]=v}
      if(best.parsed[key]==null||(arr.length>1&&arr[1][1].w>=t.w*0.6))out.uncertain.push(key);
      out.found.push(key);
    }
    if(out.salt==null&&best.parsed.sodium!=null){out.salt=Math.round(best.parsed.sodium*250)/100;out.found.push('salt')}
    out.uncertain=[...new Set(out.uncertain)].filter(k=>out[k]!=null);
    return out;
  }
  async function read(file,onProgress,opts){
    opts=opts||{};let frac=0.25,step=0.1,msg='Buscando la tabla…';
    progressCb=(v,m,p)=>{if(v!=null){frac=v}if(m)msg=m;(onProgress||(()=>{}))(p!=null?Math.min(0.98,frac+step*p):frac,msg)};
    const img=await loadImage(file),w=await worker('table');
    const passes=[];let best=null;const t0=Date.now();
    const consider=r=>{if(/vista general|gris|invertida/.test(r.label)&&r.label.indexOf('°')>0)r.whole=true;passes.push(r);
      // las lecturas de cerca mandan sobre la vista general (más resolución), salvo que esta sea claramente mejor
      const eff=x=>x.q-(x.whole&&passes.some(p=>!p.whole&&p.n>=5)?1.5:0);
      best=passes.reduce((a,b)=>eff(b)>eff(a)?b:a);return r};
    const done=()=>best&&((best.n>=8&&best.q>=9)||(best.n>=7&&best.q>=8.5&&passes.length>=3));
    const rot0=opts.rot||0;const rots=opts.crop?[rot0]:[rot0,rot0+90,rot0+270,rot0+180];
    let ri=0;
    for(const rot of rots){
      const src=source(img,rot,opts.crop);const long=Math.max(src.width,src.height);
      const k1=long>2000?2000/long:Math.min(3,2000/long);
      progressCb(0.25+0.05*ri,ri?'Probando la foto girada…':'Buscando la tabla…');step=0.12;
      let s1=consider(await pass(w,src,k1,'bin',false,'3',`${rot}° vista general`));
      if(done())break;
      let roi=findROI(s1);
      for(const [inv,psm,lab,m] of [[false,'3','gris','Probando otro contraste…'],[true,'11','invertida','Probando con colores invertidos…']]){
        if(roi&&roi.kw>=3)break;
        progressCb(null,m);const sx=consider(await pass(w,src,k1,'gray',inv,psm,`${rot}° ${lab}`));if(done())break;
        const r2=findROI(sx);if(r2&&(!roi||r2.hits>roi.hits)){roi=r2;s1=sx}}
      if(done())break;
      if(roi||opts.crop){
        const box=roi||{x:0,y:0,w:src.width,h:src.height,hm:20};s1.roi=`${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)} hm ${Math.round(box.hm)} kw ${box.kw} hits ${box.hits} src ${src.width}x${src.height}`;
        const ws=(s1.data.words||[]);const slope=NUTR.skewOf(ws);const ang=Math.abs(slope)>0.017?-Math.atan(slope)*180/Math.PI:0;
        const crop=cropRotate(src,box,ang);
        // texto a ~34 px de alto, sin pasar de 3000 px de lado largo
        let k2=Math.max(1,Math.min(4,2400/Math.max(crop.width,crop.height)));k2=Math.min(k2,3000/Math.max(crop.width,crop.height));
        const plan=[['bin','3'],['gray','6'],['bin','6'],['gray','11'],['gray','4']];
        for(let i=0;i<plan.length;i++){const [mode,psm]=plan[i];
          progressCb(0.4+0.5*i/plan.length,i?'Probando otro contraste…':'Leyendo la tabla de cerca…');step=0.5/plan.length;
          consider(await pass(w,crop,k2,mode,'auto',psm,`${rot}° recorte ${mode} psm${psm}`));
          if(done())break;
          if(i>=2&&best.n<2)break; // aquí no hay tabla: probar otra orientación
        }
        // 3ª fase: recorte ajustado a la tabla (nombres + columna de valores) y ampliado, con la mejor lectura como guía
        const bc=passes.filter(p=>p.src===crop&&p.n>=3).sort((a,b)=>b.q-a.q)[0];
        const tb=bc&&!done()?tightBox(bc):null;
        if(tb){
          const c3=cropRotate(crop,tb,0);let k3=Math.max(1,Math.min(4,44/Math.max(4,tb.dh)));k3=Math.min(k3,3000/Math.max(c3.width,c3.height));
          const plan3=[['gray','6'],['bin','6'],['gray','4'],['gray','11']];
          for(let i=0;i<plan3.length;i++){const [mode,psm]=plan3[i];
            progressCb(0.7+0.25*i/plan3.length,'Repasando la tabla…');step=0.25/plan3.length;
            consider(await pass(w,c3,k3,mode,'auto',psm,`${rot}° tabla ${mode} psm${psm}`));if(done())break}
        }
      }
      if(best.n>=4||(best.n>=2&&Date.now()-t0>60000))break;
      ri++;
    }
    const pr=passes.filter(p=>parseInt(p.label)===parseInt(best.label));
    const parsed=vote(pr,best);
    delete parsed.boxes;
    parsed.rotation=((rots[0]+0)%360);parsed.pass=best.label;parsed.passes=passes.length;
    parsed.confidence=Math.round(best.data.confidence||0);parsed.text=best.data.text||'';
    parsed.rotation=(parseInt(best.label)||0)%360;
    parsed.debug=passes.map(p=>`${p.label}: ${p.n} valores (q ${p.q.toFixed(1)})${p.roi?' roi '+p.roi:''} `+KEYS.map(k=>k+'='+p.parsed[k]).join(' '));
    if(window.OCR_DEBUG)window.OCR_DEBUG.last=passes.map(p=>({label:p.label,img:(p.cv.gray||p.cv).toDataURL('image/jpeg',0.8),text:p.data.text}));
    return parsed;
  }
  /* Vista de la foto (orientada y girada) para el recorte manual */
  async function preview(file,rot,max){const img=await loadImage(file);const s=source(img,rot||0,null);const k=Math.min(1,(max||1000)/Math.max(s.width,s.height));
    const c=document.createElement('canvas');c.width=Math.round(s.width*k);c.height=Math.round(s.height*k);c.getContext('2d').drawImage(s,0,0,c.width,c.height);return c}
  /* Texto libre (lista de ingredientes): prueba contraste normal y binarizado (y girada si sale poco texto) y se queda
     con la lectura con más palabras reconocibles. */
  const wordsScore=d=>{const ws=(d.words||[]).filter(w=>w.confidence>55&&/[a-záéíóúñü]{3,}/i.test(w.text));return ws.length+(/ingredientes|ingredients/i.test(d.text||'')?5:0)};
  async function readText(file,onProgress){
    let frac=0.25,msg='Leyendo…';progressCb=(v,m,p)=>{if(v!=null)frac=v;if(m)msg=m;(onProgress||(()=>{}))(p!=null?Math.min(0.98,frac+0.12*p):frac,msg)};
    const img=await loadImage(file),w=await worker('text');await w.setParameters({tessedit_pageseg_mode:'3'});
    let best=null;const variants=[[0,'gray'],[0,'bin'],[90,'gray'],[270,'gray'],[180,'gray']];
    for(let vi=0;vi<variants.length;vi++){
      const [rot,mode]=variants[vi];if(vi)progressCb(0.3+0.6*vi/variants.length,rot?'Probando la foto girada…':'Probando otro contraste…');
      const cv=prepare(img,rot,mode);const {data}=await w.recognize(mode==='gray'?cv.gray:cv);
      const q=wordsScore(data);if(!best||q>best.q)best={q,data,rot};
      if(vi>=1&&best.q>=12&&best.rot===0)break;
    }
    return {text:best.data.text||'',confidence:Math.round(best.data.confidence||0),rotation:best.rot};
  }
  return {read,readText,prepare,loadImage,preview};
})();
