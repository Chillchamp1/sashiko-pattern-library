// ── Animation state ────────────────────────────────────────────────────────
let curPat=null, PASSES=[], TOTAL=0;
let step=0, playing=false, raf=null, last=0;
let isHM=false, isPL=false, isEXP=false;
let TICK_MS=160, _zoom=1, _panX=0, _panY=0, _zoomInited=false;
let _famToggles={};
let _famPainting=false;

const FAM_PALETTE=['#ff5555','#ff9944','#ffdd44','#55dd55','#44cccc','#5599ff','#bb55ff','#ff55aa','#ff7744','#55ddbb'];
const FAM_DIR_LABEL={0:'V',1:'D1',2:'D2',3:'H'};
function famColor(famIdx){return FAM_PALETTE[famIdx%FAM_PALETTE.length];}
function famLabel(famIdx,dirCat){return 'Line '+(famIdx+1)+(dirCat!==undefined?' '+(FAM_DIR_LABEL[dirCat]||'?'):'');}

function zlw(w){return Math.max(0.5,w/_zoom);}
function zds(s){return Math.max(0.5,s/_zoom);}

// ── Drawing (star patterns) ────────────────────────────────────────────────
function drawFabric(){
  ctx.fillStyle=getCss('--fabric'); ctx.fillRect(0,0,SIZE,SIZE);
  // Dot grid: sub-grid dots everywhere, main intersections larger
  ctx.fillStyle='rgba(160,160,184,0.25)';
  const SUB=5, sds=zds(2), mds=zds(3.5);
  for(let x=PAD;x<=SIZE-PAD;x+=SUB){
    for(let y=PAD;y<=SIZE-PAD;y+=SUB){
      const onMain=((x-PAD)%G===0)&&((y-PAD)%G===0);
      const d=onMain?mds:sds;
      ctx.fillRect(x-d/2,y-d/2,d,d);
    }
  }
}
function drawGuide(){
  ctx.strokeStyle='rgba(220,235,255,0.15)'; ctx.lineWidth=zlw(1);
  for(let i=0;i<N;i++){ctx.beginPath();ctx.moveTo(sx(i),sy(0));ctx.lineTo(sx(i),sy(N-1));ctx.stroke();}
  for(let j=0;j<N;j++){ctx.beginPath();ctx.moveTo(sx(0),sy(j));ctx.lineTo(sx(N-1),sy(j));ctx.stroke();}
}
function drawStitch(i,j,dir,head,col){
  const s=segPx(sx(i),sy(j),dir,G,curPat.armScale);
  if(head){ctx.strokeStyle='rgba(255,255,255,0.28)';ctx.lineWidth=zlw(8);ctx.lineCap='round';ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();}
  ctx.strokeStyle=col||getCss('--thread'); ctx.lineWidth=zlw(3.1); ctx.lineCap='round'; ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();
}
function frontAll(p){for(const[i,j]of p.order)drawStitch(i,j,p.dir,false,PHASE_COLORS[p.dir][getPhase(i,j,p.dir)]);}
function drawBack(p,upto){
  if(upto<2)return;
  ctx.strokeStyle='rgba(243,239,228,0.16)';ctx.lineWidth=zlw(1.4);ctx.setLineDash([2,4]);ctx.lineCap='butt';
  ctx.beginPath();let[i0,j0]=p.order[0];ctx.moveTo(sx(i0),sy(j0));
  for(let k=1;k<upto;k++){const[i,j]=p.order[k];ctx.lineTo(sx(i),sy(j));}
  ctx.stroke();ctx.setLineDash([]);
}
function drawNeedle(i,j,dir){
  const x=sx(i),y=sy(j),c=getCss(DIRS[dir].col);
  const g=ctx.createRadialGradient(x,y,0,x,y,16);
  g.addColorStop(0,hexA(c,0.55));g.addColorStop(1,hexA(c,0));
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,16,0,7);ctx.fill();
  ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,3.4,0,7);ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-1,y-1,1.1,0,7);ctx.fill();
}
function locate(st){let s=st,p=0;while(p<PASSES.length&&s>PASSES[p].count){s-=PASSES[p].count;p++;}return{p,local:s};}

