// ── Hitomezashi engine ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
let HM_path=[], HM_fronts=[], HM_phase_order=[];

function findSymOffset(seq,N){
  const L=seq.length;
  for(let off=0;off<L;off++){
    let ok=true;
    for(let k=0;k<N&&ok;k++)
      if(seq[(k+off+L*100)%L]!==seq[(N-1-k+off+L*100)%L]) ok=false;
    if(ok) return off;
  }
  return 0;
}

// Bake a repeating phase sequence into N explicit per-line bits, centred via the
// symmetry offset so a preset looks the same as before (used by presets only).
function seqToBits(seq,N){
  const L=seq.length, off=findSymOffset(seq,N);
  return Array.from({length:N},(_,k)=>seq[((k+off)%L+L)%L]);
}

// Back-compat wrapper for any seq-based Hitomezashi pattern (symmetric).
function buildHitomezashi(pat){
  const N=pat.n||12, b=seqToBits(pat.seq,N);
  buildHMcore(b,b);
}

// Core engine: explicit per-row (rowBits) and per-column (colBits) start phases.
function buildHMcore(rowBits,colBits){
  const N=rowBits.length;
  HM_N=N; HM_CELL=(SIZE-2*PAD)/(N-1);

  function makeH(fwd){
    const segs=[],fronts=[];
    for(let pass=0,idx=0;idx<N;idx++,pass++){
      const j=fwd?idx:N-1-idx, lp=rowBits[j];
      let cols=[]; for(let i=0;i<N-1;i++) cols.push(i);
      if(pass%2)cols.reverse();
      for(const i of cols){
        const front=((i+lp)%2===0);
        let x1=shx(i),x2=shx(i+1),y=shy(j);
        if(pass%2){const t=x1;x1=x2;x2=t;}
        if(front) fronts.push(segs.length);
        segs.push({t:front?'f':'b',phase:'H',line:j,lp,x1,y1:y,x2,y2:y});
      }
    }
    return{segs,fronts};
  }
  function makeV(fwd){
    const segs=[],fronts=[];
    for(let pass=0,idx=0;idx<N;idx++,pass++){
      const i=fwd?idx:N-1-idx, lp=colBits[i];
      let rows=[]; for(let j=0;j<N-1;j++) rows.push(j);
      if(pass%2)rows.reverse();
      for(const j of rows){
        const front=((j+lp)%2===0);
        let y1=shy(j),y2=shy(j+1),x=shx(i);
        if(pass%2){const t=y1;y1=y2;y2=t;}
        if(front) fronts.push(segs.length);
        segs.push({t:front?'f':'b',phase:'V',line:i,lp,x1:x,y1,x2:x,y2});
      }
    }
    return{segs,fronts};
  }

  // Pick the combo with the smallest jump between pass 1 end and pass 2 start
  const endOf =p=>{const s=p.segs[p.fronts[p.fronts.length-1]];return[s.x2,s.y2];};
  const startOf=p=>{const s=p.segs[p.fronts[0]];return[s.x1,s.y1];};
  const d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
  const Hf=makeH(true),Hr=makeH(false),Vf=makeV(true),Vr=makeV(false);
  const combos=[[Hf,Vf],[Hf,Vr],[Hr,Vf],[Hr,Vr],[Vf,Hf],[Vf,Hr],[Vr,Hf],[Vr,Hr]];
  let best=combos[0],bestD=Infinity;
  for(const c of combos){const dd=d2(endOf(c[0]),startOf(c[1]));if(dd<bestD){bestD=dd;best=c;}}

  HM_path=[]; HM_fronts=[];
  HM_phase_order=[best[0].segs[best[0].fronts[0]].phase, best[1].segs[best[1].fronts[0]].phase];
  for(const{segs,fronts}of best){
    const ofs=HM_path.length;
    for(const fi of fronts) HM_fronts.push(fi+ofs);
    for(const s of segs) HM_path.push(s);
  }
}

