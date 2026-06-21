// ── CAD Engine ──────────────────────────────────────────────────────────────
let cadLines=[],cadFamilies=[],cadHistory=[],cadTool='draw',cadEditId=null;
let cadGridType='isometric',cadMacro=3,cadPatMacro=5;
const CAD_MICRO=10;
const CAD_DPR=Math.min(window.devicePixelRatio||1,2);
const CAD_COS30=Math.cos(Math.PI/6),CAD_SIN30=Math.sin(Math.PI/6);
const CAD_SIZE=500;
let cadZoom=1,cadPanX=0,cadPanY=0,cadPanning=false,cadPanStart={x:0,y:0};
let cadBase=1,cadTileSize,cadOX,cadOY;
let cadPTile,cadPOX,cadPOY;
let cadDrawing=false,cadStart=null,cadCur=null,cadHover=null;
let cadArcState=0,cadArcCenter=null,cadArcStart=null; // arc tool state
let cadLeftBuf=null,cadRightBuf=null;
let cadInited=false;

function cadApplyView(){
  cadTileSize=cadBase*cadZoom;
  const tc=Math.ceil(cadMacro*CAD_MICRO);
  const half=CAD_SIZE/2;
  if(cadGridType==='isometric'){
    cadOX=half+cadPanX;
    cadOY=(CAD_SIZE-(tc*2*cadTileSize*CAD_SIN30))/2+cadPanY;
  }else{cadOX=(CAD_SIZE-tc*cadTileSize)/2+cadPanX;cadOY=(CAD_SIZE-tc*cadTileSize)/2+cadPanY;}
}
function cadG2S(u,v,ox,oy,sz){
  if(cadGridType==='isometric')return{x:ox+(u-v)*sz*CAD_COS30,y:oy+(u+v)*sz*CAD_SIN30};
  return{x:ox+u*sz,y:oy+v*sz};
}
function cadS2G(x,y,ox,oy,sz){
  if(cadGridType==='isometric'){const dx=(x-ox)/(sz*CAD_COS30),dy=(y-oy)/(sz*CAD_SIN30);return{u:(dy+dx)/2,v:(dy-dx)/2};}
  return{u:(x-ox)/sz,v:(y-oy)/sz};
}
function cadSnapPoint(ru,rv){
  const SNAP=0.8;let best=null,bd=SNAP;
  const tc=cadMacro*CAD_MICRO;
  cadLines.forEach(l=>{
    let d=Math.hypot(l.start[0]-ru,l.start[1]-rv);if(d<bd){bd=d;best=[l.start[0],l.start[1]];}
    d=Math.hypot(l.end[0]-ru,l.end[1]-rv);if(d<bd){bd=d;best=[l.end[0],l.end[1]];}
  });
  if(best)return best;
  return[Math.max(0,Math.min(tc,Math.round(ru))),Math.max(0,Math.min(tc,Math.round(rv)))];
}
function cadDistToSeg(p,a,b){
  const l2=(b[0]-a[0])**2+(b[1]-a[1])**2;
  if(l2===0)return{dist:Math.hypot(p[0]-a[0],p[1]-a[1]),t:0};
  let t=((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/l2;
  t=Math.max(0,Math.min(1,t));
  return{dist:Math.hypot(p[0]-a[0]-t*(b[0]-a[0]),p[1]-a[1]-t*(b[1]-a[1])),t};
}
function cadLineInter(p1,p2,p3,p4){
  const s1u=p2[0]-p1[0],s1v=p2[1]-p1[1],s2u=p4[0]-p3[0],s2v=p4[1]-p3[1];
  const d=-s2u*s1v+s1u*s2v;
  if(Math.abs(d)<0.0001)return null;
  const s=(-s1v*(p1[0]-p3[0])+s1u*(p1[1]-p3[1]))/d;
  let t=(s2u*(p1[1]-p3[1])-s2v*(p1[0]-p3[0]))/d;
  if(s>=-0.001&&s<=1.001&&t>=-0.001&&t<=1.001){t=Math.max(0,Math.min(1,t));return[p1[0]+t*s1u,p1[1]+t*s1v,t];}
  return null;
}
function cadHoveredSeg(ru,rv){
  const THRESH=15/cadTileSize;let best=null,bd=THRESH,li=-1,bt=0;
  cadLines.forEach((l,i)=>{const r=cadDistToSeg([ru,rv],l.start,l.end);if(r.dist<bd){bd=r.dist;best=l;bt=r.t;li=i;}});
  if(!best)return null;
  let pts=[{t:0,u:best.start[0],v:best.start[1]},{t:1,u:best.end[0],v:best.end[1]}];
  cadLines.forEach((l,i)=>{if(i===li)return;const ix=cadLineInter(best.start,best.end,l.start,l.end);if(ix)pts.push({t:ix[2],u:ix[0],v:ix[1]});});
  pts.sort((a,b)=>a.t-b.t);
  const up=[pts[0]];for(let i=1;i<pts.length;i++)if(pts[i].t-up[up.length-1].t>0.005)up.push(pts[i]);
  for(let i=0;i<up.length-1;i++)if(bt>=up[i].t-0.005&&bt<=up[i+1].t+0.005)return{li,start:up[i],end:up[i+1],all:up,ci:i};
  return null;
}
function cadBBox(){
  if(!cadLines.length)return null;
  let mnu=Infinity,mxu=-Infinity,mnv=Infinity,mxv=-Infinity;
  cadLines.forEach(l=>{mnu=Math.min(mnu,l.start[0],l.end[0]);mxu=Math.max(mxu,l.start[0],l.end[0]);mnv=Math.min(mnv,l.start[1],l.end[1]);mxv=Math.max(mxv,l.start[1],l.end[1]);});
  return{minU:mnu,maxU:mxu,minV:mnv,maxV:mxv};
}
function cadBBox2(lines){
  if(!lines.length)return null;
  let mnu=Infinity,mxu=-Infinity,mnv=Infinity,mxv=-Infinity;
  lines.forEach(l=>{mnu=Math.min(mnu,l.start[0],l.end[0]);mxu=Math.max(mxu,l.start[0],l.end[0]);mnv=Math.min(mnv,l.start[1],l.end[1]);mxv=Math.max(mxv,l.start[1],l.end[1]);});
  return{minU:mnu,maxU:mxu,minV:mnv,maxV:mxv};
}

// Find redundant lines (collinear overlaps >90%)
function cadFindRedundant(){
  const Q=1e-4, PERP_THRESH=0.5; const redundant=new Set();
  for(let i=0;i<cadLines.length;i++){
    const a=cadLines[i];
    const dxA=a.end[0]-a.start[0], dyA=a.end[1]-a.start[1];
    const lenA=Math.hypot(dxA,dyA); if(lenA<Q)continue;
    const ndxA=dxA/lenA, ndyA=dyA/lenA;
    for(let j=i+1;j<cadLines.length;j++){
      const b=cadLines[j];
      const dxB=b.end[0]-b.start[0], dyB=b.end[1]-b.start[1];
      const lenB=Math.hypot(dxB,dyB); if(lenB<Q)continue;
      const dot=ndxA*(dxB/lenB)+ndyA*(dyB/lenB);
      if(Math.abs(Math.abs(dot)-1)>Q)continue;
      function perpDist(p){return Math.abs((p[0]-a.start[0])*ndyA-(p[1]-a.start[1])*ndxA);}
      if(perpDist(b.start)>PERP_THRESH||perpDist(b.end)>PERP_THRESH)continue;
      function proj(p){return (p[0]-a.start[0])*ndxA+(p[1]-a.start[1])*ndyA;}
      let b0=proj(b.start), b1=proj(b.end);
      if(b0>b1)[b0,b1]=[b1,b0];
      const ovl=Math.min(lenA,b1)-Math.max(0,b0);
      const minLen=Math.min(lenA,lenB);
      if(ovl>minLen*0.9){redundant.add(i);redundant.add(j);}
    }
  }
  return [...redundant].sort((a,b)=>a-b);
}

// Auto-assign families for CAD lines based on screen orientation angle
function cadAutoAssign(){
  cadFamilies=new Array(cadLines.length).fill(-1);
  if(!cadLines.length)return;
  const iso=cadGridType==='isometric';
  const THRESH=5*Math.PI/180;
  const angles=cadLines.map(l=>{
    const du=l.end[0]-l.start[0], dv=l.end[1]-l.start[1];
    let dx=du, dy=dv;
    if(iso){dx=du-dv; dy=du+dv;}
    if(!dx&&!dy)return 0;
    const a=Math.atan2(dy,dx);
    return a<0?a+Math.PI:a;
  });
  function ad(a,b){let d=Math.abs(a-b);if(d>Math.PI/2)d=Math.PI-d;return d;}
  const groups=[];
  for(let i=0;i<cadLines.length;i++){
    let found=false;
    for(const g of groups){
      if(ad(angles[i],g.angle)<THRESH){g.members.push(i);found=true;break;}
    }
    if(!found)groups.push({angle:angles[i],members:[i]});
  }
  groups.sort((a,b)=>a.angle-b.angle);
  groups.forEach((g,fi)=>{g.members.forEach(i=>{cadFamilies[i]=fi;});});
}

// Arc tool: 3 clicks — center, start (sets radius), end (sets sweep).
// Click start again for full circle. Stores result as polyline segments.
function cadGenArc(center,start,end){
  const r=Math.hypot(start[0]-center[0],start[1]-center[1]);
  if(r<0.01)return[];
  const a1=Math.atan2(start[1]-center[1],start[0]-center[0]);
  const a2=Math.atan2(end[1]-center[1],end[0]-center[0]);
  let sweep=a2-a1;
  while(sweep>Math.PI)sweep-=2*Math.PI;
  while(sweep<=-Math.PI)sweep+=2*Math.PI;
  if(Math.hypot(end[0]-start[0],end[1]-start[1])<0.1)sweep=2*Math.PI; // full circle
  const segs=Math.max(3,Math.round((Math.abs(sweep)/(2*Math.PI))*30)); // max 30 segs per full circle
  const result=[];let prev=[...start];
  for(let i=1;i<=segs;i++){
    const a=a1+sweep*(i/segs);
    const next=[center[0]+r*Math.cos(a),center[1]+r*Math.sin(a)];
    result.push({start:prev,end:next});
    prev=next;
  }
  return result;
}

function cadArcLabel(){
  const labels=['Click to place center','Click to set radius','Click to set sweep (click center-start for full circle)'];
  const el=document.getElementById('cadArcHint');
  if(el)el.textContent=cadArcState<3?labels[cadArcState]:'';
}

function cadBakeLeft(){
  const cv=document.getElementById('cadCanvas');if(!cv)return;
  cadLeftBuf=document.createElement('canvas');cadLeftBuf.width=CAD_SIZE*CAD_DPR;cadLeftBuf.height=CAD_SIZE*CAD_DPR;
  const lx=cadLeftBuf.getContext('2d');lx.scale(CAD_DPR,CAD_DPR);
  const tc=cadMacro*CAD_MICRO;
  lx.fillStyle='#a0a0b8';
  for(let u=0;u<=tc;u++)for(let v=0;v<=tc;v++){
    if(u%CAD_MICRO!==0&&v%CAD_MICRO!==0){const p=cadG2S(u,v,cadOX,cadOY,cadTileSize);lx.fillRect(p.x-1.5,p.y-1.5,3,3);}
  }
  lx.lineWidth=2;lx.strokeStyle='#c5c5d5';
  for(let i=0;i<=cadMacro;i++){
    const val=i*CAD_MICRO;
    lx.beginPath();const p1=cadG2S(val,0,cadOX,cadOY,cadTileSize),p2=cadG2S(val,tc,cadOX,cadOY,cadTileSize);lx.moveTo(p1.x,p1.y);lx.lineTo(p2.x,p2.y);lx.stroke();
    lx.beginPath();const p3=cadG2S(0,val,cadOX,cadOY,cadTileSize),p4=cadG2S(tc,val,cadOX,cadOY,cadTileSize);lx.moveTo(p3.x,p3.y);lx.lineTo(p4.x,p4.y);lx.stroke();
  }
}
function cadBakeRight(){
  cadRightBuf=document.createElement('canvas');cadRightBuf.width=CAD_SIZE*CAD_DPR;cadRightBuf.height=CAD_SIZE*CAD_DPR;
  const rx=cadRightBuf.getContext('2d');rx.scale(CAD_DPR,CAD_DPR);
  rx.lineWidth=1.5;rx.strokeStyle='#3a3a4a';
  const ptc=cadPatMacro*CAD_MICRO,ov=cadPatMacro;
  for(let i=-ov;i<=cadPatMacro+ov;i++){
    const val=i*CAD_MICRO;
    rx.beginPath();const p1=cadG2S(val,-ov*CAD_MICRO,cadPOX,cadPOY,cadPTile),p2=cadG2S(val,(cadPatMacro+ov)*CAD_MICRO,cadPOX,cadPOY,cadPTile);rx.moveTo(p1.x,p1.y);rx.lineTo(p2.x,p2.y);rx.stroke();
    rx.beginPath();const p3=cadG2S(-ov*CAD_MICRO,val,cadPOX,cadPOY,cadPTile),p4=cadG2S((cadPatMacro+ov)*CAD_MICRO,val,cadPOX,cadPOY,cadPTile);rx.moveTo(p3.x,p3.y);rx.lineTo(p4.x,p4.y);rx.stroke();
  }
}

function cadDrawWorkspace(){
  const cv=document.getElementById('cadCanvas');if(!cv)return;
  const x=cv.getContext('2d');
  x.clearRect(0,0,CAD_SIZE*CAD_DPR,CAD_SIZE*CAD_DPR);
  if(cadLeftBuf)x.drawImage(cadLeftBuf,0,0);

  // Build full line list including previews
  const all=[...cadLines];
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur)all.push({start:cadStart,end:cadCur,preview:true});
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur)
    cadGenArc(cadArcCenter,cadArcStart,cadCur).forEach(l=>{l.preview=true;all.push(l);});

  const bbox=cadBBox2(all);
  if(bbox){
    x.fillStyle='rgba(255,255,255,0.08)';x.beginPath();
    const p1=cadG2S(bbox.minU,bbox.minV,cadOX,cadOY,cadTileSize),p2=cadG2S(bbox.maxU,bbox.minV,cadOX,cadOY,cadTileSize);
    const p3=cadG2S(bbox.maxU,bbox.maxV,cadOX,cadOY,cadTileSize),p4=cadG2S(bbox.minU,bbox.maxV,cadOX,cadOY,cadTileSize);
    x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.lineTo(p3.x,p3.y);x.lineTo(p4.x,p4.y);x.closePath();x.fill();
  }

  x.lineWidth=4;x.lineCap='round';
  cadLines.forEach((l,i)=>{
    const fi=cadFamilies[i];
    const col=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
    x.strokeStyle=(cadHover&&cadHover.li===i)?col+'55':col;
    const p1=cadG2S(l.start[0],l.start[1],cadOX,cadOY,cadTileSize),p2=cadG2S(l.end[0],l.end[1],cadOX,cadOY,cadTileSize);
    x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
  });

  // Mark redundant lines in red dashed
  const cadRed=cadFindRedundant();
  if(cadRed.length){
    x.strokeStyle='#ff4444';x.lineWidth=2;x.setLineDash([3,3]);
    cadRed.forEach(i=>{
      const l=cadLines[i];
      const p1=cadG2S(l.start[0],l.start[1],cadOX,cadOY,cadTileSize),p2=cadG2S(l.end[0],l.end[1],cadOX,cadOY,cadTileSize);
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
    });
    x.setLineDash([]);
  }

  // Draw tool preview
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur){
    const p1=cadG2S(cadStart[0],cadStart[1],cadOX,cadOY,cadTileSize),p2=cadG2S(cadCur[0],cadCur[1],cadOX,cadOY,cadTileSize);
    x.strokeStyle='rgba(0,255,204,0.5)';x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
  }

  // Arc tool visuals
  if(cadTool==='arc'){
    if(cadArcState===1&&cadArcCenter&&cadCur){
      // dashed radius line from center to cursor
      const pc=cadG2S(cadArcCenter[0],cadArcCenter[1],cadOX,cadOY,cadTileSize);
      const pm=cadG2S(cadCur[0],cadCur[1],cadOX,cadOY,cadTileSize);
      x.strokeStyle='rgba(255,204,0,0.6)';x.setLineDash([5,5]);
      x.beginPath();x.moveTo(pc.x,pc.y);x.lineTo(pm.x,pm.y);x.stroke();
      x.setLineDash([]);
    }else if(cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur){
      // arc preview + guide dashes
      const arcSegs=cadGenArc(cadArcCenter,cadArcStart,cadCur);
      x.strokeStyle='rgba(0,255,204,0.5)';x.lineWidth=3;
      x.beginPath();
      arcSegs.forEach((l,idx)=>{
        const p1=cadG2S(l.start[0],l.start[1],cadOX,cadOY,cadTileSize);
        const p2=cadG2S(l.end[0],l.end[1],cadOX,cadOY,cadTileSize);
        if(idx===0)x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);
      });
      x.stroke();
      const pc=cadG2S(cadArcCenter[0],cadArcCenter[1],cadOX,cadOY,cadTileSize);
      const ps=cadG2S(cadArcStart[0],cadArcStart[1],cadOX,cadOY,cadTileSize);
      const pe=cadG2S(cadCur[0],cadCur[1],cadOX,cadOY,cadTileSize);
      x.strokeStyle='rgba(255,204,0,0.4)';x.setLineDash([5,5]);x.lineWidth=1;
      x.beginPath();x.moveTo(pc.x,pc.y);x.lineTo(ps.x,ps.y);x.stroke();
      x.beginPath();x.moveTo(pc.x,pc.y);x.lineTo(pe.x,pe.y);x.stroke();
      x.setLineDash([]);
    }
  }

  if(cadTool==='erase'&&cadHover){
    const p1=cadG2S(cadHover.start.u,cadHover.start.v,cadOX,cadOY,cadTileSize),p2=cadG2S(cadHover.end.u,cadHover.end.v,cadOX,cadOY,cadTileSize);
    x.lineWidth=4;x.strokeStyle='#ff3366';x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
  }
  if((cadTool==='draw'||cadTool==='arc')&&cadCur){
    const s=cadG2S(cadCur[0],cadCur[1],cadOX,cadOY,cadTileSize);
    x.fillStyle='#00ffcc';x.beginPath();x.arc(s.x,s.y,6,0,Math.PI*2);x.fill();
  }
  if(cadTool==='arc'&&cadArcCenter){
    const pc=cadG2S(cadArcCenter[0],cadArcCenter[1],cadOX,cadOY,cadTileSize);
    x.fillStyle='rgba(255,204,0,0.8)';x.beginPath();x.arc(pc.x,pc.y,5,0,Math.PI*2);x.fill();
  }
  if(cadTool==='arc'&&cadArcStart){
    const ps=cadG2S(cadArcStart[0],cadArcStart[1],cadOX,cadOY,cadTileSize);
    x.fillStyle='rgba(0,255,204,0.8)';x.beginPath();x.arc(ps.x,ps.y,5,0,Math.PI*2);x.fill();
  }
}