// ── Idle info bar (clickable → starts Play) ────────────────────────────────
function setIdleInfo(){
  const el=document.getElementById('info');
  el.classList.add('idle');
  el.innerHTML='<span class="info-play">▶&nbsp;<span>Press to begin</span></span>';
}
window.onInfoClick=function(){if(!playing&&step===0)play();};

// ── Render dispatcher ──────────────────────────────────────────────────────
function render(st){
  if(isHM){renderHM(st);return;}
  if(isPL){renderPolyline(st);return;}
  if(isEXP){renderExp(st);updateInfo(st,0,0);return;}
  drawFabric(); drawGuide();
  const{p,local}=locate(st);
  for(let k=0;k<p;k++)frontAll(PASSES[k]);
  if(p<PASSES.length){
    const cur=PASSES[p];
    for(let k=0;k<local;k++){const[i,j]=cur.order[k];drawStitch(i,j,cur.dir,k===local-1,PHASE_COLORS[cur.dir][getPhase(i,j,cur.dir)]);}
    if(local>0){const[i,j]=cur.order[local-1];drawNeedle(i,j,cur.dir);}
  }
  updateInfo(st,p,local);
}
function updateInfo(st,p,local){
  const el=document.getElementById('info');
  if(st===0){setIdleInfo();markJump(-1);return;}
  el.classList.remove('idle');el.onclick=null;
  if(isEXP){
    let famHtml='',famIdx=-1;
    if(st<=TOTAL&&st>0&&EXP_path.length){
      const s=EXP_path[Math.min(st-1,EXP_path.length-1)];
      if(s.fam!==undefined){
        const col=famColor(s.fam);
        const lbl=famLabel(s.fam);
        famHtml='&nbsp;<span class="pill" style="background:'+hexA(col,.16)+';color:'+col+'"><span class="dot" style="background:'+col+'"></span>'+lbl+'</span>';
        const fams=[...new Set(EXP_path.map(p=>p.fam))].sort((a,b)=>a-b);
        famIdx=fams.indexOf(s.fam);
      }
    }
    el.innerHTML=st>=TOTAL?'<span class="muted">complete &#10003;</span>'+famHtml:'stitch <b>'+st+'</b><span class="muted">/'+TOTAL+'</span>'+famHtml;
    markJump(famIdx);return;
  }
  const idx=(st>=TOTAL)?PASSES.length-1:p;
  const d=DIRS[PASSES[idx].dir],col=getCss(d.col);
  const pill=`<span class="pill" style="background:${hexA(col,.16)};color:${col}"><span class="dot" style="background:${col}"></span>pass ${idx+1}/${PASSES.length} · ${d.label} ${d.glyph}</span>`;
  let phase='';
  if(st<TOTAL&&local>0){const[ci,cj]=PASSES[p].order[local-1];const ph=getPhase(ci,cj,PASSES[p].dir);const pc=PHASE_COLORS[PASSES[p].dir][ph];phase=`&nbsp;<span style="font-size:11px;display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:3px;border-radius:1px;background:${pc}"></span><span style="color:${pc}">${ph===0?'even':'offset'}</span></span>`;}
  const cnt=st>=TOTAL?`<span class="muted">complete ✓</span>`:`stitch <b>${st}</b><span class="muted">/${TOTAL}</span>`;
  el.innerHTML=`${cnt} &nbsp;${pill}${phase}`;
  markJump(idx);
}
function markJump(idx){[...document.getElementById('jumpbar').children].forEach((b,i)=>b.classList.toggle('on',i===idx));}

