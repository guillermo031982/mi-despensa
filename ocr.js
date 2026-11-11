/* Lectura de la etiqueta nutricional en el propio móvil con Tesseract.js (spa+eng), cargado bajo demanda desde CDN.
   El service worker guarda en caché el script, el motor y los idiomas tras el primer uso. */
const OCR=(()=>{
  const TESS='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let workerP=null,progressCb=()=>{};const PSM='3';
  function loadScript(src){return new Promise((res,rej)=>{if(window.Tesseract)return res();const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('No se pudo descargar el lector (¿sin conexión?)'));document.head.appendChild(s)})}
  async function worker(){
    if(!workerP)workerP=(async()=>{
      await loadScript(TESS);
      const w=await Tesseract.createWorker(['spa','eng'],1,{logger:m=>{if(m.status==='recognizing text')progressCb(0.3+0.7*m.progress,'Leyendo…');else if(/load|init/.test(m.status))progressCb(0.3*(m.progress||0),m.status.includes('language')?'Descargando idioma (solo la 1ª vez)…':'Preparando lector…')}});
      await w.setParameters({tessedit_pageseg_mode:PSM,preserve_interword_spaces:'1'});
      return w;
    })().catch(e=>{workerP=null;throw e});
    return workerP;
  }
  /* Carga respetando la orientación EXIF (el navegador la aplica al dibujar <img>), escala y mejora contraste */
  function loadImage(file){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=()=>rej(new Error('Imagen no válida'));img.src=typeof file==='string'?file:URL.createObjectURL(file)})}
  function prepare(img,rot,mode){
    const W=img.naturalWidth,H=img.naturalHeight;const long=Math.max(W,H);
    const k=long>2600?2600/long:long<2000?Math.min(3,2200/long):1;
    const w=Math.round(W*k),h=Math.round(H*k);const sw=rot%180?h:w,sh=rot%180?w:h;
    const c=document.createElement('canvas');c.width=sw;c.height=sh;const g=c.getContext('2d',{willReadFrequently:true});
    g.translate(sw/2,sh/2);g.rotate(rot*Math.PI/180);g.drawImage(img,-w/2,-h/2,w,h);g.setTransform(1,0,0,1,0,0);
    const d=g.getImageData(0,0,sw,sh),px=d.data,N=sw*sh,gray=new Uint8Array(N);
    for(let i=0,j=0;j<N;i+=4,j++)gray[j]=(px[i]*299+px[i+1]*587+px[i+2]*114)/1000|0;
    if(mode==='gray'){let lo=255,hi=0;const hs=new Uint32Array(256);for(let j=0;j<N;j++)hs[gray[j]]++;let acc=0;for(let i=0;i<256;i++){acc+=hs[i];if(acc>N*0.01){lo=i;break}}acc=0;for(let i=255;i>=0;i--){acc+=hs[i];if(acc>N*0.01){hi=i;break}}
      const sc=255/Math.max(1,hi-lo);for(let j=0,i=0;j<N;j++,i+=4){const v=Math.max(0,Math.min(255,(gray[j]-lo)*sc));gray[j]=v;px[i]=px[i+1]=px[i+2]=v}g.putImageData(d,0,0);c.gray=c;return c}
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
    g.putImageData(d,0,0);return c;
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
      const tall=cs.filter(c=>c.y1-c.y0+1>=h*0.55).map(c=>c.y1-c.y0+1).sort((a,b)=>a-b);if(!tall.length)return null;
      const Hd=tall[Math.floor(tall.length/2)];
      const tops=cs.filter(c=>c.y1-c.y0+1>=Hd*0.8).map(c=>c.y0).sort((a,b)=>a-b),bots=cs.filter(c=>c.y1-c.y0+1>=Hd*0.8).map(c=>c.y1).sort((a,b)=>a-b);
      const top=tops[0],base=bots[Math.floor(bots.length/2)];
      let seq='',started=false,last=null;
      for(const c of cs){
        const ch=c.y1-c.y0+1,cw=c.x1-c.x0+1;
        if(started&&last&&c.x0-last.x1>Hd*0.42)break; // espacio: empieza la unidad
        const isD=ch>=Hd*0.8&&Math.abs(c.y0-top)<=Hd*0.18&&Math.abs(c.y1-base)<=Hd*0.18&&cw<=Hd*1.1;
        const isP=ch<=Hd*0.42&&cw<=Hd*0.4&&c.y0>=top+Hd*0.5&&c.y1<=base+Hd*0.4;
        if(isD){seq+='D';started=true;last=c}
        else if(isP&&started){seq+='P';last=c}
        else if(started)break; // "g" (empieza más abajo o desciende), "%", etc.
        else if(c.x1>bx.x0+h*0.2&&!isP)return null; // algo raro antes de la cifra
      }
      seq=seq.replace(/P+$/,'');
      if(!/^D+(PD+)?$/.test(seq))return null;
      const nD=seq.replace(/P/g,'').length,dec=seq.indexOf('P');
      let digits=(bx.tok||bx.raw||'').replace(/[^\d]/g,'');
      if(digits.length===nD+1&&/[98]$/.test(digits))digits=digits.slice(0,-1); // la "g" leída como 9/8
      if(digits.length!==nD)return null;
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
      else if(!r)parsed.uncertain=(parsed.uncertain||[]).concat(key);
    }
    // valores imposibles por 100 g: se dejan vacíos para que el usuario los escriba (no se adivinan decimales)
    for(const k of ['fiber','carbs','protein','fat'])if(parsed[k]!=null&&parsed[k]>100){parsed.notes.push(`${k}: "${parsed[k]}" no es posible por 100 g, escríbelo a mano`);parsed[k]=null}
    if(parsed.kcal!=null&&parsed.kcal>900){parsed.notes.push('kcal ilegibles');parsed.kcal=null}
    return parsed;
  }
  const score=r=>{const t=(r.text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return ['fibra','hidratos','protein','energ','grasa','100 g','100g','kcal','sal'].filter(k=>t.includes(k)).length};
  async function read(file,onProgress){
    progressCb=onProgress||(()=>{});
    const img=await loadImage(file),w=await worker();
    let best=null;
    const variants=[[0,'bin'],[0,'gray'],[90,'bin'],[270,'bin'],[180,'bin'],[90,'gray'],[270,'gray']];
    for(let vi=0;vi<variants.length;vi++){
      const [rot,mode]=variants[vi];
      if(vi)progressCb(0.3+0.6*vi/variants.length,rot?'Probando la foto girada…':'Probando otro contraste…');
      const cv=prepare(img,rot,mode);const {data}=await w.recognize(cv);
      const p=finalize(NUTR.parseNutritionWords(data.words||[]),cv);
      const ok=['fiber','carbs','protein','fat','kcal'].filter(k=>p[k]!=null).length;
      const q=ok+(p.headerFound?1:0)-0.5*NUTR.warnings(p).length-0.3*(p.uncertain||[]).length;
      if(!best||q>best.q)best={q,data,rot,parsed:p};
      if(ok>=4&&q>=4.5)break;
    }
    const parsed=best.parsed;
    delete parsed.boxes;
    parsed.rotation=best.rot;parsed.confidence=Math.round(best.data.confidence||0);parsed.text=best.data.text;
    return parsed;
  }
  return {read,prepare,loadImage};
})();
