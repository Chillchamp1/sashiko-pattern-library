// ── About-this-library toggle (gallery) ─────────────────────────────────────
// Average daily visitors over the last 7 days, from GoatCounter's public
// visitor-counter endpoint (CORS-enabled, no auth). Fetched once per session on
// first open; the line simply stays hidden if the fetch fails.
let _aboutVisitorsLoaded=false;
function _loadAboutVisitors(){
  if(_aboutVisitorsLoaded)return;_aboutVisitorsLoaded=true;
  const el=document.getElementById('aboutVisitors');if(!el)return;
  const start=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  fetch('https://sashiko.goatcounter.com/counter/TOTAL.json?start='+start)
    .then(r=>r.json())
    .then(j=>{
      const n=parseInt(String(j.count_unique||j.count||'').replace(/\D/g,''),10);
      if(!n)return;
      el.textContent='≈ '+Math.max(1,Math.round(n/7))+' visitors per day (last 7 days)';
      el.style.display='';
    })
    .catch(()=>{});
}
window.toggleAbout=function(){
  const b=document.getElementById('aboutBody'),t=document.getElementById('aboutToggle');
  if(!b)return;
  const open=b.style.display!=='none';
  b.style.display=open?'none':'block';
  if(t)t.classList.toggle('on',!open);
  if(!open)_loadAboutVisitors();
};

// ── Download dropdown (pattern viewer) ───────────────────────────────────────
window.toggleDownloadMenu=function(){
  const m=document.getElementById('dlMenu');if(!m)return;
  m.style.display=m.style.display==='none'?'flex':'none';
};
// Close the menu when clicking elsewhere
document.addEventListener('pointerdown',e=>{
  const bar=document.getElementById('downloadBar'),m=document.getElementById('dlMenu');
  if(!bar||!m||m.style.display==='none')return;
  if(!bar.contains(e.target))m.style.display='none';
},true);

window.downloadSTL=function(){
  document.getElementById('dlMenu').style.display='none';
  alert('STL export (3D-printable stitching template) is coming soon.');
};

// ── Animated-GIF export ──────────────────────────────────────────────────────
// Captures the current pattern's stitch animation frame-by-frame off the live
// canvas, quantises to a 256-colour palette (median cut) and encodes a looping
// GIF89a. Fully self-contained — no library, no worker.
//
// STREAMING: one frame per stitch (so every stitch is drawn one after the other),
// encoded and appended to the output one at a time — only the *current* frame's
// pixels are ever held in RAM, so memory stays flat regardless of stitch count.
// The work is chunked with awaits so the tab stays responsive and shows progress.
// Safety bound on frames. Tiled patterns can have thousands of stitches; one frame each
// would make a huge, minutes-long GIF and a slow (O(frames²)) render. Up to the cap every
// stitch gets its own frame; above it the timeline is evenly sampled to CAP frames (still
// very smooth). Memory is flat either way (streaming).
const GIF_FRAME_CAP=400;

window.downloadGIF=function(){
  const menu=document.getElementById('dlMenu');if(menu)menu.style.display='none';
  if(!curPat||!TOTAL){alert('Open a pattern first.');return;}
  const item=document.querySelector('.dl-item');           // the GIF row
  const restore=item?item.innerHTML:'';
  const setBusy=txt=>{if(item){item.classList.add('busy');item.innerHTML='<span>🎞 '+txt+'</span><small>keep this tab open…</small>';}};
  setBusy('Generating GIF…');
  setTimeout(async()=>{
    try{
      await _buildGIF(p=>setBusy('Generating GIF… '+p+'%'));
      if(window._recordDownload)_recordDownload(curPat.id);   // global ⬇ counter (deduped per visitor)
    }
    catch(err){ console.error(err); alert('GIF export failed: '+err.message); }
    if(item){item.classList.remove('busy');item.innerHTML=restore;}
  },40);
};

// Number of individual stitches to animate (one frame each). Exp patterns lay many
// stitches per routed segment, so use the realistic stitch-scene count; other engines
// already step one stitch at a time (TOTAL).
function _gifStitchCount(){
  if(isEXP){try{const sc=_galStitchScene();return (sc&&sc.stitches&&sc.stitches.length)||TOTAL;}catch(e){return TOTAL;}}
  return TOTAL;
}