// ── Jump bar ───────────────────────────────────────────────────────────────
function buildJumpBar(){
  const jb=document.getElementById('jumpbar');jb.innerHTML='';
  if(isEXP){
    let lastFam=-1;
    EXP_path.forEach((s,i)=>{
      if(s.fam!==lastFam){
        lastFam=s.fam;
        const b=document.createElement('button');
        const col=famColor(s.fam);
        const on=_famToggles[s.fam]!==false;
        b.className=on?'':'off';
        b.style.background=on?col+'33':'';
        b.style.borderColor=on?col:'';
        b.style.color=on?'#e7eef6':'';
        b.innerHTML=`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:4px;vertical-align:middle"></span>Line ${s.fam+1}`;
        b.title='Toggle family '+(s.fam+1);
        b.onclick=()=>{_famToggles[s.fam]=!_famToggles[s.fam];step=TOTAL;if(playing)pause();render(step);buildJumpBar();};
        jb.appendChild(b);
      }
    });
    return;
  }
  if(isPL){
    PL_passes.forEach((p,i)=>{
      const b=document.createElement('button');
      b.textContent=`${i+1} · ${p.glyph}`; b.title=p.label;
      const end=(i+1<PL_passes.length)?PL_passes[i+1].start:TOTAL;
      b.onclick=()=>{pause();step=end;render(step);};
      jb.appendChild(b);
    });
    return;
  }
  if(isHM){
    const p1cnt=HM_fronts.filter(fi=>HM_path[fi].phase===HM_phase_order[0]).length;
    const gl={H:'→',V:'↑'},lb={H:'All horizontal rows',V:'All vertical columns'};
    HM_phase_order.forEach((ph,i)=>{
      const b=document.createElement('button');
      b.textContent=`${i+1} · ${gl[ph]}`;b.title=lb[ph];
      b.onclick=()=>{pause();step=(i===0?p1cnt:HM_fronts.length);render(step);};
      jb.appendChild(b);
    });
    return;
  }
  let start=0;
  PASSES.forEach((p,i)=>{
    const b=document.createElement('button'),d=DIRS[p.dir];
    b.textContent=`${i+1} · ${d.glyph}`;b.title=d.label;
    const end=start+p.count;start=end;
    b.onclick=()=>{pause();step=end;render(step);};
    jb.appendChild(b);
  });
}

// ── Load pattern ───────────────────────────────────────────────────────────
function loadPattern(pat){
  _resetZoom();
  // Restore default square canvas if a previous exp iso pattern changed the height.
  if(Math.round(cv.height/DPR)!==SIZE){
    _setupCanvasSize(SIZE,SIZE);
  }

  curPat=pat;
  isEXP=pat.type==='exp';
  const isGen=pat.type==='generator';
  isHM=isGen||pat.type==='hitomezashi';
  isPL=pat.type==='polyline';

  document.getElementById('stitchSettings').style.display=isEXP?'block':'none';
  if(!isEXP){
    document.getElementById('famCanvas').onclick=null;
    document.getElementById('famCanvas').onmousedown=null;
    document.getElementById('famCanvas').onmousemove=null;
    document.getElementById('famCanvas').onmouseup=null;
  }
  cv.style.cursor='';
  if(isGen){
    showGenUI(true);
    refreshGen(true);
    return;
  }
  showGenUI(false);

  if(isEXP){
    setupExpCanvas(pat);
    EXP_path=buildExpPath(genTiledSegs(pat));
    TOTAL=EXP_path.length; PASSES=[];
    document.getElementById('animTitle').innerHTML=(pat.name||'Custom')+'<span class="jp">'+(pat.gridType==='isometric'?'Isometric':'Square')+' · DIY</span>';
    document.getElementById('animTip').textContent='';
    document.getElementById('stitchBody').style.display='none';
    document.getElementById('stitchToggle').innerHTML='⚙ Stitching Order Settings ▸';
    document.getElementById('stitchToggle').classList.remove('on');
    document.getElementById('famCanvas').onclick=famEditorClick;
    document.getElementById('famCanvas').onmousedown=e=>{_famPainting=true;famEditorClick(e);};
    document.getElementById('famCanvas').onmousemove=e=>{if(_famPainting)famEditorClick(e);};
    document.getElementById('famCanvas').onmouseup=()=>{_famPainting=false;};
    document.getElementById('famCanvas').onmouseleave=()=>{_famPainting=false;};
    _famToggles={};
    updateProfileBadge();
    step=0;if(playing)pause();
    buildJumpBar();render(0);
    return;
  }

  if(isPL){
    let built;
    PL_N=PL_NHU; PL_guideStep=2; built=buildTsuzukiYamagata(PL_NHU);
    PL_HU=(SIZE-2*PAD)/PL_N;
    PL_path=built.path;PL_fronts=built.fronts;PL_passes=built.passes;PL_shCount=built.shCount;
    TOTAL=PL_fronts.length;PASSES=[];
  } else if(isHM){
    buildHitomezashi(pat); TOTAL=HM_fronts.length; PASSES=[];
  } else {
    PASSES=buildPasses(pat.passes,N);
    PASSES.forEach(p=>p.count=p.order.length);
    TOTAL=PASSES.reduce((a,p)=>a+p.count,0);
  }
  document.getElementById('animTitle').innerHTML=pat.name+`<span class="jp">${pat.jp} · ${pat.en}</span>`;
  document.getElementById('animTip').textContent=pat.tip||'';
  step=0;if(playing)pause();
  buildJumpBar();render(0);
}

