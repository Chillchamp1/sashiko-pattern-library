// ── CAD Engine ──────────────────────────────────────────────────────────────
let cadLines=[],cadFamilies=[],cadHistory=[],cadTool='draw',cadEditId=null;
let cadRemixOf=null,cadIsPublished=false;
let cadGridType='isometric',cadMacro=3,cadPatMacro=3,cadSpacing=0,cadBBoxRotated=false,cadRoutingMode='default';
let cadFamSel=-1,cadFamsLocked=false,cadFamOrder=[];
let cadTraditional=false;
let cadThumbCells=0;
const CAD_MICRO=10;
const CAD_COS30=Math.cos(Math.PI/6),CAD_SIN30=Math.sin(Math.PI/6);
let cadZoom=1,cadPanX=0,cadPanY=0,cadPanning=false,cadPanStart={x:0,y:0};
let cadBase=1,cadTileSize,cadOX,cadOY;
let cadPTile,cadPOX,cadPOY;
let cadDrawing=false,cadStart=null,cadCur=null,cadHover=null;
let cadRecolorOn=false;  // recolor paint mode
let cadArcState=0,cadArcCenter=null,cadArcStart=null; // arc tool state
let cadLeftBuf=null,cadRightBuf=null;
let cadInited=false;

// ── Realistic stitch view (indigo denim + off-white yarn) ────────────────────
let cadStitchView=false;        // toggle: false = coloured family view, true = stitch view
let cadStitchGrid=false;        // overlay the fabric grid in stitch view
let cadStitchLen=8;             // visible stitch length in patCanvas px
let cadStitchRatio='standard';  // key into CAD_STITCH_RATIOS (stitch : pause)
let _cadSpeedV=82;              // tile-play speed (shares _speedTotal with the gallery)
let _cadStitchCache=null;       // {sig, stitches} — recomputed only when sig changes
let _cadDenimBuf=null;          // baked denim background (500×500)
// Stitch : pause (gap) ratios. Traditional sashiko keeps the gap ≈ 1/3 the stitch
// length ("Standard" 3:1); other common looks offered below.
const CAD_STITCH_RATIOS={
  standard:{s:3,g:1},  // gap = 1/3 stitch (traditional default)
  even:    {s:1,g:1},  // stitch = gap
  relaxed: {s:2,g:1},  // gap = 1/2 stitch
  long:    {s:3,g:2},  // gap = 2/3 stitch
};
const CAD_STITCH_CORNER=35*Math.PI/180;  // turn angle that counts as a corner (curve vertices ≈6° don't)
const CAD_DENIM='#27406e', CAD_YARN='#efe7d0';

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
    if(l.arc){
      let d=Math.hypot(l.start[0]-ru,l.start[1]-rv);if(d<bd){bd=d;best=[l.start[0],l.start[1]];}
      d=Math.hypot(l.end[0]-ru,l.end[1]-rv);if(d<bd){bd=d;best=[l.end[0],l.end[1]];}
    }else{
      let d=Math.hypot(l.start[0]-ru,l.start[1]-rv);if(d<bd){bd=d;best=[l.start[0],l.start[1]];}
      d=Math.hypot(l.end[0]-ru,l.end[1]-rv);if(d<bd){bd=d;best=[l.end[0],l.end[1]];}
    }
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

// Distance from point p to an arc curve. Returns {dist, angle} where angle is
// the radian parameter along the arc (in [a1,a2] for positive sweep / [a2,a1] for negative).
function cadDistToArc(p, arc){
  const dx=p[0]-arc.center[0], dy=p[1]-arc.center[1];
  let ang=Math.atan2(dy,dx);
  if(ang<0)ang+=2*Math.PI;
  if(ang>=2*Math.PI)ang-=2*Math.PI;
  let a1=arc.a1, a2=arc.a2;
  // Normalise a1,a2 into [0,2*PI) so distance comparsions work correctly
  if(a1<0)a1+=2*Math.PI; if(a1>=2*Math.PI)a1-=2*Math.PI;
  if(a2<0)a2+=2*Math.PI; if(a2>=2*Math.PI)a2-=2*Math.PI;
  if(a2>=a1){
    if(a2-a1>=2*Math.PI-0.001)return{dist:Math.abs(Math.hypot(dx,dy)-arc.r), angle:ang};
    if(ang>=a1-0.001&&ang<=a2+0.001){
      const px=arc.center[0]+arc.r*Math.cos(ang), py=arc.center[1]+arc.r*Math.sin(ang);
      return{dist:Math.hypot(p[0]-px,p[1]-py), angle:ang};
    }
  }else{
    // CW sweep (a1>a2 after normalisation): arc covers [a1,2*PI) ∪ [0,a2]
    if(ang>=a1-0.001||ang<=a2+0.001){
      const px=arc.center[0]+arc.r*Math.cos(ang), py=arc.center[1]+arc.r*Math.sin(ang);
      return{dist:Math.hypot(p[0]-px,p[1]-py), angle:ang};
    }
  }
  // Outside — measure circular distance to both endpoints, pick closer
  const dA=Math.min(Math.abs(ang-a1),2*Math.PI-Math.abs(ang-a1));
  const dB=Math.min(Math.abs(ang-a2),2*Math.PI-Math.abs(ang-a2));
  const best=dA<=dB?a1:a2;
  const px=arc.center[0]+arc.r*Math.cos(best), py=arc.center[1]+arc.r*Math.sin(best);
  return{dist:Math.hypot(p[0]-px,p[1]-py), angle:best};
}

// Normalise an angle into the sweep interval [a1,a2]. Returns null if outside.
function cadAngleInArc(a, arc){
  const a1=arc.a1, a2=arc.a2;
  if(a2>=a1){
    if(a2-a1>=2*Math.PI-0.001)return a;
    let aa=a;
    if(aa<a1)aa+=2*Math.PI;
    if(aa>a2)aa-=2*Math.PI;
    if(aa<a1-0.001)aa+=2*Math.PI;
    return(aa>=a1-0.001&&aa<=a2+0.001)?aa:null;
  }else{
    let aa=a;
    if(aa>a1)aa-=2*Math.PI;
    if(aa<a2)aa+=2*Math.PI;
    if(aa>a1+0.001)aa-=2*Math.PI;
    return(aa<=a1+0.001&&aa>=a2-0.001)?aa:null;
  }
}

// Intersect a line segment (p1→p2) with an arc. Returns array of {p:[u,v], t:lineParam, angle:arcAngle}.
function cadLineArcIntersections(p1,p2,arc){
  const cx=arc.center[0], cy=arc.center[1], r=arc.r;
  const dx=p2[0]-p1[0], dy=p2[1]-p1[1];
  const fx=p1[0]-cx, fy=p1[1]-cy;
  const a=dx*dx+dy*dy, b=2*(fx*dx+fy*dy), c=fx*fx+fy*fy-r*r;
  const disc=b*b-4*a*c;
  if(disc<0)return[];
  const result=[];
  const sqrtD=Math.sqrt(disc);
  for(const t of [(-b-sqrtD)/(2*a),(-b+sqrtD)/(2*a)]){
    if(t>0.001&&t<0.999){
      const px=p1[0]+t*dx, py=p1[1]+t*dy;
      const ang=Math.atan2(py-cy,px-cx);
      if(cadAngleInArc(ang,arc)!==null)result.push({p:[px,py],t,angle:ang});
    }
  }
  // Deduplicate close points
  if(result.length>1&&Math.hypot(result[0].p[0]-result[1].p[0],result[0].p[1]-result[1].p[1])<0.01)result.length=1;
  return result;
}

// Intersect two arcs. Returns array of {p:[u,v], angleA, angleB}.
function cadArcArcIntersections(arcA, arcB){
  const cx1=arcA.center[0], cy1=arcA.center[1], r1=arcA.r;
  const cx2=arcB.center[0], cy2=arcB.center[1], r2=arcB.r;
  const dx=cx2-cx1, dy=cy2-cy1;
  const d=Math.hypot(dx,dy);
  if(d<0.001||d>r1+r2+0.001||d<Math.abs(r1-r2)-0.001)return[];
  const a=(r1*r1-r2*r2+d*d)/(2*d);
  const h=Math.sqrt(Math.max(0,r1*r1-a*a));
  const px=cx1+a*dx/d, py=cy1+a*dy/d;
  const result=[];
  for(const sign of [-1,1]){
    const ix=px+sign*h*(-dy/d), iy=py+sign*h*(dx/d);
    const angA=Math.atan2(iy-cy1,ix-cx1);
    const angB=Math.atan2(iy-cy2,ix-cx2);
    if(cadAngleInArc(angA,arcA)!==null&&cadAngleInArc(angB,arcB)!==null)
      result.push({p:[ix,iy], angleA:angA, angleB:angB});
  }
  if(result.length>1&&Math.hypot(result[0].p[0]-result[1].p[0],result[0].p[1]-result[1].p[1])<0.01)result.length=1;
  return result;
}

