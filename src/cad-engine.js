// ── CAD Engine ──────────────────────────────────────────────────────────────
let cadLines=[],cadFamilies=[],cadHistory=[],cadTool='draw',cadEditId=null;
let cadRemixOf=null,cadIsPublished=false;
let cadGridType='isometric',cadMacro=3,cadPatMacro=5,cadSpacing=0,cadBBoxRotated=false,cadRoutingMode='default';
let cadFamSel=-1,cadFamsLocked=false,cadFamOrder=[];
let cadTraditional=false;
const CAD_MICRO=10;
const CAD_COS30=Math.cos(Math.PI/6),CAD_SIN30=Math.sin(Math.PI/6);
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
  if(cadGridType==='isometric'){
    cadOX=250+cadPanX;
    cadOY=(500-(tc*2*cadTileSize*CAD_SIN30))/2+cadPanY;
  }else{cadOX=(500-tc*cadTileSize)/2+cadPanX;cadOY=(500-tc*cadTileSize)/2+cadPanY;}
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
  if(cadFamsLocked){
    // Locked: only extend to match line count, new lines get no family (-1)
    while(cadFamilies.length<cadLines.length)cadFamilies.push(-1);
    if(cadFamilies.length>cadLines.length)cadFamilies.length=cadLines.length;
    // Ensure cadFamOrder includes all used families (never remove added empty ones)
    const used=[...new Set(cadFamilies.filter(f=>f>=0))];
    used.forEach(f=>{if(!cadFamOrder.includes(f))cadFamOrder.push(f);});
    return;
  }
  cadFamilies=new Array(cadLines.length).fill(-1);
  if(!cadLines.length)return;
  const iso=cadGridType==='isometric';
  const THRESH=5*Math.PI/180;
  const groups=[];
  // All arc-tagged lines share one family
  const arcIdxs=[];
  for(let i=0;i<cadLines.length;i++){if(cadLines[i].arc)arcIdxs.push(i);}
  if(arcIdxs.length)groups.push({angle:-1,members:arcIdxs});
  // Group remaining (non-arc) lines by orientation angle
  const angles=cadLines.map(l=>{
    if(l.arc)return -1;
    const du=l.end[0]-l.start[0], dv=l.end[1]-l.start[1];
    let dx=du, dy=dv;
    if(iso){dx=du-dv; dy=du+dv;}
    if(!dx&&!dy)return 0;
    const a=Math.atan2(dy,dx);
    return a<0?a+Math.PI:a;
  });
  function ad(a,b){let d=Math.abs(a-b);if(d>Math.PI/2)d=Math.PI-d;return d;}
  for(let i=0;i<cadLines.length;i++){
    if(cadLines[i].arc)continue;
    let found=false;
    for(const g of groups){
      if(g.angle<0)continue;
      if(ad(angles[i],g.angle)<THRESH){g.members.push(i);found=true;break;}
    }
    if(!found)groups.push({angle:angles[i],members:[i]});
  }
  groups.sort((a,b)=>(a.angle<0?1:b.angle<0?-1:a.angle-b.angle));
  groups.forEach((g,fi)=>{g.members.forEach(i=>{cadFamilies[i]=fi;});});
  cadFamOrder=[...Array(groups.length).keys()];
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
  if(Math.hypot(end[0]-start[0],end[1]-start[1])<0.1)sweep=2*Math.PI;
  const segs=Math.max(3,Math.round((Math.abs(sweep)/(2*Math.PI))*30));
  const result=[];let prev=[...start];
  for(let i=1;i<=segs;i++){
    const a=a1+sweep*(i/segs);
    const next=[center[0]+r*Math.cos(a),center[1]+r*Math.sin(a)];
    result.push({start:prev,end:next,arc:true});
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
  cadLeftBuf=document.createElement('canvas');cadLeftBuf.width=500;cadLeftBuf.height=500;
  const lx=cadLeftBuf.getContext('2d');
  const tc=cadMacro*CAD_MICRO;
  // Dark fabric background
  lx.fillStyle='#1a3a5c';lx.fillRect(0,0,500,500);
  // Sub-grid dots everywhere
  lx.fillStyle='rgba(160,160,184,0.25)';
  for(let u=0;u<=tc;u++)for(let v=0;v<=tc;v++){
    const onMain=(u%CAD_MICRO===0)&&(v%CAD_MICRO===0);
    const p=cadG2S(u,v,cadOX,cadOY,cadTileSize);
    lx.fillRect(p.x-(onMain?2:1),p.y-(onMain?2:1),onMain?4:2,onMain?4:2);
  }
  // Main grid lines
  lx.lineWidth=1.5;lx.strokeStyle='rgba(220,235,255,0.15)';
  for(let i=0;i<=cadMacro;i++){
    const val=i*CAD_MICRO;
    lx.beginPath();const p1=cadG2S(val,0,cadOX,cadOY,cadTileSize),p2=cadG2S(val,tc,cadOX,cadOY,cadTileSize);lx.moveTo(p1.x,p1.y);lx.lineTo(p2.x,p2.y);lx.stroke();
    lx.beginPath();const p3=cadG2S(0,val,cadOX,cadOY,cadTileSize),p4=cadG2S(tc,val,cadOX,cadOY,cadTileSize);lx.moveTo(p3.x,p3.y);lx.lineTo(p4.x,p4.y);lx.stroke();
  }
}
function cadBakeRight(){
  cadRightBuf=document.createElement('canvas');cadRightBuf.width=500;cadRightBuf.height=500;
  const rx=cadRightBuf.getContext('2d');
  rx.fillStyle='#1a3a5c';rx.fillRect(0,0,500,500);
  // Same dot-grid style as draw canvas
  const ptc=cadPatMacro*CAD_MICRO;
  rx.fillStyle='rgba(160,160,184,0.25)';
  for(let u=0;u<=ptc;u++)for(let v=0;v<=ptc;v++){
    const onMain=(u%CAD_MICRO===0)&&(v%CAD_MICRO===0);
    const p=cadG2S(u,v,cadPOX,cadPOY,cadPTile);
    rx.fillRect(p.x-(onMain?2:1),p.y-(onMain?2:1),onMain?4:2,onMain?4:2);
  }
  // Grid lines at macro steps — same style as draw canvas
  rx.lineWidth=1.5;rx.strokeStyle='rgba(220,235,255,0.15)';
  for(let i=0;i<=cadPatMacro;i++){
    const val=i*CAD_MICRO;
    rx.beginPath();const p1=cadG2S(val,0,cadPOX,cadPOY,cadPTile),p2=cadG2S(val,ptc,cadPOX,cadPOY,cadPTile);rx.moveTo(p1.x,p1.y);rx.lineTo(p2.x,p2.y);rx.stroke();
    rx.beginPath();const p3=cadG2S(0,val,cadPOX,cadPOY,cadPTile),p4=cadG2S(ptc,val,cadPOX,cadPOY,cadPTile);rx.moveTo(p3.x,p3.y);rx.lineTo(p4.x,p4.y);rx.stroke();
  }
}