function drawHMGuide(){
  ctx.strokeStyle='rgba(220,235,255,0.07)'; ctx.lineWidth=0.5; ctx.setLineDash([]);
  for(let i=0;i<HM_N;i++){ctx.beginPath();ctx.moveTo(shx(i),shy(0));ctx.lineTo(shx(i),shy(HM_N-1));ctx.stroke();}
  for(let j=0;j<HM_N;j++){ctx.beginPath();ctx.moveTo(shx(0),shy(j));ctx.lineTo(shx(HM_N-1),shy(j));ctx.stroke();}
}
function drawHMFront(s){
  const col=s.phase==='H'?PHASE_COLORS.H[s.lp]:PHASE_COLORS.V[s.lp];
  ctx.lineCap='round'; ctx.setLineDash([]);
  ctx.strokeStyle='rgba(0,8,20,0.45)'; ctx.lineWidth=4.8;
  ctx.beginPath();ctx.moveTo(s.x1,s.y1+0.9);ctx.lineTo(s.x2,s.y2+0.9);ctx.stroke();
  ctx.strokeStyle=col; ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke();
}
function drawHMBack(s){
  ctx.strokeStyle='rgba(243,239,228,0.15)'; ctx.lineWidth=1.3;
  ctx.setLineDash([2,4]); ctx.lineCap='butt';
  ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke();
  ctx.setLineDash([]);
}
function drawNeedleAt(x,y,col){
  const g=ctx.createRadialGradient(x,y,0,x,y,16);
  g.addColorStop(0,hexA(col,0.55)); g.addColorStop(1,hexA(col,0));
  ctx.fillStyle=g; ctx.beginPath();ctx.arc(x,y,16,0,7);ctx.fill();
  ctx.fillStyle=col; ctx.beginPath();ctx.arc(x,y,3.4,0,7);ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath();ctx.arc(x-1,y-1,1.1,0,7);ctx.fill();
}
function renderHM(st){
  ctx.setLineDash([]);
  drawFabric(); drawHMGuide();
  const pos=(st===0)?-1:HM_fronts[st-1];
  for(let p=0;p<=pos;p++){const s=HM_path[p];if(s.t==='b')drawHMBack(s);}
  for(let p=0;p<=pos;p++){const s=HM_path[p];if(s.t==='f')drawHMFront(s);}
  if(pos>=0){const s=HM_path[pos];drawNeedleAt(s.x2,s.y2,s.phase==='H'?PHASE_COLORS.H[s.lp]:PHASE_COLORS.V[s.lp]);}
  updateInfoHM(st);
}
function updateInfoHM(st){
  const el=document.getElementById('info');
  if(st===0){setIdleInfo();markJump(-1);return;}
  el.classList.remove('idle'); el.onclick=null;
  const total=HM_fronts.length, si=Math.min(st,total)-1;
  const s=HM_path[HM_fronts[si]];
  const isFirst=s.phase===HM_phase_order[0];
  const col=s.phase==='H'?PHASE_COLORS.H[s.lp]:PHASE_COLORS.V[s.lp];
  const pill=`<span class="pill" style="background:${hexA(col,.18)};color:${col}"><span class="dot" style="background:${col}"></span>pass ${isFirst?'1':'2'}/2 · ${s.phase==='H'?'horizontal →':'vertical ↑'}</span>`;
  const cnt=st>=total?`<span class="muted">complete ✓</span>`:`stitch <b>${st}</b><span class="muted">/${total}</span>`;
  el.innerHTML=`${cnt} &nbsp;${pill}`;
  markJump(isFirst?0:1);
}

// ── HM thumbnail ───────────────────────────────────────────────────────────
function renderHMThumb(canvas,seq,thumbN){
  const TN=thumbN||11, TPAD=3, TS=64, TG=(TS-2*TPAD)/(TN-1);
  const TDPR=Math.min(window.devicePixelRatio||1,2);
  canvas.width=TS*TDPR; canvas.height=TS*TDPR;
  canvas.style.width='64px'; canvas.style.height='64px';
  const tc=canvas.getContext('2d'); tc.scale(TDPR,TDPR);
  tc.fillStyle='#1a3a5c'; tc.fillRect(0,0,TS,TS);
  tc.strokeStyle='rgba(220,235,255,0.06)'; tc.lineWidth=0.5;
  const tx=i=>TPAD+i*TG, ty=j=>TPAD+j*TG;
  for(let i=0;i<TN;i++){tc.beginPath();tc.moveTo(tx(i),ty(0));tc.lineTo(tx(i),ty(TN-1));tc.stroke();}
  for(let j=0;j<TN;j++){tc.beginPath();tc.moveTo(tx(0),ty(j));tc.lineTo(tx(TN-1),ty(j));tc.stroke();}
  const L=seq.length, off=findSymOffset(seq,TN);
  const ph=k=>seq[((k+off)%L+L)%L];
  const lw=Math.max(0.8,1.5*(11/TN));
  tc.lineCap='round';
  for(let j=0;j<TN;j++){const lp=ph(j);for(let i=0;i<TN-1;i++){if((i+lp)%2===0){tc.strokeStyle=PHASE_COLORS.H[lp];tc.lineWidth=lw;tc.beginPath();tc.moveTo(tx(i),ty(j));tc.lineTo(tx(i+1),ty(j));tc.stroke();}}}
  for(let i=0;i<TN;i++){const lp=ph(i);for(let j=0;j<TN-1;j++){if((j+lp)%2===0){tc.strokeStyle=PHASE_COLORS.V[lp];tc.lineWidth=lw;tc.beginPath();tc.moveTo(tx(i),ty(j));tc.lineTo(tx(i),ty(j+1));tc.stroke();}}}
}

