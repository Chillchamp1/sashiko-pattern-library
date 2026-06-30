// ── About-this-library toggle (gallery) ─────────────────────────────────────
window.toggleAbout=function(){
  const b=document.getElementById('aboutBody'),t=document.getElementById('aboutToggle');
  if(!b)return;
  const open=b.style.display!=='none';
  b.style.display=open?'none':'block';
  if(t)t.classList.toggle('on',!open);
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

window.downloadPDF=function(){
  document.getElementById('dlMenu').style.display='none';
  alert('PDF export is coming soon.');
};
window.downloadSTL=function(){
  document.getElementById('dlMenu').style.display='none';
  alert('STL export (3D-printable stitching template) is coming soon.');
};

// ── Animated-GIF export ──────────────────────────────────────────────────────
// Captures the current pattern's stitch animation frame-by-frame off the live
// canvas, quantises to a 256-colour palette (median cut) and encodes a looping
// GIF89a. Fully self-contained — no library, no worker.
window.downloadGIF=function(){
  const menu=document.getElementById('dlMenu');if(menu)menu.style.display='none';
  if(!curPat||!TOTAL){alert('Open a pattern first.');return;}
  const item=document.querySelector('.dl-item');           // the GIF row
  const restore=item?item.innerHTML:'';
  if(item){item.classList.add('busy');item.innerHTML='<span>🎞 Generating GIF…</span><small>please wait a moment</small>';}
  // Let the UI repaint the "Generating…" state before the synchronous encode blocks.
  setTimeout(()=>{
    try{ _buildGIF(); }
    catch(err){ console.error(err); alert('GIF export failed: '+err.message); }
    if(item){item.classList.remove('busy');item.innerHTML=restore;}
  },40);
};

function _buildGIF(){
  const F=48;                                  // number of frames sampled across the animation
  const FRAME_MS=110;                          // ~5.3s loop
  // Clean, un-zoomed render for the capture; restore the live view afterwards.
  const sZoom=_zoom,sPanX=_panX,sPanY=_panY,sStep=step,wasPlaying=playing;
  if(playing)pause();
  _zoom=1;_panX=0;_panY=0;
  const ch=(isEXP&&EXP_canvasH)?EXP_canvasH:SIZE;
  _setupCanvasSize(SIZE,ch);
  // Output size: downscale the canvas so the GIF stays small.
  const srcW=cv.width,srcH=cv.height,cap=420;
  const sc=Math.min(1,cap/Math.max(srcW,srcH));
  const outW=Math.max(1,Math.round(srcW*sc)),outH=Math.max(1,Math.round(srcH*sc));
  const tmp=document.createElement('canvas');tmp.width=outW;tmp.height=outH;
  const tctx=tmp.getContext('2d');
  const frames=[];
  for(let i=0;i<F;i++){
    const st=Math.round(i/(F-1)*TOTAL);
    render(st);
    tctx.clearRect(0,0,outW,outH);
    tctx.drawImage(cv,0,0,srcW,srcH,0,0,outW,outH);
    frames.push(tctx.getImageData(0,0,outW,outH).data);
  }
  // Restore the live view.
  _zoom=sZoom;_panX=sPanX;_panY=sPanY;
  _setupCanvasSize(SIZE,(isEXP&&EXP_canvasH)?EXP_canvasH:SIZE);
  step=sStep;render(step);

  // Build a shared 256-colour palette from a sample across all frames.
  const samples=[];
  const px=outW*outH;
  const stride=Math.max(1,Math.floor(px*F/40000));   // ~40k colour samples total
  let k=0;
  for(const data of frames){
    for(let p=0;p<px;p++,k++){
      if(k%stride)continue;
      const o=p*4;samples.push([data[o],data[o+1],data[o+2]]);
    }
  }
  const palette=_medianCut(samples,256);
  const palSize=palette.length;                       // ≤256
  let bits=1;while((1<<bits)<palSize)bits++;           // colour-table size = 2^bits
  bits=Math.max(1,bits);
  const tableLen=1<<bits;
  // Nearest-colour lookup with a coarse cache (5 bits/channel).
  const cache=new Int16Array(32768).fill(-1);
  function nearest(r,g,b){
    const key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);
    let idx=cache[key];if(idx>=0)return idx;
    let best=0,bd=1e9;
    for(let c=0;c<palSize;c++){
      const pc=palette[c],dr=r-pc[0],dg=g-pc[1],db=b-pc[2];
      const d=dr*dr+dg*dg+db*db;
      if(d<bd){bd=d;best=c;if(d===0)break;}
    }
    cache[key]=best;return best;
  }

  const out=[];
  const pushStr=s=>{for(let i=0;i<s.length;i++)out.push(s.charCodeAt(i));};
  const pushU16=n=>{out.push(n&255,(n>>8)&255);};
  pushStr('GIF89a');
  pushU16(outW);pushU16(outH);
  out.push(0x80|((bits-1)));   // GCT flag, colour res, GCT size
  out.push(0);                 // background colour index
  out.push(0);                 // pixel aspect ratio
  for(let c=0;c<tableLen;c++){
    const pc=c<palSize?palette[c]:[0,0,0];
    out.push(pc[0],pc[1],pc[2]);
  }
  // Netscape looping extension (loop forever)
  out.push(0x21,0xFF,0x0B);pushStr('NETSCAPE2.0');out.push(0x03,0x01,0x00,0x00,0x00);
  const delay=Math.max(2,Math.round(FRAME_MS/10));
  for(const data of frames){
    // Graphic Control Extension
    out.push(0x21,0xF9,0x04,0x00);pushU16(delay);out.push(0x00,0x00);
    // Image Descriptor
    out.push(0x2C);pushU16(0);pushU16(0);pushU16(outW);pushU16(outH);out.push(0x00);
    // Indexed pixels
    const idx=new Uint8Array(px);
    for(let p=0;p<px;p++){const o=p*4;idx[p]=nearest(data[o],data[o+1],data[o+2]);}
    _lzwEncode(idx,bits,out);
  }
  out.push(0x3B);   // trailer

  const blob=new Blob([new Uint8Array(out)],{type:'image/gif'});
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