function cadHoveredSeg(ru,rv){
  const THRESH=15/cadTileSize;let best=null,bd=THRESH,li=-1,bt=0;
  const interiorDist=(l,ang)=>{
    const a1=l.a1, a2=l.a2;
    if(a2>=a1){if(ang>a1+0.01&&ang<a2-0.01)return 0;return Math.min(Math.abs(ang-a1),Math.abs(ang-a2));}
    else{if(ang<a1-0.01||ang>a2+0.01)return 0;return Math.min(Math.abs(ang-a1),Math.abs(ang-a2));}
  };
  cadLines.forEach((l,i)=>{
    if(l.arc){
      const r=cadDistToArc([ru,rv],l);
      if(r.dist<bd-1e-6){bd=r.dist;best=l;bt=r.angle;li=i;}
      else if(Math.abs(r.dist-bd)<1e-6&&best&&best.arc){
        // Tiebreaker: prefer the arc containing the angle in its interior
        if(interiorDist(l,r.angle)<interiorDist(best,bt)){best=l;bt=r.angle;li=i;}
      }
    }else{
      const r=cadDistToSeg([ru,rv],l.start,l.end);
      if(r.dist<bd){bd=r.dist;best=l;bt=r.t;li=i;}
    }
  });
  if(!best)return null;
  if(best.arc){
    // Build breakpoints along the arc from intersections with other lines/arcs
    const a1=best.a1, a2=best.a2;
    const sweepDir=a2>=a1?1:-1;
    const totalSweep=Math.abs(a2-a1)||2*Math.PI;
    // Convert angle to sweep parameter t ∈ [0,1] along the arc from a1 to a2
    const toSweep=a=>{
      let d=sweepDir>0?a-a1:a1-a;
      if(d<0)d+=2*Math.PI;
      if(d>=2*Math.PI)d-=2*Math.PI;
      return Math.max(0,Math.min(1,d/totalSweep));
    };
    let pts=[{t:toSweep(best.a1),u:best.start[0],v:best.start[1]},
             {t:toSweep(best.a2)||1,u:best.end[0],v:best.end[1]}];
    cadLines.forEach((l,i)=>{
      if(i===li)return;
      let ixs;
      if(l.arc)ixs=cadArcArcIntersections(best,l);
      else ixs=cadLineArcIntersections(l.start,l.end,best);
      ixs.forEach(ix=>{
        const ang=ix.angleA!==undefined?ix.angleA:ix.angle;
        pts.push({t:toSweep(ang),u:ix.p[0],v:ix.p[1]});
      });
    });
    // Sort by t (sweep parameter) and deduplicate
    pts.sort((a,b)=>a.t-b.t);
    const up=[pts[0]];for(let i=1;i<pts.length;i++)if(pts[i].t-up[up.length-1].t>0.001)up.push(pts[i]);
    // Compute hover t parameter
    const bt2=toSweep(bt);
    for(let i=0;i<up.length-1;i++)if(bt2>=up[i].t-0.005&&bt2<=up[i+1].t+0.005)return{li,start:up[i],end:up[i+1],all:up,ci:i,isArc:true,arcData:best};
    return null;
  }
  let pts=[{t:0,u:best.start[0],v:best.start[1]},{t:1,u:best.end[0],v:best.end[1]}];
  cadLines.forEach((l,i)=>{
    if(i===li)return;
    if(l.arc){
      cadLineArcIntersections(best.start,best.end,l).forEach(ix=>pts.push({t:ix.t,u:ix.p[0],v:ix.p[1]}));
    }else{
      const ix=cadLineInter(best.start,best.end,l.start,l.end);
      if(ix)pts.push({t:ix[2],u:ix[0],v:ix[1]});
    }
  });
  pts.sort((a,b)=>a.t-b.t);
  const up=[pts[0]];for(let i=1;i<pts.length;i++)if(pts[i].t-up[up.length-1].t>0.005)up.push(pts[i]);
  for(let i=0;i<up.length-1;i++)if(bt>=up[i].t-0.005&&bt<=up[i+1].t+0.005)return{li,start:up[i],end:up[i+1],all:up,ci:i};
  return null;
}

function cadBBox(){
  if(!cadLines.length)return null;
  let mnu=Infinity,mxu=-Infinity,mnv=Infinity,mxv=-Infinity;
  cadLines.forEach(l=>{
    if(l.arc){
      const cx=l.center[0], cy=l.center[1], r=l.r;
      mnu=Math.min(mnu,l.start[0],l.end[0]); mxu=Math.max(mxu,l.start[0],l.end[0]);
      mnv=Math.min(mnv,l.start[1],l.end[1]); mxv=Math.max(mxv,l.start[1],l.end[1]);
      for(const a of [0, Math.PI/2, Math.PI, 3*Math.PI/2]){
        if(cadAngleInArc(a,l)!==null){mnu=Math.min(mnu,cx+r*Math.cos(a));mxu=Math.max(mxu,cx+r*Math.cos(a));mnv=Math.min(mnv,cy+r*Math.sin(a));mxv=Math.max(mxv,cy+r*Math.sin(a));}
      }
      for(const a of [l.a1,l.a2]){
        mnu=Math.min(mnu,cx+r*Math.cos(a));mxu=Math.max(mxu,cx+r*Math.cos(a));mnv=Math.min(mnv,cy+r*Math.sin(a));mxv=Math.max(mxv,cy+r*Math.sin(a));
      }
    }else{
      mnu=Math.min(mnu,l.start[0],l.end[0]);mxu=Math.max(mxu,l.start[0],l.end[0]);
      mnv=Math.min(mnv,l.start[1],l.end[1]);mxv=Math.max(mxv,l.start[1],l.end[1]);
    }
  });
  return{minU:mnu,maxU:mxu,minV:mnv,maxV:mxv};
}
function cadBBox2(lines){
  if(!lines.length)return null;
  let mnu=Infinity,mxu=-Infinity,mnv=Infinity,mxv=-Infinity;
  lines.forEach(l=>{
    if(l.arc){
      const cx=l.center[0], cy=l.center[1], r=l.r;
      mnu=Math.min(mnu,l.start[0],l.end[0]); mxu=Math.max(mxu,l.start[0],l.end[0]);
      mnv=Math.min(mnv,l.start[1],l.end[1]); mxv=Math.max(mxv,l.start[1],l.end[1]);
      for(const a of [0, Math.PI/2, Math.PI, 3*Math.PI/2])if(cadAngleInArc(a,l)!==null){
        mnu=Math.min(mnu,cx+r*Math.cos(a));mxu=Math.max(mxu,cx+r*Math.cos(a));
        mnv=Math.min(mnv,cy+r*Math.sin(a));mxv=Math.max(mxv,cy+r*Math.sin(a));
      }
      for(const a of [l.a1,l.a2]){
        mnu=Math.min(mnu,cx+r*Math.cos(a));mxu=Math.max(mxu,cx+r*Math.cos(a));
        mnv=Math.min(mnv,cy+r*Math.sin(a));mxv=Math.max(mxv,cy+r*Math.sin(a));
      }
    }else{
      mnu=Math.min(mnu,l.start[0],l.end[0]);mxu=Math.max(mxu,l.start[0],l.end[0]);
      mnv=Math.min(mnv,l.start[1],l.end[1]);mxv=Math.max(mxv,l.start[1],l.end[1]);
    }
  });
  return{minU:mnu,maxU:mxu,minV:mnv,maxV:mxv};
}

