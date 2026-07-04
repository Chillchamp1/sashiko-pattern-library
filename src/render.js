// ── Animation state ────────────────────────────────────────────────────────
let curPat=null, PASSES=[], TOTAL=0;
let step=0, playing=false, raf=null, last=0;
let isHM=false, isPL=false, isEXP=false;
let _animSource='gallery'; // 'gallery' or 'sandbox' — tracks where we came from
let TICK_MS=160, _zoom=1, _panX=0, _panY=0, _zoomInited=false;
// Shared animation speed: slider value 0..100 → total animation duration (ms).
// v=100 = fastest (10s, the old "Fast"); v=0 = slowest (90s, 3× the old "Slow").
let _animSpeedV=82;  // ~20s = the old "Medium" default
function _speedTotal(v){return 90000-(Math.max(0,Math.min(100,v))/100)*80000;}
let _famToggles={};
let _famPainting=false;

// Perceptually ordered: complementary pairs first, similar colours later
// 1-2 red-green (complementary), 3-4 blue-gold (complementary),
// 5-6 purple-coral, 7-8 teal-pink, 9-10 lime-mint
const FAM_PALETTE=['#ff5555','#55dd55','#5599ff','#ffdd44','#bb55ff','#ff8866','#44cccc','#ff55aa','#88cc44','#55ddbb'];
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

// ── Scrubber & Tile-cells control ─────────────────────────────────────────
function _updateScrubber(st){
  const el=document.getElementById('scrubber');
  if(el&&TOTAL>0)el.value=Math.round(st*1000/TOTAL);
  else if(el)el.value=0;
}
window.seekScrubber=function(v){
  if(playing)pause();
  step=Math.max(0,Math.min(TOTAL,Math.round(parseInt(v)*TOTAL/1000)));
  render(step);
};
let _tileCells=3;
function _reloadExpWithTiles(){
  if(!curPat||!isEXP)return;
  const effPat={...curPat,patMacro:patMacroForTiles(curPat,_tileCells)};
  setupExpCanvas(effPat);
  const expLay=computeExpLayout(effPat);
  EXP_path=filterVisiblePath(_expPathForView(effPat),expLay);
  TOTAL=EXP_path.length;
  _galStitchCache=null;_galDraftCache=null;
  step=TOTAL;
  buildJumpBar();render(step);
  const sc=document.getElementById('scrubber');if(sc)sc.value=1000;
}
window.stepTileCells=function(dir){
  _tileCells=Math.max(1,Math.min(12,_tileCells+dir));
  const lbl=document.getElementById('tileCellsVal');
  if(lbl)lbl.textContent=_tileCells+'×'+_tileCells;
  _reloadExpWithTiles();
};

// ── Render dispatcher ──────────────────────────────────────────────────────
function render(st){
  if(isHM){renderHM(st);_updateScrubber(st);return;}
  if(isPL){renderPolyline(st);_updateScrubber(st);return;}
  if(isEXP){renderExp(st);_updateExpJump(st);_updateScrubber(st);return;}
  drawFabric(); drawGuide();
  const{p,local}=locate(st);
  for(let k=0;k<p;k++)frontAll(PASSES[k]);
  if(p<PASSES.length){
    const cur=PASSES[p];
    for(let k=0;k<local;k++){const[i,j]=cur.order[k];drawStitch(i,j,cur.dir,k===local-1,PHASE_COLORS[cur.dir][getPhase(i,j,cur.dir)]);}
    if(local>0){const[i,j]=cur.order[local-1];drawNeedle(i,j,cur.dir);}
  }
  markJump(st===0?-1:(st>=TOTAL?PASSES.length-1:p));
  _updateScrubber(st);
}
function _updateExpJump(st){
  if(!isEXP)return;
  let famIdx=-1;
  if(st>0&&st<=TOTAL&&EXP_path.length){
    const s=EXP_path[Math.min(st-1,EXP_path.length-1)];
    if(s.fam!==undefined){
      const fams=[...new Set(EXP_path.map(p=>p.fam))].sort((a,b)=>a-b);
      famIdx=fams.indexOf(s.fam);
    }
  }
  markJump(famIdx);
}
function markJump(idx){[...document.getElementById('jumpbar').children].forEach((b,i)=>b.classList.toggle('on',i===idx));}