async function _buildGIF(onProgress){
  const _yield=()=>new Promise(r=>setTimeout(r,0));
  const stitchCount=_gifStitchCount();
  const F=Math.max(2,Math.min(stitchCount,GIF_FRAME_CAP));
  if(stitchCount>GIF_FRAME_CAP)console.warn('GIF: '+stitchCount+' stitches > cap '+GIF_FRAME_CAP+' — sampling '+F+' frames.');
  const delay=Math.max(3,Math.min(7,Math.round(1200/F)));   // per-frame centiseconds (~12s target loop)

  // Clean, un-zoomed render for capture; restored at the end.
  const sZoom=_zoom,sPanX=_panX,sPanY=_panY,sStep=step;
  if(playing)pause();
  _zoom=1;_panX=0;_panY=0;
  const ch=(isEXP&&EXP_canvasH)?EXP_canvasH:SIZE;
  _setupCanvasSize(SIZE,ch);
  const srcW=cv.width,srcH=cv.height,cap=420;
  const dscale=Math.min(1,cap/Math.max(srcW,srcH));
  const outW=Math.max(1,Math.round(srcW*dscale)),outH=Math.max(1,Math.round(srcH*dscale));
  const tmp=document.createElement('canvas');tmp.width=outW;tmp.height=outH;
  const tctx=tmp.getContext('2d');
  const px=outW*outH;
  // Frame i reveals ~i stitches (one per frame when F == stitchCount; even sampling when capped).
  const stepFor=i=>Math.round(i/(F-1)*TOTAL);
  const grab=i=>{render(stepFor(i));tctx.clearRect(0,0,outW,outH);tctx.drawImage(cv,0,0,srcW,srcH,0,0,outW,outH);return tctx.getImageData(0,0,outW,outH).data;};

  // ── Palette: median-cut over a sample drawn from a spread of representative frames
  // (not all frames — colours barely change frame-to-frame, so this stays cheap + flat).
  const PSAMP=Math.min(F,24);
  const stride=Math.max(1,Math.floor(px*PSAMP/40000));   // ~40k samples total
  const samples=[];
  for(let s=0;s<PSAMP;s++){
    const data=grab(Math.round(s/(PSAMP-1||1)*(F-1)));
    for(let p=0;p<px;p+=stride){const o=p*4;samples.push([data[o],data[o+1],data[o+2]]);}
    if(s%4===0){onProgress&&onProgress(Math.round(s/PSAMP*15));await _yield();}
  }
  const palette=_medianCut(samples,256);
  const palSize=palette.length;
  let bits=1;while((1<<bits)<palSize)bits++;bits=Math.max(1,bits);
  const tableLen=1<<bits;
  const cache=new Int16Array(32768).fill(-1);
  const nearest=(r,g,b)=>{
    const key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);
    let id=cache[key];if(id>=0)return id;
    let best=0,bd=1e9;
    for(let c=0;c<palSize;c++){const pc=palette[c],dr=r-pc[0],dg=g-pc[1],db=b-pc[2],d=dr*dr+dg*dg+db*db;if(d<bd){bd=d;best=c;if(d===0)break;}}
    cache[key]=best;return best;
  };

  // ── Output is built as a list of byte chunks (≈ final file size, packed) — never the
  // raw RGBA of every frame. Blob([...chunks]) assembles it at the end.
  const parts=[];
  const head=[];
  const pStr=(a,s)=>{for(let i=0;i<s.length;i++)a.push(s.charCodeAt(i));};
  const pU16=(a,n)=>a.push(n&255,(n>>8)&255);
  pStr(head,'GIF89a');pU16(head,outW);pU16(head,outH);
  head.push(0x80|(bits-1),0,0);
  for(let c=0;c<tableLen;c++){const pc=c<palSize?palette[c]:[0,0,0];head.push(pc[0],pc[1],pc[2]);}
  head.push(0x21,0xFF,0x0B);pStr(head,'NETSCAPE2.0');head.push(0x03,0x01,0x00,0x00,0x00);
  parts.push(Uint8Array.from(head));

  const idx=new Uint8Array(px);
  for(let i=0;i<F;i++){
    const data=grab(i);
    for(let p=0;p<px;p++){const o=p*4;idx[p]=nearest(data[o],data[o+1],data[o+2]);}
    const fb=[];
    fb.push(0x21,0xF9,0x04,0x00);pU16(fb,delay);fb.push(0x00,0x00);   // Graphic Control Ext
    fb.push(0x2C);pU16(fb,0);pU16(fb,0);pU16(fb,outW);pU16(fb,outH);fb.push(0x00);   // Image Descriptor
    _lzwEncode(idx,bits,fb);
    parts.push(Uint8Array.from(fb));
    if(i%8===0){onProgress&&onProgress(15+Math.round(i/F*85));await _yield();}
  }
  parts.push(Uint8Array.from([0x3B]));   // trailer

  // Restore the live view.
  _zoom=sZoom;_panX=sPanX;_panY=sPanY;
  _setupCanvasSize(SIZE,(isEXP&&EXP_canvasH)?EXP_canvasH:SIZE);
  step=sStep;render(step);

  const blob=new Blob(parts,{type:'image/gif'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=(_safeName(curPat)+'.gif');
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

function _safeName(pat){
  const n=(pat.name||pat.id||'sashiko').toString().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return 'sashiko-'+(n||'pattern');
}

// Median-cut colour quantisation → up to `max` representative RGB colours.
function _medianCut(pixels,max){
  if(!pixels.length)return [[0,0,0]];
  let boxes=[pixels];
  while(boxes.length<max){
    // Pick the box with the largest channel range to split.
    let bi=-1,bestRange=-1,bestCh=0;
    for(let i=0;i<boxes.length;i++){
      const b=boxes[i];if(b.length<2)continue;
      let mn=[255,255,255],mx=[0,0,0];
      for(const p of b)for(let c=0;c<3;c++){if(p[c]<mn[c])mn[c]=p[c];if(p[c]>mx[c])mx[c]=p[c];}
      for(let c=0;c<3;c++){const r=mx[c]-mn[c];if(r>bestRange){bestRange=r;bi=i;bestCh=c;}}
    }
    if(bi<0||bestRange<=0)break;
    const box=boxes[bi];
    box.sort((p,q)=>p[bestCh]-q[bestCh]);
    const mid=box.length>>1;
    boxes.splice(bi,1,box.slice(0,mid),box.slice(mid));
  }
  return boxes.map(b=>{
    const s=[0,0,0];for(const p of b)for(let c=0;c<3;c++)s[c]+=p[c];
    const n=b.length||1;return [Math.round(s[0]/n),Math.round(s[1]/n),Math.round(s[2]/n)];
  });
}

// GIF variable-length LZW encoder. Writes the min-code-size byte, sub-blocked
// image data and the block terminator into `out`. This is a faithful port of
// Kevin Weiner's LZWEncoder (the classic UNIX-compress GIF adaptation used by
// every JS GIF library) — proven correct against real decoders.
function _lzwEncode(indices,colorBits,out){
  const BITS=12, HSIZE=5003, masks=[0,1,3,7,15,31,63,127,255,511,1023,2047,4095,8191,16383,32767,65535];
  const initCodeSize=Math.max(2,colorBits);
  const htab=new Int32Array(HSIZE), codetab=new Int32Array(HSIZE);
  let n_bits,maxcode,clearCode,eofCode,free_ent,clear_flg=false;
  let cur_accum=0,cur_bits=0,a_count=0;
  const accum=new Uint8Array(256);
  let px=0;const remaining=indices.length;
  const nextPixel=()=>px<remaining?indices[px++]:-1;
  const MAXCODE=nb=>(1<<nb)-1;
  const flush_char=()=>{if(a_count>0){out.push(a_count);for(let i=0;i<a_count;i++)out.push(accum[i]);a_count=0;}};
  const char_out=b=>{accum[a_count++]=b;if(a_count>=254)flush_char();};
  const cl_hash=()=>{for(let i=0;i<HSIZE;i++)htab[i]=-1;};
  function output(code){
    cur_accum&=masks[cur_bits];
    if(cur_bits>0)cur_accum|=(code<<cur_bits);else cur_accum=code;
    cur_bits+=n_bits;
    while(cur_bits>=8){char_out(cur_accum&0xff);cur_accum>>=8;cur_bits-=8;}
    if(free_ent>maxcode||clear_flg){
      if(clear_flg){maxcode=MAXCODE(n_bits=initCodeSize+1);clear_flg=false;}
      else{++n_bits;maxcode=(n_bits===BITS)?(1<<BITS):MAXCODE(n_bits);}
    }
    if(code===eofCode){while(cur_bits>0){char_out(cur_accum&0xff);cur_accum>>=8;cur_bits-=8;}flush_char();}
  }
  function cl_block(){cl_hash();free_ent=clearCode+2;clear_flg=true;output(clearCode);}

  out.push(initCodeSize);                 // GIF "LZW minimum code size" byte
  const g_init_bits=initCodeSize+1;
  n_bits=g_init_bits;maxcode=MAXCODE(n_bits);
  clearCode=1<<initCodeSize;eofCode=clearCode+1;free_ent=clearCode+2;
  a_count=0;
  let ent=nextPixel();
  let hshift=0;for(let fc=HSIZE;fc<65536;fc*=2)++hshift;hshift=8-hshift;
  cl_hash();
  output(clearCode);
  let c;
  outer:while((c=nextPixel())!==-1){
    const fcode=(c<<BITS)+ent;
    let i=(c<<hshift)^ent;
    if(htab[i]===fcode){ent=codetab[i];continue;}
    else if(htab[i]>=0){
      let disp=HSIZE-i;if(i===0)disp=1;
      do{ if((i-=disp)<0)i+=HSIZE; if(htab[i]===fcode){ent=codetab[i];continue outer;} }while(htab[i]>=0);
    }
    output(ent);ent=c;
    if(free_ent<(1<<BITS)){codetab[i]=free_ent++;htab[i]=fcode;}
    else cl_block();
  }
  output(ent);
  output(eofCode);
  out.push(0);   // block terminator
}

// ── PDF export (one A4 sheet) ────────────────────────────────────────────────
// A printable stitching sheet for a custom pattern, laid out on a single A4 page:
//   • Pattern window — the realistic stitch view (denim + off-white stitches) with the
//     dot grid, exactly as the gallery shows it.
//   • Drafting window — SAME size, same framing, but the pattern drawn as weak thin
//     LINES over the dot grid (the guide a maker traces onto cloth), not as stitches.
//   • Pass windows — one small window per stitch family (only when there are ≥2), each
//     that family's geometry drawn as lines, so each pass can be worked on its own.
// Each window is rendered to an offscreen canvas (reusing the live stitch/grid drawing
// helpers) and embedded as a JPEG image XObject. The PDF is written by hand (no library,
// no external resources) — the same self-contained philosophy as the GIF encoder above.
const A4_W=595.28, A4_H=841.89;

window.downloadPDF=function(){
  const menu=document.getElementById('dlMenu');if(menu)menu.style.display='none';
  if(!curPat){alert('Open a pattern first.');return;}
  try{
    _buildPDF();
    if(window._recordDownload)_recordDownload(curPat.id);   // global ⬇ counter (deduped per visitor)
  }
  catch(err){ console.error(err); alert('PDF export failed: '+err.message); }
};

// Offscreen square canvas that draws in anim coordinates (0..SIZE) at `px` backing pixels.
function _pdfCanvas(px){
  const c=document.createElement('canvas');c.width=px;c.height=px;
  const x=c.getContext('2d');x.scale(px/SIZE,px/SIZE);
  return {c,x};
}
function _pdfJPEG(canvas,q){
  const url=canvas.toDataURL('image/jpeg',q==null?0.92:q);
  const b64=url.slice(url.indexOf(',')+1), bin=atob(b64), u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  return u;
}
// Dot grid (mirrors the CAD/gallery grid geometry) in caller-chosen colours — so it can
// read as white-on-denim (stitch window) or dark-on-white (draft/pass windows).
function _pdfDotGrid(x,colMain,colSub,rMain,rSub){
  const M=CAD_MICRO;
  const[mnU,mxU]=EXP_uRange,[mnV,mxV]=EXP_vRange;
  const u0=Math.floor(mnU/M)*M,u1=Math.ceil(mxU/M)*M,v0=Math.floor(mnV/M)*M,v1=Math.ceil(mxV/M)*M;
  if((u1-u0)>4000||(v1-v0)>4000)return;   // sanity guard for extreme tile counts
  for(let u=u0;u<=u1;u++)for(let v=v0;v<=v1;v++){
    const onMain=(u%M===0)&&(v%M===0);
    const p=EXP_g2s([u,v]);
    x.fillStyle=onMain?colMain:colSub;
    x.beginPath();x.arc(p.x,p.y,onMain?rMain:rSub,0,Math.PI*2);x.fill();
  }
}
// Stitch window — PRINT style: white paper, dark dot grid, and the running stitches drawn
// as dark ink dashes (no dark fabric fill — the PDF is made to be printed). A family with
// an assigned thread colour keeps a print-darkened version of it; otherwise dark ink.
function _pdfStitchWindow(px){
  const {c,x}=_pdfCanvas(px);
  x.fillStyle='#ffffff';x.fillRect(0,0,SIZE,SIZE);
  _pdfDotGrid(x,'rgba(45,80,140,0.92)','rgba(45,80,140,0.6)',1.6,0.95);
  const sc=_galStitchScene();
  x.lineCap='round';
  for(const s of sc.stitches){
    if(_famToggles[s.fam]===false)continue;
    const tc=galThreadColors[s.fam];
    x.strokeStyle=tc?_pdfInk(tc):'rgba(18,42,82,0.95)';
    x.lineWidth=Math.max(1.1,sc.w*0.62);
    x.beginPath();x.moveTo(s.x1,s.y1);x.lineTo(s.x2,s.y2);x.stroke();
  }
  return c;
}
// Draw the routed geometry as lines. famOnly>=0 → only that family; else the whole pattern.
function _pdfDrawLines(x,famOnly,stroke,width){
  x.strokeStyle=stroke;x.lineWidth=width;x.lineCap='round';x.lineJoin='round';
  x.beginPath();
  for(const s of EXP_path){
    if(famOnly>=0&&(s.fam||0)!==famOnly)continue;
    const a=EXP_g2s(s.start),b=EXP_g2s(s.end);
    x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);
  }
  x.stroke();
}
// Draft window = the gallery "Draft" view, but as lines: the dot grid, the drafting help
// (each straight line extended ruler-style across the frame + every arc recovered as its
// FULL circle), and on top the actual stitch-path lines HIGHLIGHTED. Same framing/size as
// the stitch window. Not the individual stitches — the lines the stitches run along.
function _pdfDraftWindow(px){
  const {c,x}=_pdfCanvas(px);
  x.fillStyle='#ffffff';x.fillRect(0,0,SIZE,SIZE);
  _pdfDotGrid(x,'rgba(45,80,140,0.92)','rgba(45,80,140,0.6)',1.6,0.95);
  // Drafting guides (weak, non-overpowering): ruler-extended straight lines + full circles.
  const {lines,circles}=_galDraftShapes();
  x.strokeStyle='rgba(40,70,120,0.32)';x.lineWidth=0.6;x.lineCap='round';x.setLineDash([]);
  const seen=new Set();
  lines.forEach(l=>{
    const p0=EXP_g2s(l.a),p1=EXP_g2s(l.b);
    let dx=p1.x-p0.x,dy=p1.y-p0.y;const len=Math.hypot(dx,dy);
    if(len<1e-6)return;dx/=len;dy/=len;
    let nx=-dy,ny=dx;if(nx<-1e-9||(Math.abs(nx)<1e-9&&ny<0)){nx=-nx;ny=-ny;}
    const cc=nx*p0.x+ny*p0.y, key=Math.round(nx*100)/100+'|'+Math.round(ny*100)/100+'|'+Math.round(cc);
    if(seen.has(key))return;seen.add(key);
    const seg=_clipInfiniteLine(p0.x,p0.y,dx,dy,SIZE,SIZE);
    if(!seg)return;
    x.beginPath();x.moveTo(seg[0][0],seg[0][1]);x.lineTo(seg[1][0],seg[1][1]);x.stroke();
  });
  const NS=72;
  circles.forEach(cc=>{
    x.beginPath();
    // Iso circles are recovered as round-on-screen (see _galDraftShapes); draw them the same way.
    const gp=cc.iso?_isoRoundArcPts(cc.c,cc.r,0,2*Math.PI,NS)
                   :Array.from({length:NS+1},(_,k)=>{const a=k/NS*2*Math.PI;return[cc.c[0]+cc.r*Math.cos(a),cc.c[1]+cc.r*Math.sin(a)];});
    gp.forEach((g,k)=>{const p=EXP_g2s(g);if(k===0)x.moveTo(p.x,p.y);else x.lineTo(p.x,p.y);});
    x.stroke();
  });
  // The stitch-path lines highlighted on top.
  _pdfDrawLines(x,-1,'rgba(18,42,82,0.72)',1.0);
  return c;
}
// Pass window: white, faint grid, one family's geometry as clear lines (family-tinted).
function _pdfPassWindow(px,fam){
  const {c,x}=_pdfCanvas(px);
  x.fillStyle='#ffffff';x.fillRect(0,0,SIZE,SIZE);
  _pdfDotGrid(x,'rgba(55,90,145,0.85)','rgba(55,90,145,0.5)',1.4,0.85);
  _pdfDrawLines(x,fam,_pdfInk(famColor(fam)),1.3);
  return c;
}
// Darken a family colour to a print-legible ink (the pale gallery hues wash out on paper).
function _pdfInk(hex){
  const m=/^#?([0-9a-f]{6})$/i.exec(hex||'');
  if(!m)return '#2a3f5f';
  const n=parseInt(m[1],16);let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  r=Math.round(r*0.5);g=Math.round(g*0.5);b=Math.round(b*0.5);
  return 'rgb('+r+','+g+','+b+')';
}

// Choose pass-window columns/cell so all N windows (with labels) fit the available box;
// maximise cell size, capped so passes stay clearly SMALLER than the two main windows.
function _pdfPassLayout(n,cw,availH,gap,labelH,cap){
  let best={cols:1,cell:0};
  for(let cols=1;cols<=n;cols++){
    const rows=Math.ceil(n/cols);
    const cellW=(cw-(cols-1)*gap)/cols;
    const cellH=(availH-(rows-1)*gap-rows*labelH)/rows;
    const cell=Math.min(cellW,cellH,cap);
    if(cell>best.cell)best={cols,cell};
  }
  return best;
}

function _buildPDF(){
  const isE=isEXP&&EXP_path&&EXP_path.length;
  const images=[],texts=[];
  const M=40, cw=A4_W-2*M;
  const rawName=(typeof _displayName==='function'?_displayName(curPat.name||'Sashiko pattern'):(curPat.name||'Sashiko pattern'));
  texts.push({x:M,y:A4_H-M-4,size:16,text:_pdfAscii(rawName)});
  texts.push({x:M,y:A4_H-M-20,size:8.5,text:_pdfAscii('Sashiko stitching sheet  ·  sashikolib.org')});
  // Footer: the site, centred at the bottom (Helvetica ~0.5em average glyph width).
  const foot='sashikolib.org';
  texts.push({x:(A4_W-foot.length*8.5*0.5)/2, y:22, size:8.5, text:foot});

  if(isE){
    const gap=16, big=(cw-gap)/2;
    const bandLabelY=A4_H-M-40;
    texts.push({x:M,          y:bandLabelY,size:9.5,text:'Pattern — stitches & grid'});
    texts.push({x:M+big+gap,  y:bandLabelY,size:9.5,text:'Drafting lines'});
    const bigTop=bandLabelY-8, bigBottom=bigTop-big;
    const bigPx=Math.min(1100,Math.round(big*3));
    images.push({data:_pdfJPEG(_pdfStitchWindow(bigPx)),w:bigPx,h:bigPx,x:M,        y:bigBottom,dw:big,dh:big});
    images.push({data:_pdfJPEG(_pdfDraftWindow(bigPx)), w:bigPx,h:bigPx,x:M+big+gap,y:bigBottom,dw:big,dh:big});

    const fams=[...new Set(EXP_path.map(s=>s.fam||0))].sort((a,b)=>a-b);
    if(fams.length>=2){
      const headY=bigBottom-20;
      texts.push({x:M,y:headY,size:9.5,text:'Passes / families ('+fams.length+') — one line pass per window'});
      const availTop=headY-10, gap2=12, labelH=11;
      const availH=availTop-M;
      const {cols,cell}=_pdfPassLayout(fams.length,cw,availH,gap2,labelH,Math.min(150,big*0.62));
      if(cell>8){
        const rowW=cols*cell+(cols-1)*gap2, x0=M+(cw-rowW)/2;
        const pitch=cell+labelH+gap2;
        const cellPx=Math.min(600,Math.round(cell*3));
        fams.forEach((f,i)=>{
          const r=Math.floor(i/cols), cc=i%cols;
          const wx=x0+cc*(cell+gap2);
          const wTop=availTop-labelH-r*pitch, wBottom=wTop-cell;
          texts.push({x:wx,y:wTop+2,size:7.5,text:'Pass '+(i+1)});
          images.push({data:_pdfJPEG(_pdfPassWindow(cellPx,f)),w:cellPx,h:cellPx,x:wx,y:wBottom,dw:cell,dh:cell});
        });
      }
    }
  }else{
    // Non-custom patterns have no stitch/family model — render the current full view
    // as a single centred window so the button still produces a useful sheet.
    const sStep=step,sZ=_zoom,sPx=_panX,sPy=_panY;
    if(playing)pause();
    _zoom=1;_panX=0;_panY=0;_setupCanvasSize(SIZE,SIZE);
    render(TOTAL);
    const jpg=_pdfJPEG(cv,0.92);
    _zoom=sZ;_panX=sPx;_panY=sPy;_setupCanvasSize(SIZE,(isEXP&&EXP_canvasH)?EXP_canvasH:SIZE);
    step=sStep;render(step);
    const side=Math.min(cw,A4_H-2*M-80);
    const x0=M+(cw-side)/2, yTop=A4_H-M-40;
    images.push({data:jpg,w:cv.width,h:cv.height,x:x0,y:yTop-side,dw:side,dh:side});
  }

  _pdfDownload(new Blob([_pdfSerialize(A4_W,A4_H,images,texts)],{type:'application/pdf'}),_safeName(curPat)+'.pdf');
}

// ── Minimal PDF serialiser ───────────────────────────────────────────────────
// One page, Helvetica (a PDF base-14 font, no embedding needed) for text, and JPEG
// image XObjects (DCTDecode — the JPEG bytes are embedded verbatim). Objects:
// 1 Catalog · 2 Pages · 3 Page · 4 Contents · 5 Font · 6…(5+N) Images.
function _pdfNum(v){return (Math.round(v*100)/100).toString();}
function _pdfEsc(s){return s.replace(/[\\()]/g,c=>'\\'+c);}
function _pdfAscii(s){
  return ((s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'')   // strip diacritics
    .replace(/[^\x20-\x7e]/g,'').replace(/\s+/g,' ').trim())||'Sashiko pattern';
}
function _pdfDownload(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function _pdfSerialize(W,H,images,texts){
  const parts=[];let len=0;
  const enc=s=>{const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i)&0xff;return a;};
  const put=x=>{const u=typeof x==='string'?enc(x):x;parts.push(u);len+=u.length;};
  const off=[];
  const nImg=images.length, fontObj=5, imgObj0=6, nObj=5+nImg;

  // Content stream: place each image, then draw each text run.
  let cs='';
  images.forEach((im,i)=>{cs+='q '+_pdfNum(im.dw)+' 0 0 '+_pdfNum(im.dh)+' '+_pdfNum(im.x)+' '+_pdfNum(im.y)+' cm /Im'+i+' Do Q\n';});
  texts.forEach(t=>{cs+='BT /F1 '+_pdfNum(t.size)+' Tf '+_pdfNum(t.x)+' '+_pdfNum(t.y)+' Td ('+_pdfEsc(t.text)+') Tj ET\n';});
  const csBytes=enc(cs);

  const startObj=n=>{off[n]=len;put(n+' 0 obj\n');};

  put('%PDF-1.3\n%\xE2\xE3\xCF\xD3\n');
  startObj(1);put('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  let xobj='';for(let i=0;i<nImg;i++)xobj+='/Im'+i+' '+(imgObj0+i)+' 0 R ';
  startObj(3);
  put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+_pdfNum(W)+' '+_pdfNum(H)+'] '+
      '/Resources << /Font << /F1 '+fontObj+' 0 R >> /XObject << '+xobj+'>> >> /Contents 4 0 R >>\nendobj\n');
  startObj(4);put('<< /Length '+csBytes.length+' >>\nstream\n');put(csBytes);put('\nendstream\nendobj\n');
  startObj(5);put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  images.forEach((im,i)=>{
    startObj(imgObj0+i);
    put('<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.data.length+' >>\nstream\n');
    put(im.data);put('\nendstream\nendobj\n');
  });

  const xrefOff=len;
  let xref='xref\n0 '+(nObj+1)+'\n0000000000 65535 f \n';
  for(let n=1;n<=nObj;n++)xref+=String(off[n]).padStart(10,'0')+' 00000 n \n';
  put(xref);
  put('trailer\n<< /Size '+(nObj+1)+' /Root 1 0 R >>\nstartxref\n'+xrefOff+'\n%%EOF');

  const out=new Uint8Array(len);let p=0;for(const u of parts){out.set(u,p);p+=u.length;}
  return out;
}