// ── Zoom (mouse wheel, canvas resolution) ─────────────────────────────────
function _setupCanvasSize(w,h){
  cv.width=Math.round(w*DPR*_zoom);
  cv.height=Math.round(h*DPR*_zoom);
  cv.style.width=w+'px';
  cv.style.height=h+'px';
  ctx.setTransform(DPR*_zoom,0,0,DPR*_zoom,0,0);
  // Visual zoom via CSS transform on stage (clipped by anim-body overflow:hidden)
  const s=document.querySelector('#animBody .stage');
  if(s){s.style.transform=`translate(${_panX}px,${_panY}px) scale(${_zoom})`;s.style.transformOrigin='0 0';}
}
function _resetZoom(){_zoom=1;_panX=0;_panY=0;_setupCanvasSize(SIZE,SIZE);}
function _clampPan(){
  const ch=EXP_canvasH||SIZE;
  const minVis=60; // at least 60px of pattern must remain visible
  const maxPX=SIZE*_zoom-minVis, maxPY=ch*_zoom-minVis;
  _panX=Math.max(-maxPX,Math.min(minVis*_zoom,_panX));
  _panY=Math.max(-maxPY,Math.min(minVis*_zoom,_panY));
}
let _panning=false,_panStartX=0,_panStartY=0,_panOrigX=0,_panOrigY=0;
function initAnimZoom(){
  if(_zoomInited)return;_zoomInited=true;
  cv.addEventListener('wheel',e=>{
    if(!document.getElementById('animView').classList.contains('open'))return;
    e.preventDefault();
    const delta=e.deltaY>0?0.9:1.1;
    const nz=Math.max(0.25,Math.min(_zoom*delta,8));
    if(nz===_zoom)return;
    // Zoom centered: keep visual center fixed
    const ch=EXP_canvasH||SIZE;
    const cx=SIZE/2*_zoom+_panX, cy=ch/2*_zoom+_panY;
    _zoom=nz;
    _panX=cx-SIZE/2*_zoom;
    _panY=cy-ch/2*_zoom;
    _setupCanvasSize(SIZE,ch);
    _clampPan();_setupCanvasSize(SIZE,ch);
    render(step);
  },{passive:false});
  // Pan via middle/right mouse drag
  cv.addEventListener('pointerdown',e=>{
    if(!document.getElementById('animView').classList.contains('open'))return;
    if(e.button===1||e.button===2||(e.button===0&&e.ctrlKey)){
      e.preventDefault();cv.setPointerCapture(e.pointerId);
      _panning=true;_panStartX=e.clientX;_panStartY=e.clientY;
      _panOrigX=_panX;_panOrigY=_panY;
      cv.style.cursor='grabbing';
    }
  });
  cv.addEventListener('pointermove',e=>{
    if(!_panning)return;
    _panX=_panOrigX+(e.clientX-_panStartX);
    _panY=_panOrigY+(e.clientY-_panStartY);
    _clampPan();_setupCanvasSize(SIZE,EXP_canvasH||SIZE);
  });
  cv.addEventListener('pointerup',e=>{
    if(_panning){_panning=false;cv.style.cursor='';cv.releasePointerCapture(e.pointerId);}
  });
  cv.addEventListener('pointerleave',()=>{
    if(_panning){_panning=false;cv.style.cursor='';}
  });
  cv.addEventListener('contextmenu',e=>e.preventDefault());
}