function cadDrawWorkspace(){
  const cv=document.getElementById('cadCanvas');if(!cv)return;
  const x=cv.getContext('2d');
  x.clearRect(0,0,500,500);
  if(cadLeftBuf)x.drawImage(cadLeftBuf,0,0);

  // Build full line list including previews
  const all=[...cadLines];
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur)all.push({start:cadStart,end:cadCur,preview:true});
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur)
    cadGenArc(cadArcCenter,cadArcStart,cadCur).forEach(l=>{l.preview=true;all.push(l);});

  // Work-area boundary: shows the full cadMacro×cadMacro grid as a dashed blue border
  {const tc=cadMacro*CAD_MICRO;
   const wa=[cadG2S(0,0,cadOX,cadOY,cadTileSize),cadG2S(tc,0,cadOX,cadOY,cadTileSize),
             cadG2S(tc,tc,cadOX,cadOY,cadTileSize),cadG2S(0,tc,cadOX,cadOY,cadTileSize)];
   x.strokeStyle='rgba(80,160,255,0.45)';x.lineWidth=1.5;x.setLineDash([7,4]);
   x.beginPath();x.moveTo(wa[0].x,wa[0].y);for(let i=1;i<4;i++)x.lineTo(wa[i].x,wa[i].y);x.closePath();x.stroke();
   x.setLineDash([]);}
  // Pattern bounding box + spacing: show the effective repeating unit
  const bbox=cadBBox2(all);
  if(bbox){
    const dU=Math.max(bbox.maxU-bbox.minU,4),dV=Math.max(bbox.maxV-bbox.minV,4);
    const sU=dU+cadSpacing,sV=dV+cadSpacing;
    const cu=(bbox.minU+bbox.maxU)/2,cv=(bbox.minV+bbox.maxV)/2;
    x.fillStyle='rgba(255,255,255,0.06)';
    x.strokeStyle='rgba(255,240,140,0.65)';x.lineWidth=1.5;x.setLineDash([4,3]);
    x.beginPath();
    if(!cadBBoxRotated){
      const p1=cadG2S(cu-sU/2,cv-sV/2,cadOX,cadOY,cadTileSize),p2=cadG2S(cu+sU/2,cv-sV/2,cadOX,cadOY,cadTileSize);
      const p3=cadG2S(cu+sU/2,cv+sV/2,cadOX,cadOY,cadTileSize),p4=cadG2S(cu-sU/2,cv+sV/2,cadOX,cadOY,cadTileSize);
      x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.lineTo(p3.x,p3.y);x.lineTo(p4.x,p4.y);
    }else{
      // Project all endpoints onto 45°-rotated axes p=u+v, q=u-v
      const epts=[];cadLines.forEach(l=>epts.push(l.start,l.end));
      let mnP=Infinity,mxP=-Infinity,mnQ=Infinity,mxQ=-Infinity;
      epts.forEach(([u,v])=>{const p=u+v,q=u-v;if(p<mnP)mnP=p;if(p>mxP)mxP=p;if(q<mnQ)mnQ=q;if(q>mxQ)mxQ=q;});
      const sP=mxP-mnP+cadSpacing,sQ=mxQ-mnQ+cadSpacing;
      const midP=(mnP+mxP)/2,midQ=(mnQ+mxQ)/2;
      const g45=(p,q)=>cadG2S((p+q)/2,(p-q)/2,cadOX,cadOY,cadTileSize);
      const ps=[g45(midP-sP/2,midQ-sQ/2),g45(midP+sP/2,midQ-sQ/2),g45(midP+sP/2,midQ+sQ/2),g45(midP-sP/2,midQ+sQ/2)];
      x.moveTo(ps[0].x,ps[0].y);ps.slice(1).forEach(p=>x.lineTo(p.x,p.y));
    }
    x.closePath();x.fill();x.stroke();
    x.setLineDash([]);
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
  x.clearRect(0,0,500,500);
  if(cadRightBuf)x.drawImage(cadRightBuf,0,0);
  const all=[...cadLines];
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur)all.push({start:cadStart,end:cadCur,preview:true});
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur)
    cadGenArc(cadArcCenter,cadArcStart,cadCur).forEach(l=>{l.preview=true;all.push(l);});
  const bbox=cadBBox2(all);if(!bbox)return;
  const dU=Math.max(bbox.maxU-bbox.minU,4),dV=Math.max(bbox.maxV-bbox.minV,4);
  const stepU=dU+cadSpacing, stepV=dV+cadSpacing;
  const ptc=cadPatMacro*CAD_MICRO,ov=ptc;
  x.lineWidth=2.5;x.lineCap='round';
  const _renderAt=(ou,ov2)=>{all.forEach((l,li)=>{
    if(l.preview)return;
    const u1=l.start[0]-bbox.minU+ou,v1=l.start[1]-bbox.minV+ov2;
    const u2=l.end[0]-bbox.minU+ou,v2=l.end[1]-bbox.minV+ov2;
    const p1=cadG2S(u1,v1,cadPOX,cadPOY,cadPTile),p2=cadG2S(u2,v2,cadPOX,cadPOY,cadPTile);
    if((p1.x>-50&&p1.x<550&&p1.y>-50&&p1.y<550)||(p2.x>-50&&p2.x<550&&p2.y>-50&&p2.y<550)){
      const fi=cadFamilies[li];
      x.strokeStyle=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
    }
  });};
  if(!cadBBoxRotated){
    for(let ou=-ov;ou<=ptc+ov;ou+=stepU){for(let ov2=-ov;ov2<=ptc+ov;ov2+=stepV){_renderAt(ou,ov2);}}
  }else{
    const epts=[];all.forEach(l=>{if(!l.preview)epts.push(l.start,l.end);});
    let mnP=Infinity,mxP=-Infinity,mnQ=Infinity,mxQ=-Infinity;
    epts.forEach(([u,v])=>{const p=u+v,q=u-v;if(p<mnP)mnP=p;if(p>mxP)mxP=p;if(q<mnQ)mnQ=q;if(q>mxQ)mxQ=q;});
    const sP=mxP-mnP+cadSpacing,sQ=mxQ-mnQ+cadSpacing;
    const base_u=(mnP+mnQ)/2,base_v=(mnP-mnQ)/2;
    const N=Math.ceil(2*(ptc+ov)/Math.min(sP,sQ))+3;
    for(let a=-N;a<=N;a++){for(let b=-N;b<=N;b++){
      _renderAt(bbox.minU-base_u+(a*sP+b*sQ)/2, bbox.minV-base_v+(a*sP-b*sQ)/2);
    }}
  }
}
function cadUpdateAll(){
  cadAutoAssign();
  cadDrawWorkspace();cadDrawPattern();
  cadBuildFamBar();
  // Update redundancy hint
  const el=document.getElementById('cadArcHint');
  if(el){
    const red=cadFindRedundant();
    if(red.length && cadTool!=='arc')el.innerHTML='<span style=\"color:#ff5555\">'+red.length+' redundant line'+(red.length>1?'s':'')+' (red dashed) — excluded when saving</span>';
    else if(cadTool!=='arc')el.textContent='';
  }
}
function cadBuildFamBar(){
  const c=document.getElementById('cadFamSwatches');if(!c)return;
  // Update publish button visibility
  const pb=document.getElementById('cadPublishBtn');
  if(pb)pb.style.display=cadIsPublished?'none':'inline-block';
  const unique=[...new Set(cadFamilies.filter(f=>f>=0))].sort((a,b)=>a-b);
  if(!unique.length){c.innerHTML='';return;}
  // Ensure cadFamOrder includes all used families (never remove empty ones)
  const used=[...new Set(cadFamilies.filter(f=>f>=0))];
  used.forEach(f=>{if(!cadFamOrder.includes(f))cadFamOrder.push(f);});
  c.innerHTML=cadFamOrder.map((fam,pos)=>{
    const col=FAM_PALETTE[fam%FAM_PALETTE.length];
    const cls='cad-fam-swatch'+(cadFamSel===pos?' sel':'');
    return '<button class="'+cls+'" onclick="cadSelectFam('+pos+')" style="background:'+col+'" title="Family '+(fam+1)+'"></button>';
  }).join('');
}
window.cadSelectFam=function(pos){cadFamSel=cadFamSel===pos?-1:pos;cadUpdateAll();};
window.cadMoveFam=function(dir){
  if(cadFamSel<0||cadFamSel>=cadFamOrder.length)return;
  const oi=cadFamSel+dir;if(oi<0||oi>=cadFamOrder.length)return;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies],o:[...cadFamOrder]});
  [cadFamOrder[cadFamSel],cadFamOrder[oi]]=[cadFamOrder[oi],cadFamOrder[cadFamSel]];
  cadFamSel=oi;cadFamsLocked=true;
  cadUpdateAll();
};
window.cadAddFam=function(){
  // Find next available family number that's not in use
  const used=new Set(cadFamOrder);
  let nf=0;while(used.has(nf))nf++;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies],o:[...cadFamOrder]});
  cadFamOrder.push(nf);cadFamSel=cadFamOrder.length-1;cadFamsLocked=true;
  cadUpdateAll();
};
// Compact families: remove unused, renumber remaining to 0,1,2...
function _compactFamilies(families, famOrder){
  const used=[...new Set(families.filter(f=>f>=0))].sort((a,b)=>a-b);
  if(!used.length)return{families:[], famOrder:[]};
  // Build mapping: old family number → new compact number
  const map={};used.forEach((of,i)=>{map[of]=i;});
  const newFam=families.map(f=>f>=0?map[f]:-1);
  // Keep only used families in order, preserving relative sequence
  const newOrder=famOrder.filter(f=>used.includes(f)).map(f=>map[f]);
  return{families:newFam, famOrder:newOrder};
}
window.cadUpdateSettings=function(){
  cadGridType=document.getElementById('cadGridType').value;
  cadMacro=parseInt(document.getElementById('cadGridSize').value);
  cadPatMacro=parseInt(document.getElementById('cadPatSize').value);
  cadSpacing=parseInt(document.getElementById('cadSpacing').value);
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  cadZoom=1;cadPanX=0;cadPanY=0;
  const tc=cadMacro*CAD_MICRO,ptc=cadPatMacro*CAD_MICRO;
  if(cadGridType==='isometric'){
    cadBase=460/(2*tc*CAD_COS30);
    cadPTile=500/(2*ptc*CAD_COS30);cadPOX=250;cadPOY=(500-(ptc*2*cadPTile*CAD_SIN30))/2;
  }else{
    cadBase=460/tc;
    cadPTile=500/ptc;cadPOX=0;cadPOY=0;
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
window.cadUndo=function(){
  if(!cadHistory.length)return;
  const state=cadHistory.pop();
  if(state&&typeof state==='object'&&'l' in state){cadLines=state.l;cadFamilies=state.f||[];if(state.o)cadFamOrder=state.o;}
  else{cadLines=state;cadFamilies=new Array(cadLines.length).fill(-1);}
  cadFamsLocked=true;cadUpdateAll();
};
window.cadClear=function(){if(cadLines.length){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadLines=[];cadFamilies=[];cadFamsLocked=false;cadFamOrder=[];cadFamSel=-1;cadUpdateAll();}};
window.cadResetView=function(){cadZoom=1;cadPanX=0;cadPanY=0;cadApplyView();cadBakeLeft();cadUpdateAll();};
window.cadToggleBBoxRotate=function(){
  cadBBoxRotated=!cadBBoxRotated;
  const btn=document.getElementById('cadBtnBBoxRot');
  if(btn){btn.classList.toggle('on',cadBBoxRotated);btn.textContent=cadBBoxRotated?'◆ 45°':'◇ 45°';}
  cadUpdateAll();
};
window.cadUpdateTraditional=function(){cadTraditional=document.getElementById('cadTraditional').checked;};
window.cadStepSpacing=function(d){
  const el=document.getElementById('cadSpacing');
  let v=parseInt(el.value)||0;
  v=Math.max(0,Math.min(12,v+d));
  el.value=v;cadUpdateSettings();
};
window.cadStepMacro=function(d){
  const el=document.getElementById('cadGridSize');
  let v=parseInt(el.value)||3;
  v=Math.max(2,Math.min(6,v+d));
  el.value=v;cadUpdateSettings();
};
window.cadStepPatMacro=function(d){
  const el=document.getElementById('cadPatSize');
  let v=parseInt(el.value)||5;
  v=Math.max(2,Math.min(12,v+d));
  el.value=v;cadUpdateSettings();
};
window.cadMovePattern=function(du,dv){
  if(!cadLines.length)return;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies],o:[...cadFamOrder]});
  cadLines=cadLines.map(l=>({...l,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]}));
  cadUpdateAll();
};
window.cadRotate45=function(){
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
  const cu=(bbox.minU+bbox.maxU)/2, cv=(bbox.minV+bbox.maxV)/2;
  const C=Math.SQRT2/2; // cos(45°) = sin(45°)
  const rot=([u,v])=>[cu+(u-cu)*C-(v-cv)*C, cv+(u-cu)*C+(v-cv)*C];
  cadLines=cadLines.map(l=>({...l,start:rot(l.start),end:rot(l.end)}));
  // Recenter in work area after rotation (bbox grows ~√2 diagonally)
  const nb=cadBBox();if(!nb)return;
  const tc=cadMacro*CAD_MICRO;
  const du=(tc-(nb.maxU-nb.minU))/2-nb.minU, dv=(tc-(nb.maxV-nb.minV))/2-nb.minV;
  cadLines=cadLines.map(l=>({...l,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]}));
  cadUpdateAll();
};
window.cadSaveToLibrary=function(){
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim()||'Custom Pattern';
  // Filter out redundant lines
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>({start:[parseFloat((l.start[0]-bbox.minU).toFixed(3)),parseFloat((l.start[1]-bbox.minV).toFixed(3))],end:[parseFloat((l.end[0]-bbox.minU).toFixed(3)),parseFloat((l.end[1]-bbox.minV).toFixed(3))]}));
  // Compact: remove unused families, renumber used ones to 0,1,2...
  const cf=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  const pat={name,type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,thumbnail,createdAt:Date.now(),creatorId:_getUserId(),bboxRotated:cadBBoxRotated,famOrder:cf.famOrder,traditional:cadTraditional,routingMode:cadRoutingMode};
  const wasEdit=!!cadEditId;
  if(cadEditId){
    const idx=EXP_PATTERNS.findIndex(p=>p.id===cadEditId);
    if(idx>=0){
      pat.id=cadEditId;
      pat.createdAt=EXP_PATTERNS[idx].createdAt;
      pat.published=EXP_PATTERNS[idx].published;
      cadIsPublished=pat.published;
      pat.families=cf.families;
      EXP_PATTERNS[idx]=pat;
    }else{pat.id='exp_'+Date.now();pat.families=cf.families;EXP_PATTERNS.unshift(pat);}
  }else{
    pat.id='exp_'+Date.now();
    pat.families=cf.families;
    EXP_PATTERNS.unshift(pat);
  }
  if(cadRemixOf){
    pat.remixOf=cadRemixOf;
    const parent=EXP_PATTERNS.find(p=>p.id===cadRemixOf);
    if(parent){if(!parent.remixes)parent.remixes=[];if(!parent.remixes.includes(pat.id))parent.remixes.push(pat.id);}
    cadRemixOf=null;
  }
  _saveLocal();
  if(_firebaseReady)_pushToFirestore(pat);
  rebuildExpGallery();
  const btn=document.getElementById('cadSaveBtn');
  btn.textContent=wasEdit?'✓ Updated!':'✓ Saved!';btn.style.background='#1a5c28';
  setTimeout(()=>{btn.textContent='⊕ Save changes';btn.style.background='';},2000);
};
window.cadPublishToLibrary=function(){
  const pw=prompt('Admin password:');
  if(pw!=='111'){alert('Wrong password');return;}
  if(!cadLines.length){alert('No lines to publish.');return;}
  // Save first (same logic as cadSaveToLibrary)
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim()||'Custom Pattern';
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>({start:[parseFloat((l.start[0]-bbox.minU).toFixed(3)),parseFloat((l.start[1]-bbox.minV).toFixed(3))],end:[parseFloat((l.end[0]-bbox.minU).toFixed(3)),parseFloat((l.end[1]-bbox.minV).toFixed(3))]}));
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  const cf2=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  let pat={name,type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,thumbnail,createdAt:Date.now(),creatorId:_getUserId(),bboxRotated:cadBBoxRotated,famOrder:cf2.famOrder,traditional:cadTraditional,routingMode:cadRoutingMode,published:true};
  if(cadEditId){
    const idx=EXP_PATTERNS.findIndex(p=>p.id===cadEditId);
    if(idx>=0){
      pat.id=cadEditId;pat.createdAt=EXP_PATTERNS[idx].createdAt;pat.published=true;
      pat.families=cf2.families;
      EXP_PATTERNS[idx]=pat;
    }else{pat.id='exp_'+Date.now();pat.families=cf2.families;EXP_PATTERNS.unshift(pat);}
  }else{
    pat.id='exp_'+Date.now();pat.families=cf2.families;
    EXP_PATTERNS.unshift(pat);
  }
  if(cadRemixOf){
    pat.remixOf=cadRemixOf;
    const parent=EXP_PATTERNS.find(p=>p.id===cadRemixOf);
    if(parent){if(!parent.remixes)parent.remixes=[];if(!parent.remixes.includes(pat.id))parent.remixes.push(pat.id);}
    cadRemixOf=null;
  }
  _saveLocal();
  if(_firebaseReady)_pushToFirestore(pat);
  rebuildExpGallery();
  alert('Published! Visible in main gallery.');
  cadIsPublished=true;
};