// ── Jump bar ───────────────────────────────────────────────────────────────
function buildJumpBar(){
  const jb=document.getElementById('jumpbar');jb.innerHTML='';
  if(isEXP){
    // Custom patterns render in stitch view; colours live in the Color popover
    // (#galColorPop), so the jump bar stays empty here.
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
  {const sc=document.getElementById('scrubber');if(sc)sc.value=0;}
  // Restore default square canvas if a previous exp iso pattern changed the height.
  if(Math.round(cv.height/DPR)!==SIZE){
    _setupCanvasSize(SIZE,SIZE);
  }

  curPat=pat;
  isEXP=pat.type==='exp';
  const isGen=pat.type==='generator';
  isHM=isGen||pat.type==='hitomezashi';
  isPL=pat.type==='polyline';

  // Update back button label
  const bb=document.querySelector('#animView .back-btn');
  if(bb)bb.textContent='← '+(_animSource==='sandbox'?'Sandbox':'Gallery');

  const ss=document.getElementById('stitchSettings');if(ss)ss.style.display='none'; // commented out for later reuse
  const svb=document.getElementById('stitchViewBar');if(svb)svb.style.display=isEXP?'flex':'none';
  if(!isEXP)galStitch=false;
  if(!isEXP){
    const lr2=document.getElementById('likeRow');if(lr2)lr2.style.display='none';
    document.getElementById('remixesSection').style.display='none';
    const tcc=document.getElementById('tileCellsCtrl');if(tcc)tcc.style.display='none';
  }
  /* Stitching Order Settings — commented out for later reuse, DO NOT DELETE
  if(!isEXP){
    document.getElementById('famCanvas').onclick=null;
    document.getElementById('famCanvas').onmousedown=null;
    document.getElementById('famCanvas').onmousemove=null;
    document.getElementById('famCanvas').onmouseup=null;
  }
  */
  cv.style.cursor='';
  if(isGen){
    showGenUI(true);
    refreshGen(true);
    return;
  }
  showGenUI(false);
  // Track pattern opens (fires after GoatCounter loads; silently skipped if not configured)
  if(window.goatcounter?.count) window.goatcounter.count({path:'pattern/'+pat.id,title:pat.name||pat.id,event:true});

  if(isEXP){
    _galResetRouting();   // routing test switcher is per-view, reset on every load
    _tileCells=Math.max(1,Math.min(12,tilesForPatMacro(pat)));
    const lbl=document.getElementById('tileCellsVal');if(lbl)lbl.textContent=_tileCells+'×'+_tileCells;
    const effPat={...pat,patMacro:patMacroForTiles(pat,_tileCells)};
    setupExpCanvas(effPat);
    // Freeze the reference scale at the pattern's natural tile count, so the stitch count
    // per line is invariant under the gallery tile-count picker (stepTileCells).
    EXP_szRef=computeExpLayout({...pat,patMacro:pat.patMacro||3}).sz;
    const expLay=computeExpLayout(effPat);
    EXP_path=filterVisiblePath(_expPathForView(effPat),expLay);
    TOTAL=EXP_path.length; PASSES=[];
    const tcc=document.getElementById('tileCellsCtrl');if(tcc)tcc.style.display='';
    const tcv=document.getElementById('tileCellsVal');if(tcv)tcv.textContent=_tileCells+'×'+_tileCells;
    document.getElementById('animTitle').innerHTML=_displayName(pat.name||'Custom')+'<span class="jp">'+(pat.gridType==='isometric'?'Isometric':'Square')+' · DIY</span>';
    document.getElementById('animTip').textContent='';
    // Like/remix bar
    const lr=document.getElementById('likeRow');
    if(lr){lr.dataset.id=pat.id;renderLikeButtons(pat.id);lr.style.display='flex';}
    renderRemixes(pat);
    /* Stitching Order Settings — commented out for later reuse, DO NOT DELETE
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
    */
    _famToggles={};
    // Stitch view is the standard (and only) view for custom patterns now.
    galStitch=true;
    galStitchLen=pat.stitchLen||8;
    galStitchRatio=pat.stitchRatio||'standard';
    galStitchGrid=!!pat.stitchGrid;
    galDraft=false;_galDraftCache=null;
    galThreadColors={}; galActiveFam=0;   // thread-colour preview resets per pattern
    _galStitchCache=null;
    syncGalStitchUI();
    step=TOTAL;if(playing)pause();
    buildJumpBar();render(step);
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
  if(_zoom<=1){_panX=0;_panY=0;return;}
  const ch=EXP_canvasH||SIZE;
  const minVis=60;
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
    const nz=Math.max(1,Math.min(_zoom*delta,8));
    if(nz===_zoom)return;
    // Zoom centered on current view (respects pan)
    const ch=EXP_canvasH||SIZE;
    const vcx=SIZE/2, vcy=ch/2; // visual center of container
    const lcx=(vcx-_panX)/_zoom, lcy=(vcy-_panY)/_zoom; // local point at visual center
    _zoom=nz;
    _panX=vcx-lcx*_zoom;
    _panY=vcy-lcy*_zoom;
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

