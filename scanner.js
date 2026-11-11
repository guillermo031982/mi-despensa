/* Escáner de códigos de barras con cámara propia (sin html5-qrcode):
   - cámara trasera en alta resolución, enfoque continuo, toque para enfocar, linterna y zoom si el móvil lo permite
   - lector nativo BarcodeDetector (Android Chrome) o ZXing (iPhone y resto)
   - decodificar una foto fija hecha con la cámara del sistema (usa todo su autoenfoque) */
const Scanner=(()=>{
  const FMT=['ean_13','ean_8','upc_a','upc_e','code_128'];
  let st=null; // estado de la sesión activa
  let detP=null;
  function nativeDetector(){
    if(!detP)detP=(async()=>{
      if(!('BarcodeDetector' in window))return null;
      try{const sup=await BarcodeDetector.getSupportedFormats();const f=FMT.filter(x=>sup.includes(x));if(!f.includes('ean_13'))return null;return new BarcodeDetector({formats:f})}catch(e){return null}
    })();
    return detP;
  }
  let zxr=null;
  function zx(){
    if(zxr||!window.ZXing)return zxr;
    const Z=ZXing,h=new Map();
    h.set(Z.DecodeHintType.POSSIBLE_FORMATS,[Z.BarcodeFormat.EAN_13,Z.BarcodeFormat.EAN_8,Z.BarcodeFormat.UPC_A,Z.BarcodeFormat.UPC_E,Z.BarcodeFormat.CODE_128]);
    h.set(Z.DecodeHintType.TRY_HARDER,true);
    zxr=new Z.MultiFormatReader();zxr.setHints(h);return zxr;
  }
  function zxDecodeCanvas(c){
    const r=zx();if(!r)return null;
    try{const src=new ZXing.HTMLCanvasElementLuminanceSource(c);const bmp=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));const res=r.decode(bmp);return res&&res.getText()}catch(e){return null}finally{try{r.reset()}catch(e){}}
  }
  const valid=t=>{t=String(t||'').trim();return /^\d{6,14}$/.test(t)?t:null};

  /* ---------- cámara en vivo ---------- */
  async function openStream(deviceId){
    const base={width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30},advanced:[{focusMode:'continuous'}]};
    const tries=deviceId?[{...base,deviceId:{exact:deviceId}}]:[{...base,facingMode:{ideal:'environment'}},{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},{facingMode:'environment'},true];
    let err;for(const v of tries){try{return await navigator.mediaDevices.getUserMedia({audio:false,video:v})}catch(e){err=e;if(e.name==='NotAllowedError')break}}
    throw err;
  }
  async function backCameras(){
    try{const ds=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      const back=ds.filter(d=>/back|rear|trasera|environment|posterior|traseira/i.test(d.label));return back.length?back:ds}catch(e){return []}
  }
  function caps(track){try{return track.getCapabilities?track.getCapabilities():{}}catch(e){return {}}}
  async function apply(track,adv){try{await track.applyConstraints({advanced:[adv]});return true}catch(e){return false}}

  async function start(el,onCode,ui){
    await stop();
    const s=st={el,onCode,ui,stopped:false,done:false,frames:0};
    const video=document.createElement('video');video.setAttribute('playsinline','');video.muted=true;video.autoplay=true;
    el.querySelector('.cam').prepend(video);s.video=video;
    const saved=localStorage.getItem('md-cam');
    let stream;try{stream=await openStream(saved||null)}catch(e){if(saved){localStorage.removeItem('md-cam');stream=await openStream(null)}else throw e}
    if(s.stopped){stream.getTracks().forEach(t=>t.stop());return}
    s.stream=stream;s.track=stream.getVideoTracks()[0];video.srcObject=stream;
    await video.play().catch(()=>{});
    await setupTrack(s);
    // Android con varias cámaras traseras: permitir cambiar (la principal suele enfocar mejor que la gran angular/tele)
    const cams=await backCameras();s.cams=cams;
    ui.camBtn.hidden=cams.length<2;
    s.det=await nativeDetector();ui.engine.textContent=s.det?'lector nativo':'lector ZXing';
    loop(s);
  }
  async function setupTrack(s){
    const t=s.track,c=caps(t),ui=s.ui;s.caps=c;
    if(Array.isArray(c.focusMode)&&c.focusMode.includes('continuous'))await apply(t,{focusMode:'continuous'});
    ui.torchBtn.hidden=!c.torch;s.torch=false;
    if(c.zoom&&c.zoom.max>c.zoom.min){
      const z=ui.zoom;z.min=c.zoom.min;z.max=Math.min(c.zoom.max,8);z.step=c.zoom.step||0.1;
      ui.zoomWrap.hidden=false;
      // zoom inicial (Android): 1,5× (o el último usado) para poder alejar el móvil y que enfoque
      const pref=+localStorage.getItem('md-zoom')||1.5;const v=Math.max(c.zoom.min,Math.min(+z.max,pref));
      z.value=v;ui.zoomLbl.textContent=v.toFixed(1)+'×';if(v!==((t.getSettings&&t.getSettings().zoom)||c.zoom.min))await apply(t,{zoom:v});
    }else ui.zoomWrap.hidden=true;
  }
  async function setZoom(v){const s=st;if(!s||!s.track)return;v=Math.max(+s.ui.zoom.min,Math.min(+s.ui.zoom.max,+v));s.ui.zoom.value=v;s.ui.zoomLbl.textContent=v.toFixed(1)+'×';localStorage.setItem('md-zoom',v);await apply(s.track,{zoom:v})}
  async function toggleTorch(){const s=st;if(!s||!s.track)return;s.torch=!s.torch;if(!await apply(s.track,{torch:s.torch}))s.torch=false;s.ui.torchBtn.classList.toggle('on',s.torch)}
  async function nextCamera(){
    const s=st;if(!s||!s.cams||s.cams.length<2)return;
    const cur=s.track&&s.track.getSettings?s.track.getSettings().deviceId:null;
    const i=s.cams.findIndex(d=>d.deviceId===cur);const nx=s.cams[(i+1)%s.cams.length];
    localStorage.setItem('md-cam',nx.deviceId);
    const {el,onCode,ui}=s;await start(el,onCode,ui);
  }
  /* toque para enfocar: punto de interés + enfoque puntual, y vuelta al continuo */
  async function tapFocus(ev){
    const s=st;if(!s||!s.track)return;const r=s.video.getBoundingClientRect();
    const x=Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width)),y=Math.min(1,Math.max(0,(ev.clientY-r.top)/r.height));
    const ring=s.el.querySelector('.focus-ring');if(ring){ring.style.left=(ev.clientX-r.left)+'px';ring.style.top=(ev.clientY-r.top)+'px';ring.classList.remove('go');void ring.offsetWidth;ring.classList.add('go')}
    const c=s.caps||{},fm=c.focusMode||[];
    const adv={};if(c.pointsOfInterest!==undefined||'pointsOfInterest' in (s.track.getSettings?s.track.getSettings():{}))adv.pointsOfInterest=[{x,y}];
    if(fm.includes('single-shot'))adv.focusMode='single-shot';else if(fm.includes('continuous'))adv.focusMode='continuous';
    if(Object.keys(adv).length)await apply(s.track,adv);
    if(fm.includes('single-shot')&&fm.includes('continuous'))setTimeout(()=>{if(st===s)apply(s.track,{focusMode:'continuous'})},1800);
  }
  function loop(s){
    const cv=document.createElement('canvas'),g=cv.getContext('2d',{willReadFrequently:true});
    let busy=false,last=0;
    const tick=async now=>{
      if(s.stopped||s.done)return;
      requestAnimationFrame(tick);
      const v=s.video;if(busy||v.readyState<2||!v.videoWidth)return;
      const gap=s.det?90:140;if(now-last<gap)return;last=now;busy=true;s.frames++;
      try{
        let code=null;
        if(s.det){const r=await s.det.detect(v);if(r&&r.length)code=valid(r[0].rawValue)}
        else{
          // ZXing: banda central (donde está el marco) y, cada 3 intentos, el fotograma completo
          const W=v.videoWidth,H=v.videoHeight,full=s.frames%3===0;
          const cw=full?W:Math.round(W*0.9),ch=full?H:Math.round(H*0.5),sx=(W-cw)/2,sy=(H-ch)/2,k=Math.min(1,1280/cw);
          cv.width=Math.round(cw*k);cv.height=Math.round(ch*k);g.drawImage(v,sx,sy,cw,ch,0,0,cv.width,cv.height);
          code=valid(zxDecodeCanvas(cv));
        }
        if(code&&!s.done){s.done=true;navigator.vibrate&&navigator.vibrate(80);s.onCode(code)}
      }catch(e){}finally{busy=false}
    };
    requestAnimationFrame(tick);
  }
  async function stop(){
    const s=st;st=null;if(!s)return;s.stopped=true;
    try{s.stream&&s.stream.getTracks().forEach(t=>t.stop())}catch(e){}
    try{s.video&&s.video.remove()}catch(e){}
  }

  /* ---------- foto fija ---------- */
  function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Imagen no válida'));i.src=typeof src==='string'?src:URL.createObjectURL(src)})}
  async function decodeImage(file){
    const img=await loadImg(file);
    const det=await nativeDetector();
    if(det){try{const r=await det.detect(img);if(r&&r.length&&valid(r[0].rawValue))return valid(r[0].rawValue)}catch(e){}}
    const W=img.naturalWidth,H=img.naturalHeight;
    const cv=document.createElement('canvas'),g=cv.getContext('2d',{willReadFrequently:true});
    // varios tamaños, recortes y giros: el código puede salir pequeño, grande o en vertical
    const crops=[[0,0,1,1],[0.1,0.25,0.8,0.5],[0,0.15,1,0.7],[0.2,0.3,0.6,0.4]];
    for(const L of [1400,2200,900]){
      for(const [cx,cy,cw,ch] of crops){
        for(const rot of [0,90]){
          const sw=W*cw,sh=H*ch,k=Math.min(1.5,L/Math.max(sw,sh));const w=Math.round(sw*k),h=Math.round(sh*k);
          cv.width=rot?h:w;cv.height=rot?w:h;g.save();if(rot){g.translate(h,0);g.rotate(Math.PI/2)}g.drawImage(img,W*cx,H*cy,sw,sh,0,0,w,h);g.restore();
          const t=valid(zxDecodeCanvas(cv));if(t)return t;
        }
      }
    }
    return null;
  }
  return {start,stop,setZoom,toggleTorch,nextCamera,tapFocus,decodeImage,nativeDetector,active:()=>!!st};
})();