// ── Tile preview play → animates inline on right canvas ──────────────────
let _tpOn=false,_tpStep=0,_tpSts=[],_tpRAF=null,_tpLast=0;
window.cadTilePlay=function(){
  if(_tpOn){_stopTilePlay();return;}
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  const redSet=new Set(cadFindRedundant());
  const clean=cadLines.filter((_,i)=>!redSet.has(i));
  if(!clean.length)return;
  const lines=clean.map(l=>({start:[l.start[0]-bbox.minU,l.start[1]-bbox.minV],end:[l.end[0]-bbox.minU,l.end[1]-bbox.minV]}));
  const pat={type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,bboxRotated:cadBBoxRotated,famOrder:[...cadFamOrder],routingMode:cadRoutingMode};
  pat.families=cadFamilies.filter((_,i)=>!redSet.has(i));
  const segs=genTiledSegs(pat);
  const path=buildExpPath(segs,pat.famOrder,cadRoutingMode);
  if(!path.length)return;
  // Convert path grid coords to screen coords for bounding box
  const lay=computeExpLayout(pat);
  let mx=Infinity,Mx=-Infinity,my=Infinity,My=-Infinity;
  path.forEach(s=>{
    const a=lay.g2s(s.start),b=lay.g2s(s.end);
    mx=Math.min(mx,a.x,b.x);Mx=Math.max(Mx,a.x,b.x);
    my=Math.min(my,a.y,b.y);My=Math.max(My,a.y,b.y);
  });
  const pw=Mx-mx||1,ph=My-my||1;
  const pad=12,sc=Math.min((500-2*pad)/pw,(500-2*pad)/ph);
  const ox=(500-pw*sc)/2-mx*sc,oy=(500-ph*sc)/2-my*sc;
  _tpSts=path.map(s=>{
    const a=lay.g2s(s.start),b=lay.g2s(s.end);
    return{fam:s.fam,x1:ox+a.x*sc,y1:oy+a.y*sc,x2:ox+b.x*sc,y2:oy+b.y*sc};
  });
  _tpStep=0;_tpOn=true;_tpLast=0;
  document.getElementById('cadBtnTilePlay').textContent='⏹ Stop';
  document.getElementById('cadBtnTilePlay').style.color='#ff8888';
  _renderTileFrame();
  _tpRAF=requestAnimationFrame(_tpLoop);
};
function _stopTilePlay(){
  _tpOn=false;
  if(_tpRAF){cancelAnimationFrame(_tpRAF);_tpRAF=null;}
  document.getElementById('cadBtnTilePlay').textContent='▶ Play';
  document.getElementById('cadBtnTilePlay').style.color='#88cc88';
  cadDrawPattern();
}
function _renderTileFrame(){
  const pv=document.getElementById('patCanvas');if(!pv||!_tpSts)return;
  const x=pv.getContext('2d');
  x.clearRect(0,0,500,500);
  if(cadRightBuf)x.drawImage(cadRightBuf,0,0);
  x.lineWidth=2.5;x.lineCap='round';
  _tpSts.forEach((s,i)=>{
    if(i>=_tpStep)return;
    x.strokeStyle=FAM_PALETTE[s.fam%FAM_PALETTE.length];
    x.beginPath();x.moveTo(s.x1,s.y1);x.lineTo(s.x2,s.y2);x.stroke();
  });
}
function _tpLoop(t){
  if(!_tpOn)return;
  if(t-_tpLast>=40){_tpLast=t;_tpStep++;_renderTileFrame();}
  _tpRAF=requestAnimationFrame(_tpLoop);
}
function cadGetPos(e,cv){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*500/r.width,y:(e.clientY-r.top)*500/r.height};}
function cadInit(){
  if(cadInited)return;cadInited=true;
  const cv=document.getElementById('cadCanvas');
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
    if(cadGridType==='isometric'){const dx=250,dy=(500-(tc*2*(cadBase*nz)*CAD_SIN30))/2;cadPanX=pos.x-(pos.x-cadOX)*ratio-dx;cadPanY=pos.y-(pos.y-cadOY)*ratio-dy;}
    else{const dx=(500-tc*(cadBase*nz))/2,dy=(500-tc*(cadBase*nz))/2;cadPanX=pos.x-(pos.x-cadOX)*ratio-dx;cadPanY=pos.y-(pos.y-cadOY)*ratio-dy;}
    cadZoom=nz;cadApplyView();cadBakeLeft();cadUpdateAll();
  },{passive:false});
  cv.addEventListener('pointerdown',e=>{
    cv.setPointerCapture(e.pointerId);
    const pos=cadGetPos(e,cv);
    if(e.button===1||e.button===2){cadPanning=true;cadPanStart=pos;cv.style.cursor='grabbing';return;}
    const g=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
    cadCur=cadSnapPoint(g.u,g.v);
    if(cadTool==='draw'){
      // Click-to-assign: if a family is selected and we hit a line, assign it
      if(cadFamSel>=0){
        const hit=cadHoveredSeg(g.u,g.v);
        if(hit&&hit.li>=0&&cadFamSel<cadFamOrder.length){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadFamilies[hit.li]=cadFamOrder[cadFamSel];cadFamsLocked=true;cadUpdateAll();return;}
      }
      cadDrawing=true;cadStart=[cadCur[0],cadCur[1]];
    }
    else if(cadTool==='arc'){
      if(cadArcState===0){cadArcCenter=[...cadCur];cadArcState=1;}
      else if(cadArcState===1){cadArcStart=[...cadCur];cadArcState=2;}
      else if(cadArcState===2){
        cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
        cadGenArc(cadArcCenter,cadArcStart,cadCur).forEach(l=>cadLines.push(l));
        cadFamsLocked=false;cadFamSel=-1;
        cadArcState=0;cadArcCenter=null;cadArcStart=null;
      }
      cadArcLabel();
    }
    else if(cadTool==='erase'&&cadHover){
      cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
      cadLines.splice(cadHover.li,1);
      for(let i=0;i<cadHover.all.length-1;i++)if(i!==cadHover.ci)cadLines.push({start:[cadHover.all[i].u,cadHover.all[i].v],end:[cadHover.all[i+1].u,cadHover.all[i+1].v]});
      cadHover=null;cadFamsLocked=false;cadFamSel=-1;
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
      if(cadStart[0]!==cadCur[0]||cadStart[1]!==cadCur[1]){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadLines.push({start:cadStart,end:cadCur});cadFamsLocked=false;cadFamSel=-1;}
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