// Find redundant lines (collinear overlaps >90%). Skips arcs.
function cadFindRedundant(){
  const Q=1e-4, PERP_THRESH=0.5; const redundant=new Set();
  for(let i=0;i<cadLines.length;i++){
    const a=cadLines[i]; if(a.arc)continue;
    const dxA=a.end[0]-a.start[0], dyA=a.end[1]-a.start[1];
    const lenA=Math.hypot(dxA,dyA); if(lenA<Q)continue;
    const ndxA=dxA/lenA, ndyA=dyA/lenA;
    for(let j=i+1;j<cadLines.length;j++){
      const b=cadLines[j]; if(b.arc)continue;
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
    while(cadFamilies.length<cadLines.length)cadFamilies.push(-1);
    if(cadFamilies.length>cadLines.length)cadFamilies.length=cadLines.length;
    const used=[...new Set(cadFamilies.filter(f=>f>=0))];
    used.forEach(f=>{if(!cadFamOrder.includes(f))cadFamOrder.push(f);});
    return;
  }
  cadFamilies=new Array(cadLines.length).fill(-1);
  if(!cadLines.length)return;
  const iso=cadGridType==='isometric';
  const THRESH=5*Math.PI/180;
  const groups=[];
  const arcIdxs=[];
  for(let i=0;i<cadLines.length;i++){if(cadLines[i].arc)arcIdxs.push(i);}
  if(arcIdxs.length)groups.push({angle:-1,members:arcIdxs});
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

// ── Arc curve helpers ──────────────────────────────────────────────────────

// Convert an arc curve to polyline segments. nSegs = segments per full circle (default 60 for rendering).
function cadFlattenArc(arc, nSegs){
  const a1=arc.a1, a2=arc.a2;
  let sweep=a2-a1;
  if(sweep>=2*Math.PI-0.001)sweep=2*Math.PI;
  else if(sweep<=-2*Math.PI+0.001)sweep=-2*Math.PI;
  const totalSweep=Math.abs(sweep);
  const segs=Math.max(2,Math.round(totalSweep/(2*Math.PI)*(nSegs||60)));
  const result=[]; let prev=[...arc.start];
  for(let i=1;i<=segs;i++){
    const a=a1+sweep*(i/segs);
    const next=[arc.center[0]+arc.r*Math.cos(a),arc.center[1]+arc.r*Math.sin(a)];
    result.push({start:prev,end:next,arc:true});
    prev=next;
  }
  return result;
}

// Make an arc curve object from centre, start, end points.
function _makeArcObj(center, start, end){
  return cadGenArc(center, start, end);
}

// Arc tool: 3 clicks — center, start (sets radius), end (sets sweep).
// Returns a single curve object (not polyline segments).
// Sweep is always the shortest path (≤180°) unless a full circle is requested.
function cadGenArc(center,start,end){
  const r=Math.hypot(start[0]-center[0],start[1]-center[1]);
  if(r<0.01)return null;
  const isCircle=Math.hypot(end[0]-start[0],end[1]-start[1])<0.1;
  if(isCircle){
    const a1=Math.atan2(start[1]-center[1],start[0]-center[0]);
    return{arc:true,center:[center[0],center[1]],r,a1,a2:a1+2*Math.PI,start:[...start],end:[...start]};
  }
  const a1=Math.atan2(start[1]-center[1],start[0]-center[0]);
  let a2=Math.atan2(end[1]-center[1],end[0]-center[0]);
  // Normalise sweep to [-PI, PI] so the arc takes the shortest path
  let sweep=a2-a1;
  while(sweep>Math.PI)sweep-=2*Math.PI;
  while(sweep<=-Math.PI)sweep+=2*Math.PI;
  a2=a1+sweep;
  return{
    arc:true,
    center:[center[0],center[1]],
    r,
    a1,
    a2,
    start:[center[0]+r*Math.cos(a1),center[1]+r*Math.sin(a1)],
    end:[center[0]+r*Math.cos(a2),center[1]+r*Math.sin(a2)]
  };
}

// Flatten all arcs in cadLines to segments (for downstream processing).
// Returns an array of segment objects {start, end, arc:true, ...}.
function cadAllSegments(lines){
  const result=[];
  (lines||cadLines).forEach(l=>{
    if(l.arc){
      cadFlattenArc(l, 60).forEach(s=>result.push(s));
    }else{
      result.push({start:[...l.start],end:[...l.end]});
    }
  });
  return result;
}

function cadArcLabel(){
  const labels=['Click to place center','Click to set radius','Click to set sweep (click center-start for full circle)'];
  const el=document.getElementById('cadArcHint');
  if(el)el.textContent=cadArcState<3?labels[cadArcState]:'';
}

// Auto-extend grid if any geometry extends beyond the current grid boundary
function cadAutoExtendGrid(){
  const bbox=cadBBox();
  if(!bbox)return;
  const tc=cadMacro*CAD_MICRO;
  const oldZoom=cadZoom, oldPanX=cadPanX, oldPanY=cadPanY;
  let changed=false;
  while(bbox.maxU>=tc||bbox.maxV>=tc||bbox.minU<=-CAD_MICRO||bbox.minV<=-CAD_MICRO){
    if(bbox.minU<-CAD_MICRO||bbox.minV<-CAD_MICRO){
      const du=bbox.minU<-CAD_MICRO?-bbox.minU+CAD_MICRO:0;
      const dv=bbox.minV<-CAD_MICRO?-bbox.minV+CAD_MICRO:0;
      cadLines=cadLines.map(l=>{
        if(l.arc){
          const nc=[l.center[0]+du,l.center[1]+dv];
          return{...l,center:nc,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]};
        }
        return{...l,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]};
      });
    }
    if(cadMacro>=6)break;
    cadMacro++;
    document.getElementById('cadGridSize').value=cadMacro;
    changed=true;
    const nb=cadBBox();if(!nb)break;
    const ntc=cadMacro*CAD_MICRO;
    if(nb.maxU<ntc&&nb.maxV<ntc&&nb.minU>=-CAD_MICRO&&nb.minV>=-CAD_MICRO)break;
  }
  if(changed){cadZoom=oldZoom;cadPanX=oldPanX;cadPanY=oldPanY;cadUpdateSettings();}
}

function cadBakeLeft(){
  const cv=document.getElementById('cadCanvas');if(!cv)return;
  cadLeftBuf=document.createElement('canvas');cadLeftBuf.width=500;cadLeftBuf.height=500;
  const lx=cadLeftBuf.getContext('2d');
  const tc=cadMacro*CAD_MICRO;
  lx.fillStyle='#1a3a5c';lx.fillRect(0,0,500,500);
  lx.fillStyle='rgba(160,160,184,0.25)';
  for(let u=0;u<=tc;u++)for(let v=0;v<=tc;v++){
    const onMain=(u%CAD_MICRO===0)&&(v%CAD_MICRO===0);
    const p=cadG2S(u,v,cadOX,cadOY,cadTileSize);
    lx.fillRect(p.x-(onMain?2:1),p.y-(onMain?2:1),onMain?4:2,onMain?4:2);
  }
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
  const ptc=cadPatMacro*CAD_MICRO;
  rx.fillStyle='rgba(160,160,184,0.25)';
  for(let u=0;u<=ptc;u++)for(let v=0;v<=ptc;v++){
    const onMain=(u%CAD_MICRO===0)&&(v%CAD_MICRO===0);
    const p=cadG2S(u,v,cadPOX,cadPOY,cadPTile);
    rx.fillRect(p.x-(onMain?2:1),p.y-(onMain?2:1),onMain?4:2,onMain?4:2);
  }
  rx.lineWidth=1.5;rx.strokeStyle='rgba(220,235,255,0.15)';
  for(let i=0;i<=cadPatMacro;i++){
    const val=i*CAD_MICRO;
    rx.beginPath();const p1=cadG2S(val,0,cadPOX,cadPOY,cadPTile),p2=cadG2S(val,ptc,cadPOX,cadPOY,cadPTile);rx.moveTo(p1.x,p1.y);rx.lineTo(p2.x,p2.y);rx.stroke();
    rx.beginPath();const p3=cadG2S(0,val,cadPOX,cadPOY,cadPTile),p4=cadG2S(ptc,val,cadPOX,cadPOY,cadPTile);rx.moveTo(p3.x,p3.y);rx.lineTo(p4.x,p4.y);rx.stroke();
  }
}

