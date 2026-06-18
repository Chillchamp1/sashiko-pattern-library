// ── Animation state ────────────────────────────────────────────────────────
let curPat=null, PASSES=[], TOTAL=0;
let step=0, playing=false, raf=null, last=0;
let isHM=false, isPL=false, isEXP=false;
let TICK_MS=80;  // default slow (~12 stitches/sec); toggle to 40 for fast

// ── Drawing (star patterns) ────────────────────────────────────────────────
function drawFabric(){
  ctx.fillStyle=getCss('--fabric'); ctx.fillRect(0,0,SIZE,SIZE);
  ctx.strokeStyle='rgba(255,255,255,0.025)'; ctx.lineWidth=1; ctx.setLineDash([]);
  for(let y=4;y<SIZE;y+=5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(SIZE,y);ctx.stroke();}
}
function drawGuide(){
  ctx.strokeStyle='rgba(220,235,255,0.07)'; ctx.lineWidth=1;
  for(let i=0;i<N;i++){ctx.beginPath();ctx.moveTo(sx(i),sy(0));ctx.lineTo(sx(i),sy(N-1));ctx.stroke();}
  for(let j=0;j<N;j++){ctx.beginPath();ctx.moveTo(sx(0),sy(j));ctx.lineTo(sx(N-1),sy(j));ctx.stroke();}
}
function drawStitch(i,j,dir,head,col){
  const s=segPx(sx(i),sy(j),dir,G,curPat.armScale);
  if(head){ctx.strokeStyle='rgba(255,255,255,0.28)';ctx.lineWidth=8;ctx.lineCap='round';ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();}
  ctx.strokeStyle=col||getCss('--thread'); ctx.lineWidth=3.1; ctx.lineCap='round'; ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3]);ctx.stroke();
}
function frontAll(p){for(const[i,j]of p.order)drawStitch(i,j,p.dir,false,PHASE_COLORS[p.dir][getPhase(i,j,p.dir)]);}
function drawBack(p,upto){
  if(upto<2)return;
  ctx.strokeStyle='rgba(243,239,228,0.16)';ctx.lineWidth=1.4;ctx.setLineDash([2,4]);ctx.lineCap='butt';
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
    const cur=PASSES[p];drawBack(cur,local);
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
    el.innerHTML=st>=TOTAL?'<span class="muted">complete ✓</span>':`stitch <b>${st}</b><span class="muted">/${TOTAL}</span>`;
    markJump(-1);return;
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
  // Restore default square canvas if a previous exp iso pattern changed the height.
  if(Math.round(cv.height/DPR)!==SIZE){
    cv.height=SIZE*DPR; cv.style.height=SIZE+'px'; ctx.scale(DPR,DPR);
  }

  curPat=pat;
  isEXP=pat.type==='exp';
  const isGen=pat.type==='generator';
  isHM=isGen||pat.type==='hitomezashi';
  isPL=pat.type==='polyline';

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