function cadDrawPattern(){
  const pv=document.getElementById('patCanvas');if(!pv)return;
  const x=pv.getContext('2d');
  x.clearRect(0,0,CAD_SIZE*CAD_DPR,CAD_SIZE*CAD_DPR);
  if(cadRightBuf)x.drawImage(cadRightBuf,0,0);
  const all=[...cadLines];
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur)all.push({start:cadStart,end:cadCur,preview:true});
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur)
    cadGenArc(cadArcCenter,cadArcStart,cadCur).forEach(l=>{l.preview=true;all.push(l);});
  const bbox=cadBBox2(all);if(!bbox)return;
  const dU=Math.max(bbox.maxU-bbox.minU,4),dV=Math.max(bbox.maxV-bbox.minV,4);
  const ptc=cadPatMacro*CAD_MICRO,ov=ptc;
  x.lineWidth=2.5;x.lineCap='round';
  for(let ou=-ov;ou<=ptc+ov;ou+=dU){for(let ov2=-ov;ov2<=ptc+ov;ov2+=dV){
    all.forEach((l,li)=>{
      if(l.preview)return;
      const u1=l.start[0]-bbox.minU+ou,v1=l.start[1]-bbox.minV+ov2;
      const u2=l.end[0]-bbox.minU+ou,v2=l.end[1]-bbox.minV+ov2;
      const p1=cadG2S(u1,v1,cadPOX,cadPOY,cadPTile),p2=cadG2S(u2,v2,cadPOX,cadPOY,cadPTile);
      if((p1.x>-50&&p1.x<550&&p1.y>-50&&p1.y<550)||(p2.x>-50&&p2.x<550&&p2.y>-50&&p2.y<550)){
        const fi=cadFamilies[li];
        x.strokeStyle=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
        x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
      }
    });
  }}
}
function cadUpdateAll(){
  cadAutoAssign();
  cadDrawWorkspace();cadDrawPattern();
  // Update redundancy hint
  const el=document.getElementById('cadArcHint');
  if(el){
    const red=cadFindRedundant();
    if(red.length && cadTool!=='arc')el.innerHTML='<span style=\"color:#ff5555\">'+red.length+' redundant line'+(red.length>1?'s':'')+' (red dashed) — excluded when saving</span>';
    else if(cadTool!=='arc')el.textContent='';
  }
}
window.cadUpdateSettings=function(){
  cadGridType=document.getElementById('cadGridType').value;
  cadMacro=parseInt(document.getElementById('cadGridSize').value);
  cadPatMacro=parseInt(document.getElementById('cadPatSize').value);
  cadZoom=1;cadPanX=0;cadPanY=0;
  const tc=cadMacro*CAD_MICRO,ptc=cadPatMacro*CAD_MICRO;
  const half=CAD_SIZE/2;
  if(cadGridType==='isometric'){
    cadBase=(CAD_SIZE-40)/(2*tc*CAD_COS30);
    cadPTile=CAD_SIZE/(2*ptc*CAD_COS30);cadPOX=half;cadPOY=(CAD_SIZE-(ptc*2*cadPTile*CAD_SIN30))/2;
  }else{
    cadBase=(CAD_SIZE-40)/tc;
    cadPTile=CAD_SIZE/ptc;cadPOX=0;cadPOY=0;
  }
  cadApplyView();cadBakeLeft();cadBakeRight();cadUpdateAll();
};
window.cadSetTool=function(t){
  cadTool=t;
  document.getElementById('cadBtnDraw').classList.toggle('on',t==='draw');
  document.getElementById('cadBtnArc').classList.toggle('on',t==='arc');
  document.getElementById('cadBtnErase').classList.toggle('on',t==='erase');
  cadDrawing=false;cadStart=null;cadHover=null;
  cadArcState=0;cadArcCenter=null;cadArcStart=null;
  cadArcLabel();cadUpdateAll();
};
window.cadUndo=function(){if(cadHistory.length){cadLines=cadHistory.pop();cadUpdateAll();}};
window.cadClear=function(){if(cadLines.length){cadHistory.push(JSON.parse(JSON.stringify(cadLines)));cadLines=[];cadUpdateAll();}};
window.cadResetView=function(){cadZoom=1;cadPanX=0;cadPanY=0;cadApplyView();cadBakeLeft();cadUpdateAll();};
window.cadSaveToLibrary=function(){
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim()||'Custom Pattern';
  // Filter out redundant lines
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>({start:[parseFloat((l.start[0]-bbox.minU).toFixed(3)),parseFloat((l.start[1]-bbox.minV).toFixed(3))],end:[parseFloat((l.end[0]-bbox.minU).toFixed(3)),parseFloat((l.end[1]-bbox.minV).toFixed(3))]}));
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  const pat={name,type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,thumbnail,createdAt:Date.now()};
  const wasEdit=!!cadEditId;
  if(cadEditId){
    // Update existing pattern — preserve families if line count unchanged
    const idx=EXP_PATTERNS.findIndex(p=>p.id===cadEditId);
    if(idx>=0){
      pat.id=cadEditId;
      pat.createdAt=EXP_PATTERNS[idx].createdAt;
      pat.published=EXP_PATTERNS[idx].published;
      const oldFams=EXP_PATTERNS[idx].families||[];
      if(oldFams.length===pat.lines.length)pat.families=oldFams;
      else autoAssignFamilies(pat);
      EXP_PATTERNS[idx]=pat;
    }else{pat.id='exp_'+Date.now();pat.families=[...cadFamilies];EXP_PATTERNS.unshift(pat);}
  }else{
    pat.id='exp_'+Date.now();
    pat.families=[...cadFamilies];
    EXP_PATTERNS.unshift(pat);
  }
  _saveLocal();
  if(_firebaseReady)_pushToFirestore(pat);
  rebuildExpGallery();
  const btn=document.getElementById('cadSaveBtn');
  btn.textContent=wasEdit?'✓ Updated!':'✓ Saved!';btn.style.background='#1a5c28';
  setTimeout(()=>{btn.textContent='⊕ Save to Library';btn.style.background='';},2000);
};
window.cadPreviewAnim=function(){
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim()||'Custom Pattern';
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>({start:[parseFloat((l.start[0]-bbox.minU).toFixed(3)),parseFloat((l.start[1]-bbox.minV).toFixed(3))],end:[parseFloat((l.end[0]-bbox.minU).toFixed(3)),parseFloat((l.end[1]-bbox.minV).toFixed(3))]}));
  const pat={id:'preview_'+Date.now(),name,type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro};
  pat.families=[...cadFamilies];
  document.getElementById('cadView').classList.remove('open');
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
};
function cadGetPos(e,cv){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*CAD_SIZE/r.width,y:(e.clientY-r.top)*CAD_SIZE/r.height};}
function cadInit(){
  if(cadInited)return;cadInited=true;
  const cv=document.getElementById('cadCanvas');
  cv.width=CAD_SIZE*CAD_DPR;cv.height=CAD_SIZE*CAD_DPR;
  cv.style.width=CAD_SIZE+'px';cv.style.height=CAD_SIZE+'px';
  cv.getContext('2d').scale(CAD_DPR,CAD_DPR);
  const pv=document.getElementById('patCanvas');
  pv.width=CAD_SIZE*CAD_DPR;pv.height=CAD_SIZE*CAD_DPR;
  pv.style.width=CAD_SIZE+'px';pv.style.height=CAD_SIZE+'px';
  pv.getContext('2d').scale(CAD_DPR,CAD_DPR);
  cadUpdateSettings();
  cv.addEventListener('contextmenu',e=>e.preventDefault());
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const pos=cadGetPos(e,cv);
    const delta=e.deltaY>0?0.9:1.1;
    let nz=Math.max(0.2,Math.min(cadZoom*delta,10));
    if(nz===cadZoom)return;
    const ratio=nz/cadZoom;
    const tc=cadMacro*CAD_MICRO;
    const half=CAD_SIZE/2;
    if(cadGridType==='isometric'){const dx=half,dy=(CAD_SIZE-(tc*2*(cadBase*nz)*CAD_SIN30))/2;cadPanX=pos.x-(pos.x-cadOX)*ratio-dx;cadPanY=pos.y-(pos.y-cadOY)*ratio-dy;}
    else{const dx=(CAD_SIZE-tc*(cadBase*nz))/2,dy=(CAD_SIZE-tc*(cadBase*nz))/2;cadPanX=pos.x-(pos.x-cadOX)*ratio-dx;cadPanY=pos.y-(pos.y-cadOY)*ratio-dy;}
    cadZoom=nz;cadApplyView();cadBakeLeft();cadUpdateAll();
  },{passive:false});
  cv.addEventListener('pointerdown',e=>{
    cv.setPointerCapture(e.pointerId);
    const pos=cadGetPos(e,cv);
    if(e.button===1||e.button===2){cadPanning=true;cadPanStart=pos;cv.style.cursor='grabbing';return;}
    const g=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
    cadCur=cadSnapPoint(g.u,g.v);
    if(cadTool==='draw'){cadDrawing=true;cadStart=[cadCur[0],cadCur[1]];}
    else if(cadTool==='arc'){
      if(cadArcState===0){cadArcCenter=[...cadCur];cadArcState=1;}
      else if(cadArcState===1){cadArcStart=[...cadCur];cadArcState=2;}
      else if(cadArcState===2){
        cadHistory.push(JSON.parse(JSON.stringify(cadLines)));
        cadGenArc(cadArcCenter,cadArcStart,cadCur).forEach(l=>cadLines.push(l));
        cadArcState=0;cadArcCenter=null;cadArcStart=null;
      }
      cadArcLabel();
    }
    else if(cadTool==='erase'&&cadHover){
      cadHistory.push(JSON.parse(JSON.stringify(cadLines)));
      cadLines.splice(cadHover.li,1);
      for(let i=0;i<cadHover.all.length-1;i++)if(i!==cadHover.ci)cadLines.push({start:[cadHover.all[i].u,cadHover.all[i].v],end:[cadHover.all[i+1].u,cadHover.all[i+1].v]});
      cadHover=null;
    }
    cadUpdateAll();
  });
  cv.addEventListener('pointermove',e=>{
    const pos=cadGetPos(e,cv);
    if(cadPanning){cadPanX+=pos.x-cadPanStart.x;cadPanY+=pos.y-cadPanStart.y;cadPanStart=pos;cadApplyView();cadBakeLeft();cadUpdateAll();return;}
    const g=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
    if(cadTool==='draw'||cadTool==='arc')cadCur=cadSnapPoint(g.u,g.v);
    else{cadHover=cadHoveredSeg(g.u,g.v);cv.style.cursor=cadHover?'pointer':'default';}
    cadUpdateAll();
  });
  cv.addEventListener('pointerup',e=>{
    if(cadPanning){cadPanning=false;cv.style.cursor='crosshair';cv.releasePointerCapture(e.pointerId);return;}
    if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur){
      if(cadStart[0]!==cadCur[0]||cadStart[1]!==cadCur[1]){cadHistory.push(JSON.parse(JSON.stringify(cadLines)));cadLines.push({start:cadStart,end:cadCur});}
    }
    cadDrawing=false;cadStart=null;cv.releasePointerCapture(e.pointerId);cadUpdateAll();
  });
  cv.addEventListener('pointerleave',()=>{cadDrawing=false;cadStart=null;cadCur=null;cadHover=null;cadUpdateAll();});
  document.addEventListener('keydown',e=>{
    if(!document.getElementById('cadView').classList.contains('open'))return;
    if(e.ctrlKey&&(e.key==='z'||e.key==='Z'))cadUndo();
    if(e.key==='Escape'&&cadTool==='arc'){cadArcState=0;cadArcCenter=null;cadArcStart=null;cadArcLabel();cadUpdateAll();}
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
document.getElementById('cadView').classList.remove('open');
document.getElementById('animView').classList.remove('open');
document.getElementById('myPatsView').classList.remove('open');
document.getElementById('galleryView').style.display='block';
initGenUI();
initAnimZoom();
loadExpPatterns();
buildGallery();
// Deep-link: open pattern from URL hash (#pattern-id)
if(location.hash){
  const id=location.hash.slice(1);
  const pat=PATTERNS.find(p=>p.id===id);
  if(pat){openPattern(pat);}
  else{
    const exp=EXP_PATTERNS.find(p=>p.id===id);
    if(exp)openExpPattern(exp);
  }
}