// Draw a single line (straight or arc) onto a canvas context at offset (ou, ov) using the given g2s transform.
function _cadDrawLine(x, l, fi, ox, oy, sz, g2s){
  const col=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
  x.strokeStyle=col;
  if(l.arc){
    // Draw arc as polyline for accurate isometric projection
    const segs=cadFlattenArc(l, 80);
    if(segs.length){
      x.beginPath();
      const p0=g2s(segs[0].start[0],segs[0].start[1]);
      x.moveTo(p0.x,p0.y);
      for(const s of segs){
        const p=g2s(s.end[0],s.end[1]);
        x.lineTo(p.x,p.y);
      }
      x.stroke();
    }
  }else{
    const p1=g2s(l.start[0],l.start[1]),p2=g2s(l.end[0],l.end[1]);
    x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
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
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur){
    const prevArc=cadGenArc(cadArcCenter,cadArcStart,cadCur);
    if(prevArc)all.push({...prevArc,preview:true});
  }

  // Work-area boundary
  {const tc=cadMacro*CAD_MICRO;
   const wa=[cadG2S(0,0,cadOX,cadOY,cadTileSize),cadG2S(tc,0,cadOX,cadOY,cadTileSize),
             cadG2S(tc,tc,cadOX,cadOY,cadTileSize),cadG2S(0,tc,cadOX,cadOY,cadTileSize)];
   x.strokeStyle='rgba(80,160,255,0.45)';x.lineWidth=1.5;x.setLineDash([7,4]);
   x.beginPath();x.moveTo(wa[0].x,wa[0].y);for(let i=1;i<4;i++)x.lineTo(wa[i].x,wa[i].y);x.closePath();x.stroke();
   x.setLineDash([]);}
  // Pattern bounding box + spacing
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
      const epts=[];cadAllSegments(cadLines).forEach(s=>epts.push(s.start,s.end));
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

  const g2s=(u,v)=>cadG2S(u,v,cadOX,cadOY,cadTileSize);
  x.lineWidth=4;x.lineCap='round';
  cadLines.forEach((l,i)=>{
    const fi=cadFamilies[i];
    const col=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
    // Cut tool: keep full colour on hovered line (red glow drawn separately below)
    const isHovered=cadHover&&cadHover.li===i;
    x.strokeStyle=isHovered&&cadTool!=='erase'?col+'55':col;
    _cadDrawLine(x, l, fi, cadOX, cadOY, cadTileSize, g2s);
  });

  // Mark redundant lines in red dashed
  const cadRed=cadFindRedundant();
  if(cadRed.length){
    x.strokeStyle='#ff4444';x.lineWidth=2;x.setLineDash([3,3]);
    cadRed.forEach(i=>{
      const l=cadLines[i];
      if(l.arc)return; // skip arcs for redundancy display
      const p1=g2s(l.start[0],l.start[1]),p2=g2s(l.end[0],l.end[1]);
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
    });
    x.setLineDash([]);
  }

  // Draw tool preview
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur){
    const p1=g2s(cadStart[0],cadStart[1]),p2=g2s(cadCur[0],cadCur[1]);
    x.strokeStyle='rgba(0,255,204,0.5)';x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
  }

  // Arc tool visuals
  if(cadTool==='arc'){
    if(cadArcState===1&&cadArcCenter&&cadCur){
      const pc=g2s(cadArcCenter[0],cadArcCenter[1]);
      const pm=g2s(cadCur[0],cadCur[1]);
      x.strokeStyle='rgba(255,204,0,0.6)';x.setLineDash([5,5]);
      x.beginPath();x.moveTo(pc.x,pc.y);x.lineTo(pm.x,pm.y);x.stroke();
      x.setLineDash([]);
    }else if(cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur){
      // Arc preview — draw as polyline for accuracy
      const prevArc=cadGenArc(cadArcCenter,cadArcStart,cadCur);
      if(prevArc){
        x.strokeStyle='rgba(0,255,204,0.5)';x.lineWidth=3;
        _cadDrawLine(x, prevArc, -1, cadOX, cadOY, cadTileSize, g2s);
      }
      const pc=g2s(cadArcCenter[0],cadArcCenter[1]);
      const ps=g2s(cadArcStart[0],cadArcStart[1]);
      const pe=g2s(cadCur[0],cadCur[1]);
      x.strokeStyle='rgba(255,204,0,0.4)';x.setLineDash([5,5]);x.lineWidth=1;
      x.beginPath();x.moveTo(pc.x,pc.y);x.lineTo(ps.x,ps.y);x.stroke();
      x.beginPath();x.moveTo(pc.x,pc.y);x.lineTo(pe.x,pe.y);x.stroke();
      x.setLineDash([]);
    }
  }

  // Cut tool highlight — bright red glow, drawn last so it sits on top
  if(cadTool==='erase'&&cadHover){
    if(cadHover.isArc){
      const arc=cadHover.arcData;
      const a1=arc.a1, a2=arc.a2;
      const totalSweep=Math.abs(a2-a1)||2*Math.PI;
      const sweepDir=a2>=a1?1:-1;
      const ci=cadHover.ci;
      const all=cadHover.all;
      if(ci>=0&&ci<all.length-1){
        const t0=all[ci].t, t1=all[ci+1].t;
        const segs=Math.max(4,Math.round(30*(t1-t0)));
        // Glow
        x.lineWidth=8;x.lineCap='round';x.strokeStyle='rgba(255,80,80,0.35)';
        x.beginPath();
        let first=true;
        for(let k=0;k<=segs;k++){
          const tk=t0+(t1-t0)*(k/segs);
          const ang=a1+sweepDir*tk*totalSweep;
          const p=g2s(arc.center[0]+arc.r*Math.cos(ang),arc.center[1]+arc.r*Math.sin(ang));
          if(first){x.moveTo(p.x,p.y);first=false;}else x.lineTo(p.x,p.y);
        }
        x.stroke();
        // Core highlight
        x.lineWidth=3;x.strokeStyle='#ff6060';
        x.beginPath();
        first=true;
        for(let k=0;k<=segs;k++){
          const tk=t0+(t1-t0)*(k/segs);
          const ang=a1+sweepDir*tk*totalSweep;
          const p=g2s(arc.center[0]+arc.r*Math.cos(ang),arc.center[1]+arc.r*Math.sin(ang));
          if(first){x.moveTo(p.x,p.y);first=false;}else x.lineTo(p.x,p.y);
        }
        x.stroke();
      }
    }else{
      const p1=g2s(cadHover.start.u,cadHover.start.v),p2=g2s(cadHover.end.u,cadHover.end.v);
      // Glow
      x.lineWidth=8;x.lineCap='round';x.strokeStyle='rgba(255,80,80,0.35)';
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
      // Core highlight
      x.lineWidth=3;x.lineCap='round';x.strokeStyle='#ff6060';
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
    }
  }
  // Recolor tool preview — blue glow on hovered line
  if(cadTool==='recolor'&&cadHover&&cadFamSel>=0){
    const col=FAM_PALETTE[cadFamOrder[cadFamSel]%FAM_PALETTE.length];
    if(cadHover.isArc){
      const arc=cadHover.arcData;
      const segs=cadFlattenArc(arc,60);
      if(segs.length){
        x.lineWidth=6;x.lineCap='round';x.strokeStyle=col+'aa';
        x.beginPath();const p0=g2s(segs[0].start[0],segs[0].start[1]);x.moveTo(p0.x,p0.y);
        for(const s of segs){const p=g2s(s.end[0],s.end[1]);x.lineTo(p.x,p.y);}
        x.stroke();
      }
    }else{
      const p1=g2s(cadHover.start.u,cadHover.start.v),p2=g2s(cadHover.end.u,cadHover.end.v);
      x.lineWidth=6;x.lineCap='round';x.strokeStyle=col+'aa';
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
    }
  }
  if((cadTool==='draw'||cadTool==='arc')&&cadCur){
    const s=g2s(cadCur[0],cadCur[1]);
    x.fillStyle='#00ffcc';x.beginPath();x.arc(s.x,s.y,6,0,Math.PI*2);x.fill();
  }
  if(cadTool==='arc'&&cadArcCenter){
    const pc=g2s(cadArcCenter[0],cadArcCenter[1]);
    x.fillStyle='rgba(255,204,0,0.8)';x.beginPath();x.arc(pc.x,pc.y,5,0,Math.PI*2);x.fill();
  }
  if(cadTool==='arc'&&cadArcStart){
    const ps=g2s(cadArcStart[0],cadArcStart[1]);
    x.fillStyle='rgba(0,255,204,0.8)';x.beginPath();x.arc(ps.x,ps.y,5,0,Math.PI*2);x.fill();
  }
}

function cadDrawPattern(){
  const pv=document.getElementById('patCanvas');if(!pv)return;
  if(cadStitchView&&!_tpOn){_cadDrawStitchStatic();return;}
  const x=pv.getContext('2d');
  x.clearRect(0,0,500,500);
  if(cadRightBuf)x.drawImage(cadRightBuf,0,0);
  const all=[...cadLines];
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur)all.push({start:cadStart,end:cadCur,preview:true});
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur){
    const prevArc=cadGenArc(cadArcCenter,cadArcStart,cadCur);
    if(prevArc)all.push({...prevArc,preview:true});
  }
  const bbox=cadBBox2(all);if(!bbox)return;
  const dU=Math.max(bbox.maxU-bbox.minU,4),dV=Math.max(bbox.maxV-bbox.minV,4);
  const stepU=dU+cadSpacing, stepV=dV+cadSpacing;
  const ptc=cadPatMacro*CAD_MICRO,ov=ptc;
  x.lineWidth=2.5;x.lineCap='round';
  const g2s=(u,v)=>cadG2S(u,v,cadPOX,cadPOY,cadPTile);
  // Check if a segment/arc is visible on the pattern canvas
  function _visible(p1,p2){
    return(p1.x>-50&&p1.x<550&&p1.y>-50&&p1.y<550)||(p2.x>-50&&p2.x<550&&p2.y>-50&&p2.y<550);
  }
  const _renderAt=(ou,ov2)=>{all.forEach((l,li)=>{
    if(l.preview)return;
    const fi=cadFamilies[li];
    if(l.arc){
      // Transform arc center into tiled position
      const tCenter=[l.center[0]-bbox.minU+ou, l.center[1]-bbox.minV+ov2];
      const tArc={arc:true,center:tCenter,r:l.r,a1:l.a1,a2:l.a2,
        start:[l.start[0]-bbox.minU+ou,l.start[1]-bbox.minV+ov2],
        end:[l.end[0]-bbox.minU+ou,l.end[1]-bbox.minV+ov2]};
      // Quick visibility check: check screen bbox of the arc
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      const segs=cadFlattenArc(tArc, 60);
      if(!segs.length)return;
      let anyVis=false;
      for(const s of segs){
        const sp=g2s(s.start[0],s.start[1]), ep=g2s(s.end[0],s.end[1]);
        if(_visible(sp,ep))anyVis=true;
      }
      if(!anyVis)return;
      x.strokeStyle=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
      x.beginPath();
      const p0=g2s(segs[0].start[0],segs[0].start[1]);x.moveTo(p0.x,p0.y);
      for(const s of segs){const p=g2s(s.end[0],s.end[1]);x.lineTo(p.x,p.y);}
      x.stroke();
    }else{
      const u1=l.start[0]-bbox.minU+ou,v1=l.start[1]-bbox.minV+ov2;
      const u2=l.end[0]-bbox.minU+ou,v2=l.end[1]-bbox.minV+ov2;
      const p1=g2s(u1,v1),p2=g2s(u2,v2);
      if(_visible(p1,p2)){
        x.strokeStyle=fi>=0?FAM_PALETTE[fi%FAM_PALETTE.length]:'#00ffcc';
        x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
      }
    }
  });};
  if(!cadBBoxRotated){
    for(let ou=-ov;ou<=ptc+ov;ou+=stepU){for(let ov2=-ov;ov2<=ptc+ov;ov2+=stepV){_renderAt(ou,ov2);}}
  }else{
    const epts=[];cadAllSegments(all.filter(l=>!l.preview)).forEach(s=>epts.push(s.start,s.end));
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
  cadUpdateThumbPreview();
  const el=document.getElementById('cadArcHint');
  if(el){
    const red=cadFindRedundant();
    if(red.length && cadTool!=='arc')el.innerHTML='<span style=\"color:#ff5555\">'+red.length+' redundant line'+(red.length>1?'s':'')+' (red dashed) — excluded when saving</span>';
    else if(cadTool!=='arc')el.textContent='';
  }
}
function cadUpdateThumbPreview(){
  const c=document.getElementById('cadThumbCanvas'); if(!c)return;
  const TDPR=Math.min(window.devicePixelRatio||1,2);
  const w=120,pw=w*TDPR; c.width=pw;c.height=pw;
  c.style.width=w+'px';c.style.height=w+'px';
  const tc=c.getContext('2d'); tc.scale(TDPR,TDPR);
  tc.fillStyle='#1a3a5c'; tc.fillRect(0,0,w,w);
  if(!cadLines.length)return;
  const bbox=cadBBox(); if(!bbox)return;
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>_cadLineToSaved(l, bbox.minU, bbox.minV));
  const cf=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  const previewPat={name:'',type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,families:cf.families,famOrder:cf.famOrder,routingMode:cadRoutingMode,bboxRotated:cadBBoxRotated,thumbCells:cadThumbCells};
  const lay=computeExpLayout(previewPat);
  const nCells=Math.round(lay.ptc/Math.max(lay.dU,lay.dV,1));
  const cells=cadThumbCells>0?cadThumbCells:nCells;
  const ts=w/SIZE*nCells/cells;
  const off=w/(2*ts)-SIZE/2;
  const zl=document.getElementById('cadThumbZoomVal');
  if(zl)zl.textContent=cadThumbCells>0?cells+'\u2009cells':(nCells+'\u2009cells (auto)');
  tc.translate(off,off); tc.scale(ts,ts);

  const origCtx=ctx;
  const sCP=curPat,sP=PASSES,sT=TOTAL,sSt=step,sPl=playing,sHM=isHM,sPL=isPL,sEX=isEXP;
  const sEXPpath=EXP_path,sEXPg2s=EXP_g2s,sEXPh=EXP_canvasH;
  ctx=tc; curPat=previewPat; playing=false;
  isEXP=true;isPL=false;isHM=false;
  try{
    EXP_g2s=lay.g2s; EXP_canvasH=lay.canvasH;
    EXP_path=buildExpPath(genTiledSegs(previewPat),previewPat.famOrder,previewPat.routingMode);
    TOTAL=EXP_path.length;
    renderExp(TOTAL);
  }catch(e){console.warn('cadThumbPreview',e);}
  ctx=origCtx;
  curPat=sCP;PASSES=sP;TOTAL=sT;step=sSt;playing=sPl;
  isHM=sHM;isPL=sPL;isEXP=sEX;
  EXP_path=sEXPpath;EXP_g2s=sEXPg2s;EXP_canvasH=sEXPh;
}
window.cadThumbZoomStep=function(dir){
  cadThumbCells=Math.max(0,cadThumbCells+dir);
  cadUpdateThumbPreview();
};
function cadBuildFamBar(){
  const c=document.getElementById('cadFamSwatches');if(!c)return;
  const pb=document.getElementById('cadPublishBtn');
  if(pb)pb.style.display=cadIsPublished?'none':'inline-block';
  const unique=[...new Set(cadFamilies.filter(f=>f>=0))].sort((a,b)=>a-b);
  if(!unique.length){c.innerHTML='';return;}
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
  const used=new Set(cadFamOrder);
  let nf=0;while(used.has(nf))nf++;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies],o:[...cadFamOrder]});
  cadFamOrder.push(nf);cadFamSel=cadFamOrder.length-1;cadFamsLocked=true;
  cadUpdateAll();
};
function _compactFamilies(families, famOrder){
  const used=[...new Set(families.filter(f=>f>=0))].sort((a,b)=>a-b);
  if(!used.length)return{families:[], famOrder:[]};
  const map={};used.forEach((of,i)=>{map[of]=i;});
  const newFam=families.map(f=>f>=0?map[f]:-1);
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
  document.getElementById('cadBtnRecolor').classList.toggle('on',t==='recolor');
  cadDrawing=false;cadStart=null;cadHover=null;
  cadArcState=0;cadArcCenter=null;cadArcStart=null;
  cadRecolorOn=false;
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
  cadLines=cadLines.map(l=>{
    if(l.arc){
      const nCenter=[l.center[0]+du,l.center[1]+dv];
      return{...l,center:nCenter,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]};
    }
    return{...l,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]};
  });
  cadUpdateAll();
};
window.cadRotate45=function(){
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
  const cu=(bbox.minU+bbox.maxU)/2, cv=(bbox.minV+bbox.maxV)/2;
  const C=Math.SQRT2/2;
  const rot=([u,v])=>[cu+(u-cu)*C-(v-cv)*C, cv+(u-cu)*C+(v-cv)*C];
  cadLines=cadLines.map(l=>{
    if(l.arc){
      const nCenter=rot(l.center);
      const nStart=rot(l.start);
      const nEnd=rot(l.end);
      // Rotation preserves the arc geometry in grid space, but angles change.
      // Recompute from center and rotated start/end.
      return _makeArcObj(nCenter, nStart, nEnd);
    }
    return{...l,start:rot(l.start),end:rot(l.end)};
  });
  const nb=cadBBox();if(!nb)return;
  const tc=cadMacro*CAD_MICRO;
  const du=(tc-(nb.maxU-nb.minU))/2-nb.minU, dv=(tc-(nb.maxV-nb.minV))/2-nb.minV;
  cadLines=cadLines.map(l=>{
    if(l.arc){
      const nCenter=[l.center[0]+du,l.center[1]+dv];
      return{...l,center:nCenter,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]};
    }
    return{...l,start:[l.start[0]+du,l.start[1]+dv],end:[l.end[0]+du,l.end[1]+dv]};
  });
  cadUpdateAll();
};

// Convert a CAD line (straight or arc) to the saved format relative to bbox.
function _cadLineToSaved(l, minU, minV){
  if(l.arc&&l.center!==undefined){
    return{
      arc:true,
      center:[parseFloat((l.center[0]-minU).toFixed(3)),parseFloat((l.center[1]-minV).toFixed(3))],
      r:parseFloat(l.r.toFixed(3)),
      a1:parseFloat(l.a1.toFixed(6)),
      a2:parseFloat(l.a2.toFixed(6)),
      start:[parseFloat((l.start[0]-minU).toFixed(3)),parseFloat((l.start[1]-minV).toFixed(3))],
      end:[parseFloat((l.end[0]-minU).toFixed(3)),parseFloat((l.end[1]-minV).toFixed(3))]
    };
  }
  return{start:[parseFloat((l.start[0]-minU).toFixed(3)),parseFloat((l.start[1]-minV).toFixed(3))],end:[parseFloat((l.end[0]-minU).toFixed(3)),parseFloat((l.end[1]-minV).toFixed(3))]};
}
function _cadLineFromSaved(l, minU, minV){
  if(l.arc&&l.center!==undefined){
    const c=[l.center[0]-minU,l.center[1]-minV];
    return{arc:true,center:c,r:l.r,a1:l.a1,a2:l.a2,start:[l.start[0]-minU,l.start[1]-minV],end:[l.end[0]-minU,l.end[1]-minV]};
  }
  return{start:[l.start[0]-minU,l.start[1]-minV],end:[l.end[0]-minU,l.end[1]-minV],...(l.arc?{arc:true}:{})};
}

window.cadSaveToLibrary=function(){
  if(!cadLines.length)return;
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim()||'Custom Pattern';
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>_cadLineToSaved(l, bbox.minU, bbox.minV));
  const cf=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  const pat={name,type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,thumbnail,createdAt:Date.now(),creatorId:_getUserId(),bboxRotated:cadBBoxRotated,famOrder:cf.famOrder,traditional:cadTraditional,routingMode:cadRoutingMode,thumbCells:cadThumbCells,stitchView:cadStitchView,stitchLen:cadStitchLen,stitchRatio:cadStitchRatio,stitchGrid:cadStitchGrid};
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
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim()||'Custom Pattern';
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>_cadLineToSaved(l, bbox.minU, bbox.minV));
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  const cf2=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  let pat={name,type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,thumbnail,createdAt:Date.now(),creatorId:_getUserId(),bboxRotated:cadBBoxRotated,famOrder:cf2.famOrder,traditional:cadTraditional,routingMode:cadRoutingMode,published:true,thumbCells:cadThumbCells,stitchView:cadStitchView,stitchLen:cadStitchLen,stitchRatio:cadStitchRatio,stitchGrid:cadStitchGrid};
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
  if(cadStitchView){
    const sc=_cadStitchScene();
    if(!sc.stitches.length)return;
    _tpSts=sc.stitches;
  }else{
  const bbox=cadBBox();if(!bbox)return;
  const redSet=new Set(cadFindRedundant());
  const clean=cadLines.filter((_,i)=>!redSet.has(i));
  if(!clean.length)return;
  // Flatten arcs to segments for the tile play routing
  const lines=clean.map(l=>{
    const rel=_cadLineToSaved(l, bbox.minU, bbox.minV);
    return rel;
  });
  const pat={type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},patMacro:cadPatMacro,spacing:cadSpacing,bboxRotated:cadBBoxRotated,famOrder:[...cadFamOrder],routingMode:cadRoutingMode};
  pat.families=cadFamilies.filter((_,i)=>!redSet.has(i));
  const segs=genTiledSegs(pat);
  const fullPath=buildExpPath(segs,pat.famOrder,cadRoutingMode);
  if(!fullPath.length)return;
  const lay=computeExpLayout(pat);
  const path=filterVisiblePath(fullPath,lay);
  if(!path.length)return;
  // Only consider path points visible in canvas viewport for bounding box
  const [minGu,maxGu]=lay.uRange, [minGv,maxGv]=lay.vRange;
  let mx=Infinity,Mx=-Infinity,my=Infinity,My=-Infinity;
  path.forEach(s=>{
    if(s.start[0]<minGu-5||s.start[0]>maxGu+5||s.start[1]<minGv-5||s.start[1]>maxGv+5)return;
    const a=lay.g2s(s.start),b=lay.g2s(s.end);
    mx=Math.min(mx,a.x,b.x);Mx=Math.max(Mx,a.x,b.x);
    my=Math.min(my,a.y,b.y);My=Math.max(My,a.y,b.y);
  });
  if(!isFinite(mx)){mx=0;Mx=SIZE;my=0;My=SIZE;}
  const pw=Mx-mx||1,ph=My-my||1;
  const pad=12,sc=Math.min((500-2*pad)/pw,(500-2*pad)/ph);
  const ox=(500-pw*sc)/2-mx*sc,oy=(500-ph*sc)/2-my*sc;
  _tpSts=path.map(s=>{
    const a=lay.g2s(s.start),b=lay.g2s(s.end);
    return{fam:s.fam,x1:ox+a.x*sc,y1:oy+a.y*sc,x2:ox+b.x*sc,y2:oy+b.y*sc};
  });
  }
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
  if(cadStitchView){
    _cadDrawDenim(x);
    if(cadStitchGrid)_cadDrawStitchGrid(x,_cadStitchCache);
    const w=_cadStitchW();
    _tpSts.forEach((s,i)=>{if(i<_tpStep)_cadDrawStitch(x,s,w);});
    return;
  }
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
  if(!_tpLast)_tpLast=t;
  const tpTick=_tpSts.length>0?_speedTotal(_cadSpeedV)/_tpSts.length:40;
  const adv=Math.floor((t-_tpLast)/tpTick);
  if(adv>0){
    _tpStep+=adv;
    _tpLast+=adv*tpTick;
    _renderTileFrame();
  }
  _tpRAF=requestAnimationFrame(_tpLoop);
}
// ── Realistic stitch scene ───────────────────────────────────────────────────
function _cadStitchSig(){
  return JSON.stringify(cadLines)+'|'+cadGridType+'|'+cadPatMacro+'|'+cadSpacing+'|'+
    cadRoutingMode+'|'+cadBBoxRotated+'|'+cadFamOrder.join(',')+'|'+cadStitchLen+'|'+cadStitchRatio;
}
// Bake the indigo-denim background once (base wash + twill diagonal + speckle).
function _cadBakeDenim(){
  _cadDenimBuf=document.createElement('canvas');_cadDenimBuf.width=500;_cadDenimBuf.height=500;
  const d=_cadDenimBuf.getContext('2d');
  const g=d.createLinearGradient(0,0,0,500);
  g.addColorStop(0,'#2c4878');g.addColorStop(1,'#213a64');
  d.fillStyle=g;d.fillRect(0,0,500,500);
  // Twill weave: faint parallel diagonals
  d.lineWidth=1;
  for(let i=-500;i<500;i+=4){
    d.strokeStyle='rgba(255,255,255,0.035)';
    d.beginPath();d.moveTo(i,500);d.lineTo(i+500,0);d.stroke();
    d.strokeStyle='rgba(0,0,0,0.05)';
    d.beginPath();d.moveTo(i+1.4,500);d.lineTo(i+501.4,0);d.stroke();
  }
  // Speckle (indigo flecks / white slubs)
  for(let i=0;i<2600;i++){
    const x=Math.random()*500,y=Math.random()*500,r=Math.random()*0.9+0.2;
    d.fillStyle=Math.random()<0.5?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.07)';
    d.beginPath();d.arc(x,y,r,0,Math.PI*2);d.fill();
  }
  // Soft vignette
  const v=d.createRadialGradient(250,250,120,250,250,360);
  v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,0.22)');
  d.fillStyle=v;d.fillRect(0,0,500,500);
}
function _cadDrawDenim(x,w,h){if(!_cadDenimBuf)_cadBakeDenim();x.drawImage(_cadDenimBuf,0,0,w||500,h||500);}

// Intersection of segments a→b and c→d, INCLUDING shared endpoints/vertices (so a
// crossing that lands on a grid vertex still counts). Parallel/collinear → null.
function _segCross(a,b,c,d){
  const r0=b[0]-a[0],r1=b[1]-a[1],s0=d[0]-c[0],s1=d[1]-c[1];
  const den=r0*s1-r1*s0;
  if(Math.abs(den)<1e-9)return null;
  const t=((c[0]-a[0])*s1-(c[1]-a[1])*s0)/den;
  const u=((c[0]-a[0])*r1-(c[1]-a[1])*r0)/den;
  const E=1e-6;
  if(t>=-E&&t<=1+E&&u>=-E&&u<=1+E)return{t:Math.max(0,Math.min(1,t)),u:Math.max(0,Math.min(1,u))};
  return null;
}
// Point at arc-length `dist` along a stroke (pts + cumulative cum).
function _ptAlong(d,dist){
  const{pts,cum}=d;
  let lo=0,hi=cum.length-1;
  while(lo<hi-1){const m=(lo+hi)>>1;if(cum[m]<=dist)lo=m;else hi=m;}
  const seg=cum[hi]-cum[lo]||1, f=(dist-cum[lo])/seg;
  return[pts[lo][0]+(pts[hi][0]-pts[lo][0])*f, pts[lo][1]+(pts[hi][1]-pts[lo][1])*f];
}
// Thread width (px) for a given stitch length.
function _stitchW(len){return Math.max(2,Math.min(6,len*0.28));}
function _cadStitchW(){return _stitchW(cadStitchLen);}
// Group a routed path (segments with `jump` flags) into continuous screen-space
// strokes. T maps a grid point [u,v] → [x,y] screen.
function _buildStrokesFromPath(path,T){
  const strokes=[];let cur=null;
  path.forEach(s=>{
    const a=T(s.start),b=T(s.end);
    if(s.jump||!cur){cur={fam:s.fam||0,pts:[a,b]};strokes.push(cur);return;}
    const last=cur.pts[cur.pts.length-1];
    if(Math.hypot(last[0]-a[0],last[1]-a[1])<0.5)cur.pts.push(b);
    else{cur={fam:s.fam||0,pts:[a,b]};strokes.push(cur);}
  });
  return strokes;
}
// Lay running stitches along each stroke (screen coords). Sashiko rules:
//  • a clear denim GAP straddles every crossing and corner — stitches never sit over
//    an intersection; the clearance is ≥ thread half-width so perpendicular threads
//    can't overlap at the crossing (the rule the original half-gap version broke).
//  • crossings are found inclusive of grid vertices (`_segCross`).
//  • round line-caps are compensated by insetting the drawn endpoints by the cap radius.
function _layStitches(strokes,L,ratioKey,w){
  const ratio=CAD_STITCH_RATIOS[ratioKey]||CAD_STITCH_RATIOS.standard;
  L=Math.max(3,L);
  const G=L*ratio.g/ratio.s, U=L+G;
  const cap=w/2;                              // round-cap radius
  const cCorner=Math.max(G/2, w/2+0.75);      // clearance reserved at a corner
  const cCross=2*cCorner;                     // crossings get TWICE the clear (no-yarn) zone
  const clearOf=t=>t==='cross'?cCross:t==='corner'?cCorner:0;
  const data=strokes.map(st=>{
    const pts=st.pts,cum=[0];
    for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
    return{pts,cum,fam:st.fam,total:cum[cum.length-1]};
  });
  const anchors=data.map(d=>[{d:0,t:'end'},{d:d.total,t:'end'}]);
  // Corners (sharp direction changes within a stroke)
  data.forEach((d,si)=>{
    for(let i=1;i<d.pts.length-1;i++){
      const a=d.pts[i-1],b=d.pts[i],c=d.pts[i+1];
      let dd=Math.abs(Math.atan2(b[1]-a[1],b[0]-a[0])-Math.atan2(c[1]-b[1],c[0]-b[0]));
      if(dd>Math.PI)dd=2*Math.PI-dd;
      if(dd>CAD_STITCH_CORNER)anchors[si].push({d:d.cum[i],t:'corner'});
    }
  });
  // Crossings between strokes (and non-adjacent self-crossings)
  const SEG=[];
  data.forEach((d,si)=>{for(let i=0;i<d.pts.length-1;i++){
    const p=d.pts[i],q=d.pts[i+1];
    SEG.push({si,idx:i,p,q,s0:d.cum[i],len:d.cum[i+1]-d.cum[i],
      x0:Math.min(p[0],q[0]),x1:Math.max(p[0],q[0]),y0:Math.min(p[1],q[1]),y1:Math.max(p[1],q[1])});
  }});
  for(let i=0;i<SEG.length;i++){const A=SEG[i];
    for(let j=i+1;j<SEG.length;j++){const B=SEG[j];
      if(A.x1<B.x0-0.5||B.x1<A.x0-0.5||A.y1<B.y0-0.5||B.y1<A.y0-0.5)continue; // bbox reject
      if(A.si===B.si&&Math.abs(A.idx-B.idx)<=1)continue;                      // skip adjacent
      const X=_segCross(A.p,A.q,B.p,B.q);if(!X)continue;
      anchors[A.si].push({d:A.s0+X.t*A.len,t:'cross'});
      anchors[B.si].push({d:B.s0+X.u*B.len,t:'cross'});
    }
  }
  const prio={end:0,corner:1,cross:2};
  const out=[];
  data.forEach((d,si)=>{
    const an=anchors[si].filter(o=>o.d>=-1e-6&&o.d<=d.total+1e-6).sort((a,b)=>a.d-b.d);
    const m=[];
    for(const o of an){
      if(m.length&&o.d-m[m.length-1].d<=1e-3){if(prio[o.t]>prio[m[m.length-1].t])m[m.length-1].t=o.t;}
      else m.push({d:o.d,t:o.t});
    }
    for(let k=0;k<m.length-1;k++){
      const A=m[k],B=m[k+1];
      const cA=clearOf(A.t), cB=clearOf(B.t);
      const S=(B.d-A.d)-cA-cB;                  // span available for stitches+interior gaps
      if(S<=0.6)continue;                        // consumed by clearance → all denim
      const n=Math.max(1,Math.round((S+G)/U));
      const k2=S/(n*ratio.s+(n-1)*ratio.g), st=ratio.s*k2, gap=ratio.g*k2;
      for(let s=0;s<n;s++){
        const ds=A.d+cA+s*(st+gap), de=ds+st;
        let P=_ptAlong(d,ds),Q=_ptAlong(d,de);
        const dx=Q[0]-P[0],dy=Q[1]-P[1],len=Math.hypot(dx,dy);
        if(len>2*cap+0.4){const ix=dx/len*cap,iy=dy/len*cap;P=[P[0]+ix,P[1]+iy];Q=[Q[0]-ix,Q[1]-iy];}
        out.push({x1:P[0],y1:P[1],x2:Q[0],y2:Q[1],fam:d.fam});
      }
    }
  });
  return out;
}
function _cadLayStitches(strokes){return _layStitches(strokes,cadStitchLen,cadStitchRatio,_cadStitchW());}
// Build (and cache) the off-white stitch list for the current geometry, fitted to the 500px canvas.
function _cadStitchScene(){
  const sig=_cadStitchSig();
  if(_cadStitchCache&&_cadStitchCache.sig===sig)return _cadStitchCache;
  const empty={sig,stitches:[]};
  const bbox=cadBBox();
  if(!cadLines.length||!bbox){return(_cadStitchCache=empty);}
  const redSet=new Set(cadFindRedundant());
  const clean=cadLines.filter((_,i)=>!redSet.has(i));
  if(!clean.length){return(_cadStitchCache=empty);}
  const lines=clean.map(l=>_cadLineToSaved(l,bbox.minU,bbox.minV));
  const pat={type:'exp',gridType:cadGridType,lines,bbox:{minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV},
    patMacro:cadPatMacro,spacing:cadSpacing,bboxRotated:cadBBoxRotated,famOrder:[...cadFamOrder],routingMode:cadRoutingMode};
  pat.families=cadFamilies.filter((_,i)=>!redSet.has(i));
  const segs=genTiledSegs(pat);
  const fullPath=buildExpPath(segs,pat.famOrder,cadRoutingMode);
  if(!fullPath.length){return(_cadStitchCache=empty);}
  const lay=computeExpLayout(pat);
  const path=filterVisiblePath(fullPath,lay);
  if(!path.length){return(_cadStitchCache=empty);}
  const[minGu,maxGu]=lay.uRange,[minGv,maxGv]=lay.vRange;
  let mx=Infinity,Mx=-Infinity,my=Infinity,My=-Infinity;
  path.forEach(s=>{
    if(s.start[0]<minGu-5||s.start[0]>maxGu+5||s.start[1]<minGv-5||s.start[1]>maxGv+5)return;
    const a=lay.g2s(s.start),b=lay.g2s(s.end);
    mx=Math.min(mx,a.x,b.x);Mx=Math.max(Mx,a.x,b.x);my=Math.min(my,a.y,b.y);My=Math.max(My,a.y,b.y);
  });
  if(!isFinite(mx)){mx=0;Mx=SIZE;my=0;My=SIZE;}
  const pw=Mx-mx||1,ph=My-my||1,pad=16,sc=Math.min((500-2*pad)/pw,(500-2*pad)/ph);
  const ox=(500-pw*sc)/2-mx*sc,oy=(500-ph*sc)/2-my*sc;
  const T=p=>{const a=lay.g2s(p);return[ox+a.x*sc,oy+a.y*sc];};
  const strokes=_buildStrokesFromPath(path,T);
  const tf={g2s:lay.g2s,ox,oy,sc};
  return(_cadStitchCache={sig,stitches:_cadLayStitches(strokes),tf,ur:lay.uRange,vr:lay.vRange});
}
// Faint fabric grid (main lines every CAD_MICRO), mapped through the stitch-scene transform.
function _cadDrawStitchGrid(x,scene){
  if(!scene||!scene.tf)return;
  const tf=scene.tf,M=CAD_MICRO;
  const[mnU,mxU]=scene.ur,[mnV,mxV]=scene.vr;
  const S=(u,v)=>{const a=tf.g2s([u,v]);return[tf.ox+a.x*tf.sc,tf.oy+a.y*tf.sc];};
  const u0=Math.floor(mnU/M)*M,u1=Math.ceil(mxU/M)*M,v0=Math.floor(mnV/M)*M,v1=Math.ceil(mxV/M)*M;
  x.strokeStyle='rgba(220,235,255,0.16)';x.lineWidth=1;
  for(let u=u0;u<=u1;u+=M){const a=S(u,v0),b=S(u,v1);x.beginPath();x.moveTo(a[0],a[1]);x.lineTo(b[0],b[1]);x.stroke();}
  for(let v=v0;v<=v1;v+=M){const a=S(u0,v),b=S(u1,v);x.beginPath();x.moveTo(a[0],a[1]);x.lineTo(b[0],b[1]);x.stroke();}
}
// Draw one sashiko stitch with a little depth (shadow + sheen). `color` overrides
// the default off-white yarn (used for the gallery thread-colour preview).
function _cadDrawStitch(x,s,w,color){
  x.lineCap='round';
  x.strokeStyle='rgba(8,16,34,0.40)';x.lineWidth=w+1.5;
  x.beginPath();x.moveTo(s.x1+0.6,s.y1+1.3);x.lineTo(s.x2+0.6,s.y2+1.3);x.stroke();
  x.strokeStyle=color||CAD_YARN;x.lineWidth=w;
  x.beginPath();x.moveTo(s.x1,s.y1);x.lineTo(s.x2,s.y2);x.stroke();
  x.strokeStyle='rgba(255,255,255,0.30)';x.lineWidth=Math.max(0.8,w*0.34);
  x.beginPath();x.moveTo(s.x1-0.4,s.y1-0.7);x.lineTo(s.x2-0.4,s.y2-0.7);x.stroke();
}
function _cadStitchW(){return Math.max(2.5,Math.min(6,cadStitchLen*0.22));}
// Render the finished stitch view (all stitches) onto the pattern canvas.
function _cadDrawStitchStatic(){
  const pv=document.getElementById('patCanvas');if(!pv)return;
  const x=pv.getContext('2d');
  x.clearRect(0,0,500,500);_cadDrawDenim(x);
  const sc=_cadStitchScene(),w=_cadStitchW();
  if(cadStitchGrid)_cadDrawStitchGrid(x,sc);
  sc.stitches.forEach(s=>_cadDrawStitch(x,s,w));
}
window.cadToggleStitchView=function(){
  if(_tpOn)_stopTilePlay();
  cadStitchView=document.getElementById('cadStitchToggle').checked;
  document.getElementById('cadStitchControls').style.display=cadStitchView?'flex':'none';
  cadDrawPattern();
};
window.cadSetStitchLen=function(v){
  cadStitchLen=parseInt(v)||16;
  const el=document.getElementById('cadStitchLenVal');if(el)el.textContent=cadStitchLen;
  _cadStitchCache=null;
  if(!_tpOn)cadDrawPattern();
};
window.cadSetStitchRatio=function(v){
  cadStitchRatio=v;_cadStitchCache=null;
  if(!_tpOn)cadDrawPattern();
};
window.cadToggleStitchGrid=function(){
  cadStitchGrid=document.getElementById('cadStitchGrid').checked;
  if(!_tpOn)cadDrawPattern();else _renderTileFrame();
};
window.cadSetSpeed=function(v){_cadSpeedV=parseInt(v)||0;};

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
      if(cadFamSel>=0){
        const hit=cadHoveredSeg(g.u,g.v);
        if(hit&&hit.li>=0&&cadFamSel<cadFamOrder.length){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadFamilies[hit.li]=cadFamOrder[cadFamSel];cadFamsLocked=true;cadUpdateAll();return;}
      }
      cadDrawing=true;cadStart=[cadCur[0],cadCur[1]];
    }
    else if(cadTool==='recolor'){
      // Paint mode: click on a line to assign selected color
      if(cadFamSel>=0&&cadFamSel<cadFamOrder.length&&cadHover&&cadHover.li>=0){
        cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
        cadFamilies[cadHover.li]=cadFamOrder[cadFamSel];
        cadFamsLocked=true;
      }
      cadUpdateAll();return;
    }
    else if(cadTool==='arc'){
      if(cadArcState===0){cadArcCenter=[...cadCur];cadArcState=1;}
      else if(cadArcState===1){cadArcStart=[...cadCur];cadArcState=2;}
      else if(cadArcState===2){
        cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
        const newArc=cadGenArc(cadArcCenter,cadArcStart,cadCur);
        if(newArc)cadLines.push(newArc);
        cadFamsLocked=false;cadFamSel=-1;
        cadArcState=0;cadArcCenter=null;cadArcStart=null;
        cadAutoExtendGrid();
      }
      cadArcLabel();
    }
    else if(cadTool==='erase'){
      // Normal erase: cut the hovered segment
      if(!cadHover)return;
      cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
      if(cadHover.isArc){
        // Erase the hovered arc sub-segment: split the arc at the segment boundaries
        const arc=cadHover.arcData;
        const li=cadHover.li;
        const ci=cadHover.ci;
        const all=cadHover.all;
        // Remove the original arc
        cadLines.splice(li,1);
        // Create sub-arcs for all pieces except the one being erased.
        // all[] is already sorted along the sweep by cadHoveredSeg; use all[i].t directly.
        const a1=arc.a1, a2=arc.a2;
        const sweepDir=a2>=a1?1:-1;
        const totalSweep=Math.abs(a2-a1)||2*Math.PI;
        for(let i=0;i<all.length-1;i++){
          if(i===ci)continue;
          const t0=all[i].t, t1=all[i+1].t;
          if(t1-t0<0.001)continue;
          const ang0=a1+sweepDir*t0*totalSweep;
          const ang1=a1+sweepDir*t1*totalSweep;
          const p0=[arc.center[0]+arc.r*Math.cos(ang0),arc.center[1]+arc.r*Math.sin(ang0)];
          const p1=[arc.center[0]+arc.r*Math.cos(ang1),arc.center[1]+arc.r*Math.sin(ang1)];
          if(Math.hypot(p1[0]-p0[0],p1[1]-p0[1])>0.005){
            cadLines.push({arc:true,center:[...arc.center],r:arc.r,a1:ang0,a2:ang1,start:p0,end:p1});
          }
        }
      }else{
        cadLines.splice(cadHover.li,1);
        for(let i=0;i<cadHover.all.length-1;i++)if(i!==cadHover.ci)cadLines.push({start:[cadHover.all[i].u,cadHover.all[i].v],end:[cadHover.all[i+1].u,cadHover.all[i+1].v]});
      }
      cadHover=null;cadFamsLocked=false;cadFamSel=-1;
    }
    cadUpdateAll();
  });
  cv.addEventListener('pointermove',e=>{
    const pos=cadGetPos(e,cv);
    if(cadPanning){cadPanX+=pos.x-cadPanStart.x;cadPanY+=pos.y-cadPanStart.y;cadPanStart=pos;cadApplyView();cadBakeLeft();cadUpdateAll();return;}
    const g=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
    if(cadTool==='draw'||cadTool==='arc')cadCur=cadSnapPoint(g.u,g.v);
    else if(cadTool==='recolor'){cadHover=cadHoveredSeg(g.u,g.v);cv.style.cursor=cadHover?'pointer':'default';}
    else{cadHover=cadHoveredSeg(g.u,g.v);cv.style.cursor=cadHover?'pointer':'default';}
    cadUpdateAll();
  });
  cv.addEventListener('pointerup',e=>{
    if(cadPanning){cadPanning=false;cv.style.cursor='crosshair';cv.releasePointerCapture(e.pointerId);return;}
    if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur){
      if(cadStart[0]!==cadCur[0]||cadStart[1]!==cadCur[1]){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadLines.push({start:cadStart,end:cadCur});cadFamsLocked=false;cadFamSel=-1;cadAutoExtendGrid();}
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
if(location.hash){
  const id=location.hash.slice(1);
  const pat=PATTERNS.find(p=>p.id===id);
  if(pat){openPattern(pat);}
  else{
    const exp=EXP_PATTERNS.find(p=>p.id===id);
    if(exp)openExpPattern(exp);
  }
}
