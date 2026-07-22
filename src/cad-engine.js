// ── CAD Engine ──────────────────────────────────────────────────────────────
let cadLines=[],cadFamilies=[],cadHistory=[],cadTool='draw',cadEditId=null;
let cadRemixOf=null,cadIsPublished=false;
let cadGridType='isometric',cadMacro=3,cadPatMacro=3,cadSpacing=0,cadBBoxRotated=false,cadRoutingMode='default';
let cadFamSel=-1,cadFamsLocked=false,cadFamOrder=[];
// Per-family routing overrides {famIdx→mode} — normally empty (whole pattern uses
// cadRoutingMode); an entry routes just that colour with a different logic.
let cadFamRouting={},cadFamRoutingOpen=false;
// Custom per-family THREAD colours (Community patterns only). cadFamColors
// {editor famIdx→hex} dyes the running stitches in the stitch view (and the gallery
// viewer); the EDITOR keeps the classic FAM_PALETTE everywhere — the assigned thread
// colour shows as a small square below each family swatch. Dormant while Community
// is unchecked. cadStitchColors = the "Coloured thread" toggle.
let cadFamColors={},cadFamColorOpen=null,cadStitchColors=false;
// Fabric preview for the CAD stitch view (Community patterns only; default = the
// classic denim). Saved with community patterns and restored on edit.
let cadFabric='indigo';
function _cadFabricId(){return cadCommunity?cadFabric:'indigo';}
let cadTraditional=false;
let cadCommunity=false,cadCommunityName='';   // "Community" flag + optional author name ("by …")
// "Embroidery" (community-only sub-flag): the drawing is a single standalone motif, never
// tiled/repeated — the Live Tiling / Play / gallery views show exactly one instance.
let cadEmbroidery=false;
// Effective tile count for every Live-Tiling surface: embroidery = always a single instance.
function _cadTiles(){return cadEmbroidery?1:cadPatMacro;}
// Natural tile count for the stitch-length reference — frozen when a pattern loads (mirrors the
// gallery's EXP_szRef). Anchoring stitch length to the layout scale at this count makes the CAD
// stitch view match the gallery (same stitch value → same look) AND keeps the per-line stitch
// count invariant to the live Tiles count.
let _cadRefMacro=3;
const CAD_MICRO=10;
const CAD_COS30=Math.cos(Math.PI/6),CAD_SIN30=Math.sin(Math.PI/6);
let cadZoom=1,cadPanX=0,cadPanY=0,cadPanning=false,cadPanStart={x:0,y:0};
// Background sketch image (session-only tracing aid — never saved with the pattern).
// Position/size live in GRID units (cadBgU/V = top-left corner, cadBgW = width), so the
// image pans/zooms with the grid and can be nudged to sit right on the dots.
let cadBgImg=null,cadBgU=0,cadBgV=0,cadBgW=10,cadBgAlpha=0.22,cadBgDrag=null;
let cadBase=1,cadTileSize,cadOX,cadOY;
let cadPTile,cadPOX,cadPOY;
// Live-Tiling span in grid units = cadPatMacro (N) copies of the drawn motif → an N×N tiling.
// Recomputed from the motif's period whenever the committed geometry / settings change.
let cadPtc=0,_cadTileSig='';
let cadDrawing=false,cadStart=null,cadCur=null,cadHover=null;
let cadRecolorOn=false;  // recolor paint mode
let cadArcState=0,cadArcCenter=null,cadArcStart=null; // arc tool state
let cadArcSweep=0,cadArcPrevAng=0; // accumulated sweep angle (state 2) + last mouse angle, for continuous sweep
let cadLeftBuf=null,cadRightBuf=null;
let cadInited=false;

// ── Realistic stitch view (indigo denim + off-white yarn) ────────────────────
let cadStitchView=false;        // toggle: false = coloured family view, true = stitch view
let cadStitchGrid=false;        // overlay the fabric grid in stitch view
let cadStitchLen=8;             // visible stitch length in patCanvas px
let cadStitchRatio='standard';  // key into CAD_STITCH_RATIOS (stitch : pause)
let _cadSpeedV=82;              // tile-play speed (shares _speedTotal with the gallery)
let _cadStitchCache=null;       // {sig, stitches} — recomputed only when sig changes
let _starHubScale=1.0;          // multiplier for star-hub keepout radius (tunable via slider)
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

// ── Isometric arc geometry ──────────────────────────────────────────────────
// The iso projection (x=(u−v)cos30, y=(u+v)sin30) turns a plain (u,v) circle into an
// ellipse, but the renderer (_isoRoundArcPts) draws every arc as a TRUE round circle of
// radius r in this "screen-shape" space (offset/scale dropped). So all arc hit-testing /
// intersection math for iso is done here — where arcs are genuine circles of radius r and
// straight lines stay straight — then mapped back to (u,v). Grid angles stay monotonic
// with screen order (the projection preserves orientation), so the returned grid `angle`
// still sorts correctly along the sweep and the erase handler reconstructs sub-arcs cleanly.
const _isoG2I=p=>[(p[0]-p[1])*CAD_COS30,(p[0]+p[1])*CAD_SIN30];
const _isoI2G=q=>[(q[1]/CAD_SIN30+q[0]/CAD_COS30)/2,(q[1]/CAD_SIN30-q[0]/CAD_COS30)/2];
const _isoSAng=a=>Math.atan2((Math.cos(a)+Math.sin(a))*CAD_SIN30,(Math.cos(a)-Math.sin(a))*CAD_COS30);
function _isoScreenSweep(arc){
  const a1=arc.a1,a2=arc.a2,uvSweep=a2-a1,full=Math.abs(uvSweep)>=2*Math.PI-0.001;
  const f1=_isoSAng(a1); let sw;
  if(full){sw=(uvSweep>=0?1:-1)*2*Math.PI;}
  else{sw=_isoSAng(a2)-f1; while(sw>Math.PI)sw-=2*Math.PI; while(sw<=-Math.PI)sw+=2*Math.PI;
       if(uvSweep>0&&sw<0)sw+=2*Math.PI; else if(uvSweep<0&&sw>0)sw-=2*Math.PI;}
  return{f1,sw};
}
function _isoFInSweep(f,f1,sw){
  if(Math.abs(sw)>=2*Math.PI-0.001)return true;
  let d=f-f1;
  if(sw>=0){while(d<-1e-9)d+=2*Math.PI;while(d>2*Math.PI)d-=2*Math.PI;return d<=sw+1e-6;}
  while(d>1e-9)d-=2*Math.PI; while(d<-2*Math.PI)d+=2*Math.PI; return d>=sw-1e-6;
}

// Distance from point p to an arc curve. Returns {dist, angle} where angle is
// the radian parameter along the arc (in [a1,a2] for positive sweep / [a2,a1] for negative).
function cadDistToArc(p, arc){
  if(cadGridType==='isometric'){
    const sc=_isoG2I(arc.center), P=_isoG2I(p);
    const dx=P[0]-sc[0], dy=P[1]-sc[1], rr=Math.hypot(dx,dy);
    const {f1,sw}=_isoScreenSweep(arc), fh=Math.atan2(dy,dx);
    if(_isoFInSweep(fh,f1,sw)){
      const uv=_isoI2G([sc[0]+arc.r*Math.cos(fh),sc[1]+arc.r*Math.sin(fh)]);
      return{dist:Math.abs(rr-arc.r), angle:Math.atan2(uv[1]-arc.center[1],uv[0]-arc.center[0])};
    }
    let bestA=arc.a1,bd=Infinity;
    for(const a of [arc.a1,arc.a2]){
      const qx=sc[0]+arc.r*Math.cos(_isoSAng(a)), qy=sc[1]+arc.r*Math.sin(_isoSAng(a));
      const d=Math.hypot(P[0]-qx,P[1]-qy); if(d<bd){bd=d;bestA=a;}
    }
    return{dist:bd, angle:bestA};
  }
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
  if(cadGridType==='isometric'){
    const sc=_isoG2I(arc.center), A=_isoG2I(p1), B=_isoG2I(p2), r=arc.r;
    const dx=B[0]-A[0], dy=B[1]-A[1], fx=A[0]-sc[0], fy=A[1]-sc[1];
    const aa=dx*dx+dy*dy, bb=2*(fx*dx+fy*dy), cc=fx*fx+fy*fy-r*r, disc=bb*bb-4*aa*cc;
    if(disc<0)return[];
    const sd=Math.sqrt(disc), {f1,sw}=_isoScreenSweep(arc), out=[];
    for(const t of [(-bb-sd)/(2*aa),(-bb+sd)/(2*aa)]){
      if(t>0.001&&t<0.999){
        const qx=A[0]+t*dx, qy=A[1]+t*dy, f=Math.atan2(qy-sc[1],qx-sc[0]);
        if(_isoFInSweep(f,f1,sw)){
          const uv=_isoI2G([qx,qy]);
          out.push({p:uv,t,angle:Math.atan2(uv[1]-arc.center[1],uv[0]-arc.center[0])});
        }
      }
    }
    if(out.length>1&&Math.hypot(out[0].p[0]-out[1].p[0],out[0].p[1]-out[1].p[1])<0.01)out.length=1;
    return out;
  }
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
  if(cadGridType==='isometric'){
    const c1=_isoG2I(arcA.center), c2=_isoG2I(arcB.center), r1=arcA.r, r2=arcB.r;
    const dx=c2[0]-c1[0], dy=c2[1]-c1[1], d=Math.hypot(dx,dy);
    if(d<0.001||d>r1+r2+0.001||d<Math.abs(r1-r2)-0.001)return[];
    const a=(r1*r1-r2*r2+d*d)/(2*d), h=Math.sqrt(Math.max(0,r1*r1-a*a));
    const px=c1[0]+a*dx/d, py=c1[1]+a*dy/d;
    const sA=_isoScreenSweep(arcA), sB=_isoScreenSweep(arcB), out=[];
    for(const sign of [-1,1]){
      const ix=px+sign*h*(-dy/d), iy=py+sign*h*(dx/d);
      const fA=Math.atan2(iy-c1[1],ix-c1[0]), fB=Math.atan2(iy-c2[1],ix-c2[0]);
      if(_isoFInSweep(fA,sA.f1,sA.sw)&&_isoFInSweep(fB,sB.f1,sB.sw)){
        const uv=_isoI2G([ix,iy]);
        out.push({p:uv,angleA:Math.atan2(uv[1]-arcA.center[1],uv[0]-arcA.center[0]),angleB:Math.atan2(uv[1]-arcB.center[1],uv[0]-arcB.center[0])});
      }
    }
    if(out.length>1&&Math.hypot(out[0].p[0]-out[1].p[0],out[0].p[1]-out[1].p[1])<0.01)out.length=1;
    return out;
  }
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
  const result=[];
  // Iso arc (full or partial) → render round (matches the tiled/gallery flatten; see _flattenArc).
  if(cadGridType==='isometric'){
    const pts=_isoRoundArcPts(arc.center, arc.r, a1, a2, segs);
    for(let i=1;i<pts.length;i++)result.push({start:pts[i-1],end:pts[i],arc:true});
    return result;
  }
  let prev=[...arc.start];
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

// Build an arc from center + start point + an explicit accumulated sweep angle (signed).
// Unlike cadGenArc (shortest path ≤180°), this lets the arc be ANY size and close a full
// circle in EITHER direction — the sweep is tracked continuously as the mouse moves in state 2.
function cadGenArcSweep(center, start, sweep){
  const r=Math.hypot(start[0]-center[0],start[1]-center[1]);
  if(r<0.01)return null;
  const a1=Math.atan2(start[1]-center[1],start[0]-center[0]);
  let sw=sweep;
  if(Math.abs(sw)>=2*Math.PI-0.12)sw=(sw>=0?1:-1)*2*Math.PI;   // swept nearly all the way → full circle
  if(Math.abs(sw)<0.02)return null;                             // no sweep yet
  const a2=a1+sw;
  return{arc:true,center:[center[0],center[1]],r,a1,a2,
    start:[center[0]+r*Math.cos(a1),center[1]+r*Math.sin(a1)],
    end:[center[0]+r*Math.cos(a2),center[1]+r*Math.sin(a2)]};
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
  const labels=['Click to place center','Click to set radius','Move to sweep the arc (either way), click to finish · all the way round = full circle'];
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
    if(cadMacro>=12)break;
    cadMacro++;
    _cadSyncGridLabel();
    changed=true;
    const nb=cadBBox();if(!nb)break;
    const ntc=cadMacro*CAD_MICRO;
    if(nb.maxU<ntc&&nb.maxV<ntc&&nb.minU>=-CAD_MICRO&&nb.minV>=-CAD_MICRO)break;
  }
  if(changed){cadZoom=oldZoom;cadPanX=oldPanX;cadPanY=oldPanY;cadUpdateSettings();}
}
// Auto-shrink grid when lines are removed (undo/clear/cut)
function cadAutoShrinkGrid(){
  const bbox=cadBBox();
  const needed=bbox?Math.max(1,Math.ceil(Math.max(bbox.maxU,bbox.maxV)/CAD_MICRO)):2;
  if(needed>=cadMacro)return;
  cadMacro=needed;
  _cadSyncGridLabel();
  cadUpdateSettings();
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
  // ptc = grid units across the tiling canvas = cadPatMacro (N) copies of the drawn motif.
  const ptc=cadPtc||cadPatMacro*cadMacro*CAD_MICRO;
  // The Live-Tiling grid must be the SAME grid as the Draw canvas (cadBakeLeft), just tiled:
  // a sub-dot at every grid unit, a larger dot at every CAD_MICRO cell point, and a thin grid
  // line at every cell boundary. (Previously it only showed coarse CAD_MICRO dots with lines at
  // tile boundaries, so the two grids looked independent.)
  rx.fillStyle='rgba(160,160,184,0.25)';
  // Per-unit sub-dots only when they'd be legible / cheap to bake; otherwise just cell dots.
  const stepDot=cadPTile>=3?1:CAD_MICRO;
  for(let u=0;u<=ptc;u+=stepDot)for(let v=0;v<=ptc;v+=stepDot){
    const onMain=(u%CAD_MICRO===0)&&(v%CAD_MICRO===0);
    const p=cadG2S(u,v,cadPOX,cadPOY,cadPTile);
    rx.fillRect(p.x-(onMain?2:1),p.y-(onMain?2:1),onMain?4:2,onMain?4:2);
  }
  rx.lineWidth=1.5;rx.strokeStyle='rgba(220,235,255,0.15)';
  // Grid lines at every CAD_MICRO cell boundary (matches the Draw canvas, which draws one line
  // per cell), across the whole tiling span.
  const cells=Math.ceil(ptc/CAD_MICRO);
  for(let i=0;i<=cells;i++){
    const val=i*CAD_MICRO;
    rx.beginPath();const p1=cadG2S(val,0,cadPOX,cadPOY,cadPTile),p2=cadG2S(val,ptc,cadPOX,cadPOY,cadPTile);rx.moveTo(p1.x,p1.y);rx.lineTo(p2.x,p2.y);rx.stroke();
    rx.beginPath();const p3=cadG2S(0,val,cadPOX,cadPOY,cadPTile),p4=cadG2S(ptc,val,cadPOX,cadPOY,cadPTile);rx.moveTo(p3.x,p3.y);rx.lineTo(p4.x,p4.y);rx.stroke();
  }
}

// Draw a single line (straight or arc) onto a canvas context at offset (ou, ov) using the given g2s transform.
function _cadDrawLine(x, l, fi, ox, oy, sz, g2s){
  const col=fi>=0?famColor(fi):'#00ffcc';
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

// ── Background sketch image ──────────────────────────────────────────────────
window.cadBgPick=function(){document.getElementById('cadBgFile').click();};
window.cadBgFileChange=function(inp){
  const f=inp.files&&inp.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>cadBgFromURL(r.result);
  r.readAsDataURL(f);
  inp.value='';   // same file can be re-picked later
};
window.cadBgFromURL=function(url){
  const img=new Image();
  img.onload=()=>{
    cadBgImg=img;
    // Fit into the work area, anchored at the grid origin.
    const tc=cadMacro*CAD_MICRO, ar=img.height/img.width;
    cadBgW=ar>1?tc/ar:tc; cadBgU=0;cadBgV=0;
    _cadBgSyncUI();cadDrawWorkspace();
  };
  img.src=url;
};
window.cadBgRemove=function(){cadBgImg=null;cadBgDrag=null;_cadBgSyncUI();cadDrawWorkspace();};
window.cadBgMove=function(du,dv){if(!cadBgImg)return;cadBgU+=du;cadBgV+=dv;cadDrawWorkspace();};
window.cadBgZoom=function(f){if(!cadBgImg)return;cadBgW=Math.max(1,cadBgW*f);cadDrawWorkspace();};
window.cadBgSetAlpha=function(v){cadBgAlpha=Math.max(0.05,Math.min(0.6,v/100));cadDrawWorkspace();};
function _cadBgSyncUI(){
  const c=document.getElementById('cadBgControls');
  if(c)c.style.display=cadBgImg?'flex':'none';
  const b=document.querySelector('[data-did="bgimg"]');
  if(b)b.style.color=cadBgImg?'#e0b890':'';
}
function cadDrawWorkspace(){
  const cv=document.getElementById('cadCanvas');if(!cv)return;
  const x=cv.getContext('2d');
  x.clearRect(0,0,500,500);
  if(cadLeftBuf)x.drawImage(cadLeftBuf,0,0);
  // Pale background sketch image, in grid coordinates (moves with pan/zoom). Drawn
  // over the baked grid at low alpha so the dots stay readable; the actual pattern
  // lines render after this at full contrast.
  if(cadBgImg){
    const p0=cadG2S(cadBgU,cadBgV,cadOX,cadOY,cadTileSize);
    const w=cadBgW*cadTileSize, h=w*cadBgImg.height/cadBgImg.width;
    x.save();x.globalAlpha=cadBgAlpha;x.drawImage(cadBgImg,p0.x,p0.y,w,h);x.restore();
  }

  // Build full line list including previews
  const all=[...cadLines];
  if(cadTool==='draw'&&cadDrawing&&cadStart&&cadCur)all.push({start:cadStart,end:cadCur,preview:true});
  if(cadTool==='arc'&&cadArcState===2&&cadArcCenter&&cadArcStart&&cadCur){
    const prevArc=cadGenArcSweep(cadArcCenter,cadArcStart,cadArcSweep);
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
      // Match genTiledSegs: diagonal tiling period is rounded up to even so tiles stay grid-aligned.
      const evenUp=x=>2*Math.ceil(x/2);
      const sP=evenUp(mxP-mnP+cadSpacing),sQ=evenUp(mxQ-mnQ+cadSpacing);
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
    const col=fi>=0?famColor(fi):'#00ffcc';
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
      const prevArc=cadGenArcSweep(cadArcCenter,cadArcStart,cadArcSweep);
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
        // Build the hovered sub-arc and flatten it via cadFlattenArc, so iso arcs trace
        // the true round screen curve (grid-circle points would project to the ellipse).
        const ang0=a1+sweepDir*t0*totalSweep, ang1=a1+sweepDir*t1*totalSweep;
        const subArc={arc:true,center:arc.center,r:arc.r,a1:ang0,a2:ang1,
          start:[arc.center[0]+arc.r*Math.cos(ang0),arc.center[1]+arc.r*Math.sin(ang0)],
          end:[arc.center[0]+arc.r*Math.cos(ang1),arc.center[1]+arc.r*Math.sin(ang1)]};
        const segs=cadFlattenArc(subArc, 120);
        const trace=()=>{
          x.beginPath();
          const p0=g2s(segs[0].start[0],segs[0].start[1]);x.moveTo(p0.x,p0.y);
          for(const s of segs){const p=g2s(s.end[0],s.end[1]);x.lineTo(p.x,p.y);}
          x.stroke();
        };
        x.lineCap='round';
        x.lineWidth=8;x.strokeStyle='rgba(255,80,80,0.35)';trace();  // glow
        x.lineWidth=3;x.strokeStyle='#ff6060';trace();               // core
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
    const col=famColor(cadFamOrder[cadFamSel]);
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
    const prevArc=cadGenArcSweep(cadArcCenter,cadArcStart,cadArcSweep);
    if(prevArc)all.push({...prevArc,preview:true});
  }
  const bbox=cadBBox2(all);if(!bbox)return;
  const dU=Math.max(bbox.maxU-bbox.minU,4),dV=Math.max(bbox.maxV-bbox.minV,4);
  const stepU=dU+cadSpacing, stepV=dV+cadSpacing;
  const ptc=cadPtc||cadPatMacro*cadMacro*CAD_MICRO,ov=ptc;
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
      x.strokeStyle=fi>=0?famColor(fi):'#00ffcc';
      x.beginPath();
      const p0=g2s(segs[0].start[0],segs[0].start[1]);x.moveTo(p0.x,p0.y);
      for(const s of segs){const p=g2s(s.end[0],s.end[1]);x.lineTo(p.x,p.y);}
      x.stroke();
    }else{
      const u1=l.start[0]-bbox.minU+ou,v1=l.start[1]-bbox.minV+ov2;
      const u2=l.end[0]-bbox.minU+ou,v2=l.end[1]-bbox.minV+ov2;
      const p1=g2s(u1,v1),p2=g2s(u2,v2);
      if(_visible(p1,p2)){
        x.strokeStyle=fi>=0?famColor(fi):'#00ffcc';
        x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
      }
    }
  });};
  if(cadEmbroidery){
    _renderAt(0,0);   // embroidery = single standalone motif, no repeats
  }else if(!cadBBoxRotated){
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
  _cadRefreshTiling(false);   // rescale/re-bake the Live Tiling when the committed motif changed
  cadDrawWorkspace();cadDrawPattern();
  cadBuildFamBar();
  const el=document.getElementById('cadArcHint');
  if(el){
    const red=cadFindRedundant();
    if(red.length && cadTool!=='arc')el.innerHTML='<span style=\"color:#ff5555\">'+red.length+' redundant line'+(red.length>1?'s':'')+' (red dashed) — excluded when saving</span>';
    else if(cadTool!=='arc')el.textContent='';
  }
}
function cadBuildFamBar(){
  const c=document.getElementById('cadFamSwatches');if(!c)return;
  const pb=document.getElementById('cadPublishBtn');
  // Publish is admin-only and only for not-yet-published patterns.
  if(pb)pb.style.display=(_isAdmin()&&!cadIsPublished)?'inline-block':'none';
  const unique=[...new Set(cadFamilies.filter(f=>f>=0))].sort((a,b)=>a-b);
  if(!unique.length){c.innerHTML='';return;}
  const used=[...new Set(cadFamilies.filter(f=>f>=0))];
  used.forEach(f=>{if(!cadFamOrder.includes(f))cadFamOrder.push(f);});
  c.innerHTML=cadFamOrder.map((fam,pos)=>{
    const col=famColor(fam);
    const cls='cad-fam-swatch'+(cadFamSel===pos?' sel':'');
    // Editor swatch keeps the classic palette colour; an assigned THREAD colour shows
    // as a small square below it (community patterns).
    const thread=(cadCommunity&&cadFamColors[fam])
      ?'<span class="cad-fam-thread" style="background:'+cadFamColors[fam]+'" title="Thread colour for the stitch view — double-click the swatch above to change"></span>'
      :'<span class="cad-fam-thread empty"></span>';
    return '<span class="cad-fam-col"><button class="'+cls+'" onclick="cadSelectFam('+pos+')" ondblclick="cadFamColorPick('+fam+')" style="background:'+col+'" title="Family '+(fam+1)+' — double-click to pick a thread colour for the stitch view (community patterns)"></button>'+thread+'</span>';
  }).join('');
  _cadBuildFamRoutingUI();   // keep the per-colour routing panel in sync with the families
  _cadBuildFamColorUI();     // …and the custom-colour picker panel
}
// ── Per-colour routing overrides UI ──────────────────────────────────────────
// Hidden behind the small ▾ next to the Routing dropdown: one row per colour with
// "same as pattern" + the routing modes. State in cadFamRouting {famIdx→mode}.
window.cadToggleFamRouting=function(){
  cadFamRoutingOpen=!cadFamRoutingOpen;
  _cadBuildFamRoutingUI();
};
window.cadSetFamRouting=function(fam,val){
  if(val)cadFamRouting[fam]=val;else delete cadFamRouting[fam];
  _cadBuildFamRoutingUI();
  cadUpdateSettings();
};
function _cadBuildFamRoutingUI(){
  const p=document.getElementById('cadFamRoutingPanel');if(!p)return;
  const btn=document.getElementById('cadFamRoutingBtn');
  const hasOverride=Object.keys(cadFamRouting).some(k=>cadFamRouting[k]&&cadFamRouting[k]!==cadRoutingMode);
  if(btn){
    btn.textContent=cadFamRoutingOpen?'▴':'▾';
    // Amber tint = overrides active, so the feature is findable even when collapsed.
    btn.style.color=hasOverride?'#e0b890':'';
    btn.title=hasOverride?'Per-colour routing overrides ACTIVE':'Advanced: route individual colours with a different logic';
  }
  if(!cadFamRoutingOpen){p.style.display='none';return;}
  const fams=cadFamOrder.length?cadFamOrder:[...new Set(cadFamilies.filter(f=>f>=0))].sort((a,b)=>a-b);
  if(!fams.length){p.style.display='flex';p.innerHTML='<span class="cad-famroute-hint">Draw something first — each colour can then get its own routing.</span>';return;}
  const sel=document.getElementById('cadRoutingMode');
  const modeOpts=[...sel.options].map(o=>[o.value,o.textContent]);
  p.innerHTML='<span class="cad-famroute-hint">Per-colour routing:</span>'+fams.map(fam=>{
    const col=famColor(fam);
    const cur=cadFamRouting[fam]||'';
    return '<span class="cad-famroute-row"><span class="cad-famroute-chip" style="background:'+col+'"></span>'+
      '<select onchange="cadSetFamRouting('+fam+',this.value)">'+
      '<option value=""'+(cur?'':' selected')+'>↳ same as pattern</option>'+
      modeOpts.map(([v,t])=>'<option value="'+v+'"'+(cur===v?' selected':'')+'>'+t+'</option>').join('')+
      '</select></span>';
  }).join('');
  p.style.display='flex';
}
// Called from experimental.js on pattern load / remix / new: close the panel and
// refresh the ▾ indicator for the (re)loaded cadFamRouting.
function _cadSyncFamRoutingUI(){cadFamRoutingOpen=false;_cadBuildFamRoutingUI();}
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
  if(!used.length)return{families:[], famOrder:[], map:{}};
  const map={};used.forEach((of,i)=>{map[of]=i;});
  const newFam=families.map(f=>f>=0?map[f]:-1);
  const newOrder=famOrder.filter(f=>used.includes(f)).map(f=>map[f]);
  return{families:newFam, famOrder:newOrder, map};
}
// cadFamRouting uses editor fam indices; saving compacts/renumbers families, so the
// overrides are remapped with the same map. Entries equal to the base mode are pruned.
function _cadRemapFamRouting(map){
  const out={};
  for(const k in cadFamRouting){
    const m=cadFamRouting[k];
    if(map[k]!==undefined&&m&&m!==cadRoutingMode)out[map[k]]=m;
  }
  return out;
}
// Same remap for the custom family colours. Colours are a Community-only feature,
// so a traditional/unflagged save stores an empty map (the entries stay in the
// editor session, they just don't persist).
function _cadRemapFamColors(map){
  if(!cadCommunity)return{};
  const out={};
  for(const k in cadFamColors){
    if(map[k]!==undefined&&cadFamColors[k])out[map[k]]=cadFamColors[k];
  }
  return out;
}
// ── Custom family colours UI (double-click a family swatch) ──────────────────
window.cadFamColorPick=function(fam){
  if(!cadCommunity){
    alert('Custom colours are a Community-pattern feature — tick "Community" in the header first.\n(Traditional patterns keep the classic palette.)');
    return;
  }
  cadFamColorOpen=(cadFamColorOpen===fam)?null:fam;
  _cadBuildFamColorUI();
};
window.cadSetFamColor=function(fam,hex){
  if(hex)cadFamColors[fam]=hex; else delete cadFamColors[fam];
  cadFamColorOpen=null;
  // Assigning a thread colour switches the coloured-thread toggle ON, so the stitch
  // view reflects the pick INSTANTLY (cadUpdateAll below redraws it when visible).
  if(hex&&!cadStitchColors){cadStitchColors=true;_cadSyncStitchUI();}
  cadUpdateAll();
};
function _cadBuildFamColorUI(){
  const p=document.getElementById('cadFamColorPanel');if(!p)return;
  if(cadFamColorOpen===null||!cadCommunity){p.style.display='none';p.innerHTML='';return;}
  const fam=cadFamColorOpen;
  const sw=(hex,name,cur)=>'<button class="cad-color-sw'+(cur?' sel':'')+'" style="background:'+hex+'" title="'+name+'" onclick="cadSetFamColor('+fam+',\''+hex+'\')"></button>';
  const cur=cadFamColors[fam];
  p.style.display='flex';
  p.innerHTML='<span class="cad-famroute-hint">Thread colour '+(fam+1)+':</span>'+
    '<button class="cad-color-sw cad-color-reset'+(cur?'':' sel')+'" style="background:'+CAD_YARN+'" title="Default off-white thread" onclick="cadSetFamColor('+fam+',null)">↺</button>'+
    OLYMPUS_SASHIKO.map(o=>sw(o.hex,'#'+o.code+' '+o.name,cur===o.hex)).join('')+
    GAL_PASTEL.map(o=>sw(o.hex,o.name,cur===o.hex)).join('');
}
// Draw/Tiles readouts. Grid shows the draw-canvas span in grid units — cadMacro cells ×
// CAD_MICRO units each — as "(N·10)×(N·10)". Tiles shows the live-tiling repeat count as "N×N".
function _cadSyncGridLabel(){const el=document.getElementById('cadGridSizeVal');if(el){const n=cadMacro*CAD_MICRO;el.textContent=n+'×'+n;}}
function _cadSyncTilesLabel(){
  const el=document.getElementById('cadPatSizeVal');
  if(el)el.textContent=cadEmbroidery?'1×1':(cadPatMacro+'×'+cadPatMacro);
  // Embroidery = single motif, so the Tiles stepper is inert (greyed out) while it's on.
  const ctl=document.getElementById('cadTilesCtl');
  if(ctl){ctl.style.opacity=cadEmbroidery?'0.4':'';ctl.style.pointerEvents=cadEmbroidery?'none':'';}
}
// Recompute the Live-Tiling scale so cadPatMacro (N) copies of the drawn motif fill the canvas.
// period = the motif's tile size (max bbox extent); ptc = N·period → N tiles. Cheap sig-guard so
// it only re-bakes when the committed geometry / settings actually changed (not on every draw move).
function _cadRefreshTiling(force){
  const bb=cadBBox();
  const sig=(bb?[bb.minU,bb.maxU,bb.minV,bb.maxV].map(v=>v.toFixed(2)).join(','):'e')
    +'|'+_cadTiles()+'|'+cadEmbroidery+'|'+cadMacro+'|'+cadSpacing+'|'+cadGridType;
  if(!force&&sig===_cadTileSig)return;
  _cadTileSig=sig;
  const tc=cadMacro*CAD_MICRO;
  const snap=v=>{const r=Math.round(v);return Math.abs(v-r)<0.005?r:v;};
  const period=bb?Math.max(snap(bb.maxU-bb.minU),snap(bb.maxV-bb.minV),1):tc;
  const ptc=Math.max(1,_cadTiles()*period);
  cadPtc=ptc;
  if(cadGridType==='isometric'){cadPTile=500/(2*ptc*CAD_COS30);cadPOX=250;cadPOY=(500-(ptc*2*cadPTile*CAD_SIN30))/2;}
  else{cadPTile=500/ptc;cadPOX=0;cadPOY=0;}
  cadBakeRight();
}
window.cadUpdateSettings=function(){
  cadGridType=document.getElementById('cadGridType').value;
  cadSpacing=parseInt(document.getElementById('cadSpacing').value);
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  // Diamond re-cut is square-grid only — hide the button on isometric.
  const db=document.getElementById('cadBtnDiamond');
  if(db)db.style.display=(cadGridType==='isometric')?'none':'';
  cadZoom=1;cadPanX=0;cadPanY=0;
  _cadSyncGridLabel();_cadSyncTilesLabel();
  const tc=cadMacro*CAD_MICRO;
  cadBase=(cadGridType==='isometric')?460/(2*tc*CAD_COS30):460/tc;
  _cadRefreshTiling(true);
  cadApplyView();cadBakeLeft();cadUpdateAll();
};
window.cadSetTool=function(t){
  cadTool=t;
  document.getElementById('cadBtnDraw').classList.toggle('on',t==='draw');
  document.getElementById('cadBtnArc').classList.toggle('on',t==='arc');
  document.getElementById('cadBtnErase').classList.toggle('on',t==='erase');
  document.getElementById('cadBtnRecolor').classList.toggle('on',t==='recolor');
  cadDrawing=false;cadStart=null;cadHover=null;
  cadArcState=0;cadArcCenter=null;cadArcStart=null;cadArcSweep=0;
  cadRecolorOn=false;
  cadArcLabel();cadUpdateAll();
};
window.cadUndo=function(){
  if(!cadHistory.length)return;
  const state=cadHistory.pop();
  if(state&&typeof state==='object'&&'l' in state){cadLines=state.l;cadFamilies=state.f||[];if(state.o)cadFamOrder=state.o;}
  else{cadLines=state;cadFamilies=new Array(cadLines.length).fill(-1);}
  cadFamsLocked=true;cadAutoShrinkGrid();cadUpdateAll();
};
window.cadClear=function(){if(cadLines.length){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadLines=[];cadFamilies=[];cadFamsLocked=false;cadFamOrder=[];cadFamSel=-1;cadAutoShrinkGrid();cadUpdateAll();}};
window.cadResetView=function(){cadZoom=1;cadPanX=0;cadPanY=0;cadApplyView();cadBakeLeft();cadUpdateAll();};
window.cadToggleBBoxRotate=function(){
  cadBBoxRotated=!cadBBoxRotated;
  const btn=document.getElementById('cadBtnBBoxRot');
  if(btn){btn.classList.toggle('on',cadBBoxRotated);btn.textContent=cadBBoxRotated?'◆ 45°':'◇ 45°';}
  cadUpdateAll();
};
// Traditional and Community are mutually exclusive — checking one clears the other.
window.cadUpdateTraditional=function(){
  cadTraditional=document.getElementById('cadTraditional').checked;
  if(cadTraditional){
    cadCommunity=false;const cb=document.getElementById('cadCommunity');if(cb)cb.checked=false;
    const wasEmb=cadEmbroidery;cadEmbroidery=false;
    _cadSyncCommunityUI();
    const nf=document.getElementById('cadCommunityName');if(nf)nf.focus();
    if(wasEmb){_cadSyncTilesLabel();_cadRefreshTiling(true);}
  }else{_cadSyncCommunityUI();}
  // Custom family colours are community-gated — re-render so they activate/deactivate
  // with the checkbox (the picker panel also closes when community goes off).
  cadFamColorOpen=null;
  cadUpdateAll();
};
window.cadUpdateCommunity=function(){
  cadCommunity=document.getElementById('cadCommunity').checked;
  if(cadCommunity){cadTraditional=false;const tb=document.getElementById('cadTraditional');if(tb)tb.checked=false;}
  // Unchecking Community also drops the Embroidery sub-flag (it only exists for community patterns).
  const wasEmb=cadEmbroidery;
  if(!cadCommunity)cadEmbroidery=false;
  _cadSyncCommunityUI();
  if(cadCommunity){const nf=document.getElementById('cadCommunityName');if(nf)nf.focus();}
  if(wasEmb!==cadEmbroidery){_cadSyncTilesLabel();_cadRefreshTiling(true);}
  cadFamColorOpen=null;
  cadUpdateAll();
};
window.cadUpdateCommunityName=function(){cadCommunityName=document.getElementById('cadCommunityName').value.trim();};
// Embroidery = single-motif mode: the Live Tiling / Play / stitch views show exactly one
// instance of the drawing (no repeats); the Tiles stepper is inert while it's on.
window.cadUpdateEmbroidery=function(){
  cadEmbroidery=document.getElementById('cadEmbroidery').checked;
  _cadSyncTilesLabel();_cadRefreshTiling(true);cadUpdateAll();
};
// Reflect cadCommunity/cadCommunityName/cadEmbroidery into the header UI
// (checkboxes + name-field / embroidery visibility).
function _cadSyncCommunityUI(){
  const cb=document.getElementById('cadCommunity'),nf=document.getElementById('cadCommunityName');
  if(cb)cb.checked=cadCommunity;
  // Name field shows for Community ("by …") AND Traditional ("added by: …") patterns.
  // visibility (not display) → the field keeps its reserved space, so the Save button never shifts.
  if(nf){nf.value=cadCommunityName;nf.style.visibility=(cadCommunity||cadTraditional)?'visible':'hidden';}
  const eb=document.getElementById('cadEmbroidery'),ew=document.getElementById('cadEmbroideryWrap');
  if(eb)eb.checked=cadEmbroidery;
  if(ew)ew.style.visibility=cadCommunity?'visible':'hidden';
  _cadSyncTilesLabel();
  _cadSyncStitchUI();   // coloured-thread toggle visibility follows the Community flag
}
window.cadStepSpacing=function(d){
  const el=document.getElementById('cadSpacing');
  let v=parseInt(el.value)||0;
  v=Math.max(0,Math.min(12,v+d));
  el.value=v;cadUpdateSettings();
};
window.cadStepMacro=function(d){
  cadMacro=Math.max(1,Math.min(12,(cadMacro||3)+d));
  _cadSyncGridLabel();cadUpdateSettings();
};
window.cadStepPatMacro=function(d){
  cadPatMacro=Math.max(1,Math.min(12,(cadPatMacro||3)+d));
  _cadSyncTilesLabel();cadUpdateSettings();
};
// Majority fractional offset of the drawn endpoints from the integer grid, per axis.
// A phase is only non-zero when a clear majority (≥50%) of the endpoints shares it
// (same gating idea as _galGridPhase) — 45°-rotated motifs with MIXED fractions
// report 0, so nothing arbitrary happens to them. A constant offset (e.g. the 0.5
// a stale buggy save left behind, or Ishi Guruma's √2 phase) is detected exactly.
function _cadGridPhaseOf(lines){
  const phase=ci=>{
    const cnt=new Map();let tot=0;
    lines.forEach(l=>{[l.start,l.end].forEach(p=>{
      const f=((p[ci]%1)+1)%1;
      const k=Math.round(f*1000)%1000;   // cluster to 1e-3, wraps 0.9996→0
      cnt.set(k,(cnt.get(k)||0)+1);tot++;
    });});
    if(!tot)return 0;
    let bk=0,bc=-1;cnt.forEach((c,k)=>{if(c>bc){bc=c;bk=k;}});
    return bc/tot>=0.5?bk/1000:0;
  };
  return[phase(0),phase(1)];
}
window.cadMovePattern=function(du,dv){
  if(!cadLines.length)return;
  // In the isometric view the u/v axes run diagonally on screen, so ↑↓←→ with raw (du,dv) moves
  // the pattern diagonally. Remap the intended screen direction to the on-grid step that moves it
  // visually up/down/left/right: vertical → (±1,±1), horizontal → (±1,∓1).
  if(cadGridType==='isometric'){ if(du!==0)dv=-du; else du=dv; }
  // Grid re-snap: if the whole motif sits a constant fraction off the integer grid
  // (typically 0.5, left behind by the old load-centring bug), the arrow press also
  // cancels that offset — one keypress puts a stale off-grid pattern back on the dots.
  {const[pu,pv]=_cadGridPhaseOf(cadLines);
   du+=pu?(pu>0.5?1-pu:-pu):0;
   dv+=pv?(pv>0.5?1-pv:-pv):0;}
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

// ── Diamond re-cut ("kitties" cut) ─────────────────────────────────────────
// Re-partition the drawn motif so PLAIN rectangular tiling shows a diamond
// (centered / half-drop) arrangement: the motif stays whole in the middle of
// its tile, and four copies shifted by half the tile period are added at the
// corners, each CUT at the tile boundary — like the traditional cat-face
// patterns, where the unit cell carries the face cut through the middle and
// the tiled cloth shows whole faces on a diamond grid. The four corner offsets
// differ by exactly one tile period, so adjacent tiles reassemble the cut
// pieces into one whole extra motif at every tile corner. One-shot transform
// (Undo restores); square grid only (the button is hidden on isometric).

// Liang-Barsky clip of a straight segment to rect rc, null if outside/degenerate.
function _dcClipSeg(p0,p1,rc){
  const dx=p1[0]-p0[0], dy=p1[1]-p0[1];
  const p=[-dx,dx,-dy,dy], q=[p0[0]-rc.x0,rc.x1-p0[0],p0[1]-rc.y0,rc.y1-p0[1]];
  let t0=0,t1=1;
  for(let i=0;i<4;i++){
    if(Math.abs(p[i])<1e-12){ if(q[i]<-1e-9)return null; }
    else{ const t=q[i]/p[i]; if(p[i]<0){if(t>t0)t0=t;}else if(t<t1)t1=t; }
  }
  if(t1-t0<1e-9)return null;
  const r6=v=>Math.round(v*1e6)/1e6;
  const a=[r6(p0[0]+t0*dx),r6(p0[1]+t0*dy)], b=[r6(p0[0]+t1*dx),r6(p0[1]+t1*dy)];
  if(Math.hypot(b[0]-a[0],b[1]-a[1])<0.01)return null;
  return{start:a,end:b};
}
// Cut an arc at the rect boundary, keep the inside sub-arcs (0..n pieces).
// Cuts at every crossing of the four INFINITE boundary lines — between two
// consecutive cuts the arc crosses no boundary line, so one midpoint test
// decides the whole sub-arc.
function _dcClipArc(arc,rc){
  const cx=arc.center[0], cy=arc.center[1], r=arc.r;
  const a1=arc.a1, sweep=arc.a2-arc.a1;
  if(Math.abs(sweep)<1e-9||r<1e-9)return[];
  const ts=[0,1];
  const addA=a=>{ // absolute angle → every t∈(0,1) with a1+t·sweep ≡ a (mod 2π)
    for(let k=-2;k<=2;k++){
      const t=((a-a1)+k*2*Math.PI)/sweep;
      if(t>1e-6&&t<1-1e-6)ts.push(t);
    }
  };
  for(const X of[rc.x0,rc.x1]){const d=(X-cx)/r;if(Math.abs(d)<=1){const a=Math.acos(Math.max(-1,Math.min(1,d)));addA(a);addA(-a);}}
  for(const Y of[rc.y0,rc.y1]){const d=(Y-cy)/r;if(Math.abs(d)<=1){const a=Math.asin(Math.max(-1,Math.min(1,d)));addA(a);addA(Math.PI-a);}}
  ts.sort((x,y)=>x-y);
  const TOL=1e-4, out=[];
  const inside=(x,y)=>x>=rc.x0-TOL&&x<=rc.x1+TOL&&y>=rc.y0-TOL&&y<=rc.y1+TOL;
  for(let i=0;i<ts.length-1;i++){
    if(ts[i+1]-ts[i]<1e-6)continue;
    const am=a1+sweep*(ts[i]+ts[i+1])/2;
    if(!inside(cx+r*Math.cos(am),cy+r*Math.sin(am)))continue;
    const b1=a1+sweep*ts[i], b2=a1+sweep*ts[i+1];
    const prev=out[out.length-1];
    if(prev&&Math.abs(prev.a2-b1)<1e-9){prev.a2=b2;continue;} // tangent touch → merge
    out.push({arc:true,center:[cx,cy],r,a1:b1,a2:b2});
  }
  return out.filter(s=>Math.abs(s.a2-s.a1)*r>=0.01).map(s=>({...s,
    start:[cx+r*Math.cos(s.a1),cy+r*Math.sin(s.a1)],
    end:[cx+r*Math.cos(s.a2),cy+r*Math.sin(s.a2)]}));
}
// Is straight piece p fully contained in an existing straight line of list?
function _dcContainedSeg(p,list){
  const dx=p.end[0]-p.start[0], dy=p.end[1]-p.start[1];
  const len=Math.hypot(dx,dy); if(len<1e-9)return true;
  for(const l of list){
    if(l.arc)continue;
    const ldx=l.end[0]-l.start[0], ldy=l.end[1]-l.start[1];
    const ll=Math.hypot(ldx,ldy); if(ll<1e-9)continue;
    if(Math.abs(ldx*dy-ldy*dx)/(ll*len)>1e-4)continue;                 // not parallel
    const vx=p.start[0]-l.start[0], vy=p.start[1]-l.start[1];
    if(Math.abs(vx*ldy-vy*ldx)/ll>0.01)continue;                       // not collinear
    const t0=(vx*ldx+vy*ldy)/(ll*ll);
    const t1=((p.end[0]-l.start[0])*ldx+(p.end[1]-l.start[1])*ldy)/(ll*ll);
    if(Math.min(t0,t1)>=-1e-6&&Math.max(t0,t1)<=1+1e-6)return true;    // interval inside
  }
  return false;
}
// Is arc piece p fully contained in an existing arc of list (same circle, sub-sweep)?
function _dcContainedArc(p,list){
  for(const l of list){
    if(!l.arc)continue;
    if(Math.abs(l.center[0]-p.center[0])>1e-3||Math.abs(l.center[1]-p.center[1])>1e-3
       ||Math.abs(l.r-p.r)>1e-3)continue;
    const am=(p.a1+p.a2)/2;
    if(cadAngleInArc(p.a1,l)!==null&&cadAngleInArc(am,l)!==null&&cadAngleInArc(p.a2,l)!==null)return true;
  }
  return false;
}
window.cadDiamondCut=function(){
  if(cadGridType==='isometric')return;          // square grid only
  if(!cadLines.length)return;
  const bb=cadBBox();if(!bb)return;
  const snap=v=>{const r=Math.round(v);return Math.abs(v-r)<0.005?r:v;};
  const W=snap(bb.maxU-bb.minU), H=snap(bb.maxV-bb.minV);
  if(W<2||H<2){alert('Motif too small for a diamond repeat (needs at least 2×2 grid units).');return;}
  const rc={x0:bb.minU,x1:bb.minU+W,y0:bb.minV,y1:bb.minV+H};
  const h=Math.round(W/2), k=Math.round(H/2);   // integer half-period → pieces stay on-grid
  const pieces=[];
  for(const[ox,oy]of[[h,k],[h-W,k],[h,k-H],[h-W,k-H]]){
    for(const l of cadLines){
      if(l.arc){
        pieces.push(..._dcClipArc({...l,center:[l.center[0]+ox,l.center[1]+oy]},rc));
      }else{
        const c=_dcClipSeg([l.start[0]+ox,l.start[1]+oy],[l.end[0]+ox,l.end[1]+oy],rc);
        if(c)pieces.push(c);
      }
    }
  }
  // A piece lying exactly ON a max edge re-appears at the min edge from the sibling offset
  // (and would double up with the next tile) — keep only the min-edge copy.
  const onMax=l=>!l.arc&&((Math.abs(l.start[0]-rc.x1)<1e-6&&Math.abs(l.end[0]-rc.x1)<1e-6)
                        ||(Math.abs(l.start[1]-rc.y1)<1e-6&&Math.abs(l.end[1]-rc.y1)<1e-6));
  // Drop pieces fully CONTAINED in an already-kept piece (symmetric motifs can map two
  // source lines onto the same piece) — keeping both would make cadFindRedundant drop
  // BOTH at save time, losing the line entirely.
  const kept=[];
  for(const p of pieces){
    if(onMax(p))continue;
    if(p.arc?_dcContainedArc(p,kept):_dcContainedSeg(p,kept))continue;
    kept.push(p);
  }
  if(!kept.length)return;
  cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies],o:[...cadFamOrder]});
  // REPLACE the motif with its boundary-cut version: the original is removed; only the
  // corner pieces remain, and the freed middle is for drawing the alternate motif of the
  // diamond arrangement. (A line parallel to the half-period offset — e.g. a centre
  // diagonal — maps onto its own line, so it visibly "stays"; that is correct.)
  cadLines=kept;
  // The ◇ 45° tiling would diamond the diamond — the cut replaces it, so switch it off.
  if(cadBBoxRotated){
    cadBBoxRotated=false;
    const btn=document.getElementById('cadBtnBBoxRot');
    if(btn){btn.classList.remove('on');btn.textContent='◇ 45°';}
  }
  cadFamsLocked=false;cadFamSel=-1;
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
  const name=document.getElementById('cadPatName').value.trim();
  if(!name){alert('Please name your pattern before saving.');document.getElementById('cadPatName').focus();return;}
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>_cadLineToSaved(l, bbox.minU, bbox.minV));
  const cf=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  const sbb={minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV};
  let pat={name,type:'exp',gridType:cadGridType,lines,bbox:sbb,patMacro:patMacroForTiles({bbox:sbb},_cadTiles()),gridMacro:cadMacro,spacing:cadSpacing,thumbnail,createdAt:Date.now(),creatorId:_getUserId(),bboxRotated:cadBBoxRotated,famOrder:cf.famOrder,traditional:cadTraditional,community:cadCommunity,communityName:(cadCommunity||cadTraditional)?cadCommunityName:'',embroidery:cadCommunity&&cadEmbroidery,routingMode:cadRoutingMode,famRouting:_cadRemapFamRouting(cf.map),famColors:_cadRemapFamColors(cf.map),stitchColors:cadCommunity&&cadStitchColors,fabric:cadCommunity?cadFabric:'',thumbCells:_cadTiles(),stitchView:cadStitchView,stitchLen:cadStitchLen,stitchRatio:cadStitchRatio,stitchGrid:cadStitchGrid};
  const wasEdit=!!cadEditId;
  if(cadEditId){
    const idx=EXP_PATTERNS.findIndex(p=>p.id===cadEditId);
    if(idx>=0){
      const old=EXP_PATTERNS[idx];
      // Merge over the STORED pattern so edit-invisible fields survive a re-save:
      // the admin gallery sort key `order` (else the card jumps position), remix
      // links (remixOf/remixes), the original creatorId, likes, createdAt, ….
      pat={...old,...pat,id:cadEditId,createdAt:old.createdAt,creatorId:old.creatorId||pat.creatorId,published:old.published};
      // Preserve the pinned routing engine on edit (published patterns stay locked to it;
      // sandbox patterns carry undefined and keep using the current engine).
      if(old.routingEngine!==undefined)pat.routingEngine=old.routingEngine;
      else if(pat.published)pat.routingEngine=1;
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
window.cadPublishToLibrary=async function(){
  // Publishing to the gallery is admin-only (Google sign-in, enforced by Firestore rules).
  if(!await _ensureAdmin())return;
  if(!cadLines.length){alert('No lines to publish.');return;}
  const bbox=cadBBox();if(!bbox)return;
  const name=document.getElementById('cadPatName').value.trim();
  if(!name){alert('Please name your pattern before publishing.');document.getElementById('cadPatName').focus();return;}
  const redSet=new Set(cadFindRedundant());
  const cleanLines=cadLines.filter((_,i)=>!redSet.has(i));
  if(!cleanLines.length)return;
  const lines=cleanLines.map(l=>_cadLineToSaved(l, bbox.minU, bbox.minV));
  const thumbnail=document.getElementById('cadCanvas').toDataURL('image/png');
  const cf2=_compactFamilies(cadFamilies.filter((_,i)=>!redSet.has(i)), [...cadFamOrder]);
  cadRoutingMode=document.getElementById('cadRoutingMode').value;
  const sbb={minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV};
  let pat={name,type:'exp',gridType:cadGridType,lines,bbox:sbb,patMacro:patMacroForTiles({bbox:sbb},_cadTiles()),gridMacro:cadMacro,spacing:cadSpacing,thumbnail,createdAt:Date.now(),creatorId:_getUserId(),bboxRotated:cadBBoxRotated,famOrder:cf2.famOrder,traditional:cadTraditional,community:cadCommunity,communityName:(cadCommunity||cadTraditional)?cadCommunityName:'',embroidery:cadCommunity&&cadEmbroidery,routingMode:cadRoutingMode,famRouting:_cadRemapFamRouting(cf2.map),famColors:_cadRemapFamColors(cf2.map),stitchColors:cadCommunity&&cadStitchColors,fabric:cadCommunity?cadFabric:'',published:true,thumbCells:_cadTiles(),stitchView:cadStitchView,stitchLen:cadStitchLen,stitchRatio:cadStitchRatio,stitchGrid:cadStitchGrid};
  if(cadEditId){
    const idx=EXP_PATTERNS.findIndex(p=>p.id===cadEditId);
    if(idx>=0){
      const old=EXP_PATTERNS[idx];
      // Merge over the STORED pattern (same as cadSaveToLibrary): keeps the admin
      // gallery sort key `order` so a re-publish doesn't move the card, plus remix
      // links, original creatorId, createdAt, ….
      pat={...old,...pat,id:cadEditId,createdAt:old.createdAt,creatorId:old.creatorId||pat.creatorId,published:true};
      // Re-publishing an already-published pattern KEEPS its pinned routing engine
      // (a missing field = published before versioning → engine 1), so the lock holds.
      pat.routingEngine=old.routingEngine||1;
      pat.families=cf2.families;
      EXP_PATTERNS[idx]=pat;
    }else{pat.id='exp_'+Date.now();pat.routingEngine=ROUTING_ENGINE_CURRENT;pat.families=cf2.families;EXP_PATTERNS.unshift(pat);}
  }else{
    pat.id='exp_'+Date.now();pat.routingEngine=ROUTING_ENGINE_CURRENT;pat.families=cf2.families;
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
  const pbb={minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV};
  const pat={type:'exp',gridType:cadGridType,lines,bbox:pbb,patMacro:patMacroForTiles({bbox:pbb},_cadTiles()),spacing:cadSpacing,bboxRotated:cadBBoxRotated,famOrder:[...cadFamOrder],routingMode:cadRoutingMode,embroidery:cadEmbroidery};
  pat.families=cadFamilies.filter((_,i)=>!redSet.has(i));
  const segs=genTiledSegs(pat);
  const fullPath=buildExpPath(segs,pat.famOrder,cadRoutingMode,{iso:cadGridType==='isometric',famRouting:cadFamRouting});
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
    _cadDrawFabricBg(x);
    // Grid always on (whole canvas); stitches at FULL contrast (no gallery-style subduing).
    _cadEditorGrid(x,_cadStitchCache);
    const w=(_cadStitchCache&&_cadStitchCache.w)||_cadStitchW();
    _tpSts.forEach((s,i)=>{if(i<_tpStep)_cadDrawStitch(x,s,w,_cadThreadColor(s.fam));});
    return;
  }
  if(cadRightBuf)x.drawImage(cadRightBuf,0,0);
  x.lineWidth=2.5;x.lineCap='round';
  _tpSts.forEach((s,i)=>{
    if(i>=_tpStep)return;
    x.strokeStyle=famColor(s.fam);
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
  return JSON.stringify(cadLines)+'|'+cadGridType+'|'+cadMacro+'|'+cadPatMacro+'|'+_cadRefMacro+'|'+cadSpacing+'|'+
    cadRoutingMode+'|'+cadBBoxRotated+'|'+cadFamOrder.join(',')+'|'+cadStitchLen+'|'+cadStitchRatio+'|'+cadEmbroidery+'|'+JSON.stringify(cadFamRouting);
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
// Stitch-view background: the selected fabric for community patterns, classic denim
// otherwise (and for the Indigo default, so non-community stays byte-identical).
function _cadDrawFabricBg(x){
  const id=_cadFabricId();
  if(id==='indigo')_cadDrawDenim(x); else _drawFabric(x,id,500,500);
}

// ── Sashiko fabrics (curated) ────────────────────────────────────────────────
// The cloths sashiko is actually worked on: indigo aizome (the classic), a deeper
// indigo, black, slate grey, natural (unbleached cotton/linen) and kakishibu
// (persimmon-dyed). Small on purpose — the important ones, well curated. Each is
// baked once into a 500×500 woven-texture buffer (twill sheen + fibre speckle +
// vignette), tuned to the cloth's lightness. The gallery viewer picks one; the CAD
// editor and thumbnails keep the default indigo denim.
const SASHIKO_FABRICS=[
  {id:'indigo',   name:'Indigo',     g0:'#2c4878', g1:'#213a64', light:false},
  {id:'midnight', name:'Midnight',   g0:'#1c2740', g1:'#121a2e', light:false},
  {id:'black',    name:'Black',      g0:'#2b2b2e', g1:'#191a1c', light:false},
  {id:'slate',    name:'Slate grey', g0:'#565a61', g1:'#43464c', light:false},
  {id:'natural',  name:'Natural',    g0:'#e9dfc7', g1:'#dcd0b3', light:true },
  {id:'kakishibu',name:'Kakishibu',  g0:'#7c4c33', g1:'#5f3926', light:false},
];
function _fabricById(id){return SASHIKO_FABRICS.find(f=>f.id===id)||SASHIKO_FABRICS[0];}
const _fabricBufs={};
function _bakeFabric(fab){
  const c=document.createElement('canvas');c.width=500;c.height=500;
  const d=c.getContext('2d');
  const g=d.createLinearGradient(0,0,0,500);
  g.addColorStop(0,fab.g0);g.addColorStop(1,fab.g1);
  d.fillStyle=g;d.fillRect(0,0,500,500);
  // Twill weave: faint parallel diagonals (sheen + shadow tuned to cloth lightness).
  const hi=fab.light?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.035)';
  const lo=fab.light?'rgba(120,96,60,0.06)':'rgba(0,0,0,0.05)';
  d.lineWidth=1;
  for(let i=-500;i<500;i+=4){
    d.strokeStyle=hi;d.beginPath();d.moveTo(i,500);d.lineTo(i+500,0);d.stroke();
    d.strokeStyle=lo;d.beginPath();d.moveTo(i+1.4,500);d.lineTo(i+501.4,0);d.stroke();
  }
  // Speckle (fibres / slubs)
  const sp1=fab.light?'rgba(120,96,60,0.06)':'rgba(255,255,255,0.05)';
  const sp2=fab.light?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.07)';
  for(let i=0;i<2600;i++){
    const x=Math.random()*500,y=Math.random()*500,r=Math.random()*0.9+0.2;
    d.fillStyle=Math.random()<0.5?sp1:sp2;
    d.beginPath();d.arc(x,y,r,0,Math.PI*2);d.fill();
  }
  // Soft vignette
  const v=d.createRadialGradient(250,250,120,250,250,360);
  v.addColorStop(0,'rgba(0,0,0,0)');
  v.addColorStop(1,fab.light?'rgba(90,70,40,0.12)':'rgba(0,0,0,0.22)');
  d.fillStyle=v;d.fillRect(0,0,500,500);
  return c;
}
// Draw a fabric by id (baked + cached). Used by the gallery viewer + PDF export.
function _drawFabric(x,id,w,h){
  if(!_fabricBufs[id])_fabricBufs[id]=_bakeFabric(_fabricById(id));
  x.drawImage(_fabricBufs[id],0,0,w||500,h||500);
}

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
function _stitchW(len){return Math.max(1,Math.min(6,len*0.28));}
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
// Distance² from point (cx,cy) to segment p→q vs r² (cheap "is this point near the segment").
function _segNear(p,q,cx,cy,r){
  const vx=q[0]-p[0],vy=q[1]-p[1],wx=cx-p[0],wy=cy-p[1];
  const len2=vx*vx+vy*vy||1; let t=(wx*vx+wy*vy)/len2; t=t<0?0:t>1?1:t;
  const dx=p[0]+t*vx-cx, dy=p[1]+t*vy-cy;
  return dx*dx+dy*dy < r*r;
}
// Lay running stitches along each stroke (screen coords). Each junction is classified by
// its NUMBER OF RAYS (distinct incident directions), which decides the clearance:
//  • 2 rays  = CORNER or straight pass → clearance 0: the visible stitch ENDS exactly on
//    the vertex ("down-point", crisp "I"); per-segment fitting lands a boundary there.
//  • 3–4 rays = CROSSING (X) / T-junction → a clear gap of ≈ ½–1 stitch length straddles
//    the point so perpendicular threads never touch.
//  • ≥5 rays = STAR hub → radial clearance = L/(2·tan(π/R)), the inscribed-circle radius
//    of a regular N-gon with N=R equally-spaced arms. Grows with arm count so a 6-armed
//    Asanoha hub gets ≈0.87·L while a 12-armed Kamon hub gets ≈1.87·L.  Cap: 2.5·L.
// Crossings are found inclusive of grid vertices (`_segCross`); round caps are compensated
// by insetting drawn endpoints by the cap radius.
function _layStitches(strokes,L,ratioKey,w){
  const ratio=CAD_STITCH_RATIOS[ratioKey]||CAD_STITCH_RATIOS.standard;
  L=Math.max(1,L);
  const G=L*ratio.g/ratio.s, U=L+G;
  const cap=w/2;                              // round-cap radius
  const cCross=Math.max(0.35*L, w*0.9);       // X / T half-clearance → gap ≈ 0.7·L, ≥ thread width
  const data=strokes.map(st=>{
    const pts=st.pts,cum=[0];
    for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
    return{pts,cum,fam:st.fam,total:cum[cum.length-1]};
  });
  const lastPt=d=>d.pts[d.pts.length-1];
  // Segments (for crossing detection + ray counting)
  const SEG=[];
  data.forEach((d,si)=>{for(let i=0;i<d.pts.length-1;i++){
    const p=d.pts[i],q=d.pts[i+1];
    SEG.push({si,idx:i,p,q,s0:d.cum[i],len:d.cum[i+1]-d.cum[i],
      x0:Math.min(p[0],q[0]),x1:Math.max(p[0],q[0]),y0:Math.min(p[1],q[1]),y1:Math.max(p[1],q[1])});
  }});
  // Crossings (inclusive of shared vertices). `aInt`/`bInt` = the point lies INSIDE that
  // stroke's segment (→ a pass-through anchor); endpoint hits are covered by the end/corner anchors.
  const crossings=[];
  for(let i=0;i<SEG.length;i++){const A=SEG[i];
    for(let j=i+1;j<SEG.length;j++){const B=SEG[j];
      if(A.x1<B.x0-0.5||B.x1<A.x0-0.5||A.y1<B.y0-0.5||B.y1<A.y0-0.5)continue;
      if(A.si===B.si&&Math.abs(A.idx-B.idx)<=1)continue;
      const X=_segCross(A.p,A.q,B.p,B.q);if(!X)continue;
      crossings.push({x:A.p[0]+X.t*(A.q[0]-A.p[0]), y:A.p[1]+X.t*(A.q[1]-A.p[1]),
        aSi:A.si,aD:A.s0+X.t*A.len,aInt:X.t>1e-3&&X.t<1-1e-3,
        bSi:B.si,bD:B.s0+X.u*B.len,bInt:X.u>1e-3&&X.u<1-1e-3});
    }
  }
  // Sharp corners (per stroke, vertex indices)
  const corners=data.map(d=>{
    const cs=[];
    for(let i=1;i<d.pts.length-1;i++){
      const a=d.pts[i-1],b=d.pts[i],c=d.pts[i+1];
      let dd=Math.abs(Math.atan2(b[1]-a[1],b[0]-a[0])-Math.atan2(c[1]-b[1],c[0]-b[0]));
      if(dd>Math.PI)dd=2*Math.PI-dd;
      if(dd>CAD_STITCH_CORNER)cs.push(i);
    }
    return cs;
  });
  // ── Nodes: cluster the junction points (endpoints + sharp corners + crossings) on a grid.
  // Gentle curve vertices are NOT nodes, so curves keep long stitches. ──
  const mergeR=Math.max(0.5*L,5), CELL=mergeR, nodes=[], grid=new Map();
  const gk=(gx,gy)=>gx+','+gy;
  function findNode(x,y){
    const gx=Math.floor(x/CELL),gy=Math.floor(y/CELL);
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const arr=grid.get(gk(gx+a,gy+b));if(arr)for(const nd of arr)if(Math.hypot(nd.x-x,nd.y-y)<mergeR)return nd;}
    return null;
  }
  function addNode(x,y){
    let nd=findNode(x,y); if(nd)return nd;
    nd={x,y,bk:new Set(),clr:0}; nodes.push(nd);
    const k=gk(Math.floor(x/CELL),Math.floor(y/CELL)); if(!grid.has(k))grid.set(k,[]); grid.get(k).push(nd);
    return nd;
  }
  data.forEach((d,si)=>{addNode(d.pts[0][0],d.pts[0][1]);addNode(lastPt(d)[0],lastPt(d)[1]);corners[si].forEach(i=>addNode(d.pts[i][0],d.pts[i][1]));});
  crossings.forEach(c=>addNode(c.x,c.y));
  // ── Ray count: for every segment, add its direction(s) to the nodes it touches ──
  const BK=a=>{let x=((a%(2*Math.PI))+2*Math.PI)%(2*Math.PI);return Math.round(x/(Math.PI/12))%24;};
  SEG.forEach(sg=>{
    const ad=Math.atan2(sg.q[1]-sg.p[1],sg.q[0]-sg.p[0]), fwd=BK(ad), rev=BK(ad+Math.PI);
    const gx0=Math.floor((sg.x0-CELL)/CELL),gx1=Math.floor((sg.x1+CELL)/CELL);
    const gy0=Math.floor((sg.y0-CELL)/CELL),gy1=Math.floor((sg.y1+CELL)/CELL);
    const seen=new Set();
    for(let gx=gx0;gx<=gx1;gx++)for(let gy=gy0;gy<=gy1;gy++){const arr=grid.get(gk(gx,gy));if(!arr)continue;
      for(const nd of arr){ if(seen.has(nd))continue; seen.add(nd);
        if(!_segNear(sg.p,sg.q,nd.x,nd.y,mergeR))continue;
        const dS=Math.hypot(sg.p[0]-nd.x,sg.p[1]-nd.y), dE=Math.hypot(sg.q[0]-nd.x,sg.q[1]-nd.y);
        if(dS<mergeR)nd.bk.add(fwd); else if(dE<mergeR)nd.bk.add(rev); else{nd.bk.add(fwd);nd.bk.add(rev);}
      }}
  });
  nodes.forEach(nd=>{
    const R=nd.bk.size;
    // Star hubs: (0.36−0.06·ln R) calibrates the inscribed-circle formula to look right
    // across real patterns — factor 0.25 at R=6 (6-arm Asanoha), 0.20 at R=14 (Kamon).
    // _starHubScale (slider, default 1.0) is a final fine-tune multiplier.
    nd.clr = R<=2?0 : R<=4?cCross : Math.min(2.5*L, Math.max(cCross, _starHubScale*(0.36-0.06*Math.log(R))*L/(2*Math.tan(Math.PI/R))));
    // corner = exactly 2 rays at an angle (NOT collinear/straight, which is a smooth pass)
    nd.corner=false;
    if(R===2){const b=[...nd.bk];let diff=Math.abs(b[0]-b[1]);diff=Math.min(diff,24-diff);if(diff!==12)nd.corner=true;}
  });
  const clrAt=(x,y)=>{const nd=findNode(x,y);return nd?nd.clr:0;};
  // ── Anchors carry two side-clearances: clrL applies to the sub-run that STARTS here (gap
  // before its first stitch); clrR to the sub-run that ENDS here (gap after its last stitch).
  // A pure CORNER is asymmetric: the incoming stitch reaches it (clrR 0 — the thread dips
  // down exactly on the corner), then a normal standard gap before the next stitch (clrL = G);
  // only one stitch touches the corner. Junctions (crossing/star) and free ends are symmetric.
  const anchors=data.map(()=>[]);
  const endAnch=[];   // endpoint anchors tagged with node + side, for the corner pass below
  data.forEach((d,si)=>{
    const nd0=findNode(d.pts[0][0],d.pts[0][1]), a0={d:0,clrL:nd0?nd0.clr:0,clrR:nd0?nd0.clr:0};
    anchors[si].push(a0); endAnch.push({a:a0,nd:nd0,side:'start'});
    const ndT=findNode(lastPt(d)[0],lastPt(d)[1]), aT={d:d.total,clrL:ndT?ndT.clr:0,clrR:ndT?ndT.clr:0};
    anchors[si].push(aT); endAnch.push({a:aT,nd:ndT,side:'end'});
    corners[si].forEach(i=>{
      const nc=clrAt(d.pts[i][0],d.pts[i][1]);
      if(nc>0)anchors[si].push({d:d.cum[i],clrL:nc,clrR:nc});   // corner that is also a junction
      else anchors[si].push({d:d.cum[i],clrL:G,clrR:0});        // in-stroke corner: reach, then normal gap
    });
  });
  crossings.forEach(c=>{
    const nd=findNode(c.x,c.y), clr=nd?nd.clr:0;
    if(clr<=0)return;   // R≤2 corner/straight → handled by the corner/endpoint logic
    // Cut BOTH strokes at the junction regardless of whether the hit is interior or on a
    // vertex — this catches a line that runs straight THROUGH a star hub with a vertex at
    // the centre (otherwise it kept stitching across the keepout circle).
    anchors[c.aSi].push({d:c.aD,clrL:clr,clrR:clr});
    anchors[c.bSi].push({d:c.bD,clrL:clr,clrR:clr});
  });
  // Corner formed by two separate strokes meeting at a node: only ONE arm reaches the
  // corner (prefer the one that ENDS there); the rest get a normal gap. So exactly one
  // stitch touches the corner, then a standard gap — same look as an in-stroke corner.
  const byNode=new Map();
  endAnch.forEach(e=>{if(e.nd&&e.nd.corner){if(!byNode.has(e.nd))byNode.set(e.nd,[]);byNode.get(e.nd).push(e);}});
  byNode.forEach(arr=>{
    if(arr.length<2)return;
    let reach=arr.findIndex(e=>e.side==='end'); if(reach<0)reach=0;
    arr.forEach((e,i)=>{if(i===reach)return; if(e.side==='start')e.a.clrL=G; else e.a.clrR=G;});
  });
  // ── Lay stitches between consecutive anchors ──
  const out=[];
  data.forEach((d,si)=>{
    const an=anchors[si].filter(o=>o.d>=-1e-6&&o.d<=d.total+1e-6).sort((a,b)=>a.d-b.d);
    const m=[];
    for(const o of an){
      if(m.length&&o.d-m[m.length-1].d<=1e-3){const p=m[m.length-1];p.clrL=Math.max(p.clrL,o.clrL);p.clrR=Math.max(p.clrR,o.clrR);}
      else m.push({d:o.d,clrL:o.clrL,clrR:o.clrR});
    }
    for(let k=0;k<m.length-1;k++){
      const A=m[k],B=m[k+1];
      const S=(B.d-A.d)-A.clrL-B.clrR;          // span available for stitches+interior gaps
      if(S<=0.6)continue;                        // consumed by clearance → all denim
      const n=Math.max(1,Math.round((S+G)/U));
      const k2=S/(n*ratio.s+(n-1)*ratio.g), st=ratio.s*k2, gap=ratio.g*k2;
      for(let s=0;s<n;s++){
        const ds=A.d+A.clrL+s*(st+gap), de=ds+st;
        let P=_ptAlong(d,ds),Q=_ptAlong(d,de);
        const dx=Q[0]-P[0],dy=Q[1]-P[1],len=Math.hypot(dx,dy);
        if(len>2*cap+0.4){const ix=dx/len*cap,iy=dy/len*cap;P=[P[0]+ix,P[1]+iy];Q=[Q[0]-ix,Q[1]-iy];}
        out.push({x1:P[0],y1:P[1],x2:Q[0],y2:Q[1],fam:d.fam});
      }
    }
  });
  return out;
}
// Build (and cache) the off-white stitch list for the current geometry, fitted to the 500px canvas.
// Stitch length is anchored to the grid (so the per-line stitch count is invariant to the Tiles
// count) and the laid width is kept on the scene so the draw uses a matching width (see below).
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
  const pbb={minU:0,maxU:bbox.maxU-bbox.minU,minV:0,maxV:bbox.maxV-bbox.minV};
  const pat={type:'exp',gridType:cadGridType,lines,bbox:pbb,
    patMacro:patMacroForTiles({bbox:pbb},_cadTiles()),spacing:cadSpacing,bboxRotated:cadBBoxRotated,famOrder:[...cadFamOrder],routingMode:cadRoutingMode,embroidery:cadEmbroidery};
  pat.families=cadFamilies.filter((_,i)=>!redSet.has(i));
  const segs=genTiledSegs(pat);
  const fullPath=buildExpPath(segs,pat.famOrder,cadRoutingMode,{iso:cadGridType==='isometric',famRouting:cadFamRouting});
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
  const tf={g2s:lay.g2s,s2g:lay.s2g,ox,oy,sc};
  // Lay the stitches anchored to the layout scale at the NATURAL tile count (_cadRefMacro) —
  // the SAME reference the gallery uses (EXP_szRef) — so a given stitch-length value produces
  // the same look in the CAD editor and the gallery. (Anchoring to the live scale would make
  // the value scale-dependent; anchoring to the draw-canvas cadBase made CAD need ~2× the
  // gallery's value.) The reference is frozen at load, so the per-line stitch count also stays
  // invariant to the live Tiles count. Keep the laid width so the draw width matches the length.
  const refSz=(computeExpLayout({...pat,patMacro:patMacroForTiles(pat,_cadRefMacro)}).sz)||lay.sz;
  const r=(lay.sz*sc&&refSz)?lay.sz*sc/refSz:1;
  const L=Math.max(1,cadStitchLen*r);
  const w=Math.max(1,Math.min(6,L*0.22));
  return(_cadStitchCache={sig,stitches:_layStitches(strokes,L,cadStitchRatio,w),tf,ur:lay.uRange,vr:lay.vRange,w});
}
// Fabric grid overlay (main lines every CAD_MICRO + dot sub-grid), mapped through the stitch-scene transform.
// dotsOnly=true skips main lines, shows only dot grid (gallery stitch view uses this).
function _cadDrawStitchGrid(x,scene,dotsOnly,dark){
  if(!scene||!scene.tf)return;
  const tf=scene.tf,M=CAD_MICRO;
  const[mnU,mxU]=scene.ur,[mnV,mxV]=scene.vr;
  const S=(u,v)=>{const a=tf.g2s([u,v]);return[tf.ox+a.x*tf.sc,tf.oy+a.y*tf.sc];};
  const u0=Math.floor(mnU/M)*M,u1=Math.ceil(mxU/M)*M,v0=Math.floor(mnV/M)*M,v1=Math.ceil(mxV/M)*M;
  if(!dotsOnly){
    x.strokeStyle='rgba(220,235,255,0.22)';x.lineWidth=1;
    for(let u=u0;u<=u1;u+=M){const a=S(u,v0),b=S(u,v1);x.beginPath();x.moveTo(a[0],a[1]);x.lineTo(b[0],b[1]);x.stroke();}
    for(let v=v0;v<=v1;v+=M){const a=S(u0,v),b=S(u1,v);x.beginPath();x.moveTo(a[0],a[1]);x.lineTo(b[0],b[1]);x.stroke();}
  }
  // Dot sub-grid. dotsOnly (gallery viewer) mirrors the CAD draw canvas exactly: a dot at
  // every grid unit, larger dots at each CAD_MICRO cell point — i.e. CAD_MICRO sub-divisions
  // per cell, the same grid the pattern was drawn on. The CAD stitch view keeps the coarser
  // M/2 sub-grid (legibility on the fitted 500px canvas).
  const sub=dotsOnly?1:M/2;
  // Gallery grid (dotsOnly): plain dots as the foreground (threads are toned down in
  // grid/draft mode). Dots 50% smaller. On a LIGHT fabric (`dark`) the dots go dark so
  // they stay visible. CAD stitch-view keeps the original blue-ish dots.
  const colMain=dotsOnly?(dark?'rgba(28,40,66,0.9)':'rgba(255,255,255,0.95)'):'rgba(200,220,255,0.40)';
  const colSub =dotsOnly?(dark?'rgba(28,40,66,0.6)':'rgba(255,255,255,0.6)'):'rgba(180,205,255,0.20)';
  const rMain=dotsOnly?1.25:2.5, rSub=dotsOnly?0.6:1.2;
  // Grid phase: shift the dot lattice by the pattern's own grid phase (scene.phaseU/V, default
  // 0) so a motif whose vertices sit at a fractional offset (e.g. a 45°-rotated stone-wheel with
  // √2 coordinates) lands on the dots exactly as it does in the CAD editor — which re-centres the
  // bbox on an integer grid point. phase 0 (every integer-coordinate pattern) → integer grid,
  // byte-identical to before.
  const phU=scene.phaseU||0, phV=scene.phaseV||0;
  const su0=phU+Math.floor((u0-phU)/sub)*sub, sv0=phV+Math.floor((v0-phV)/sub)*sub;
  for(let u=su0;u<=u1;u+=sub){for(let v=sv0;v<=v1;v+=sub){
    const onMain=(Math.round(u-phU)%M===0)&&(Math.round(v-phV)%M===0);
    const p=S(u,v);
    x.fillStyle=onMain?colMain:colSub;
    x.beginPath();x.arc(p[0],p[1],onMain?rMain:rSub,0,Math.PI*2);x.fill();
  }}
}
// CAD-editor grid (SEPARATE from the gallery's _cadDrawStitchGrid so the two views can be
// tuned independently). Two differences the editor wants: (1) it covers the WHOLE 500px
// canvas — the grid range is found by inverse-mapping the canvas corners, not the pattern's
// own extent (which left margins); (2) the caller draws the stitches at FULL contrast (the
// gallery subdues them under the grid; the editor does not). White dot grid, dot at every
// grid unit, larger dot at each CAD_MICRO cell point.
function _cadEditorGrid(x,scene){
  if(!scene||!scene.tf||!scene.tf.s2g)return;
  const tf=scene.tf,M=CAD_MICRO;
  const inv=(sx,sy)=>tf.s2g((sx-tf.ox)/tf.sc,(sy-tf.oy)/tf.sc);   // screen → grid
  const cs=[inv(0,0),inv(500,0),inv(500,500),inv(0,500)];
  let mnU=Infinity,mxU=-Infinity,mnV=Infinity,mxV=-Infinity;
  cs.forEach(c=>{mnU=Math.min(mnU,c[0]);mxU=Math.max(mxU,c[0]);mnV=Math.min(mnV,c[1]);mxV=Math.max(mxV,c[1]);});
  if(!isFinite(mnU))return;
  const S=(u,v)=>{const a=tf.g2s([u,v]);return[tf.ox+a.x*tf.sc,tf.oy+a.y*tf.sc];};
  const u0=Math.floor(mnU/M)*M,u1=Math.ceil(mxU/M)*M,v0=Math.floor(mnV/M)*M,v1=Math.ceil(mxV/M)*M;
  if((u1-u0)/1>4000||(v1-v0)/1>4000)return;   // sanity guard
  for(let u=u0;u<=u1;u++)for(let v=v0;v<=v1;v++){
    const p=S(u,v);
    if(p[0]<-4||p[0]>504||p[1]<-4||p[1]>504)continue;
    const onMain=(u%M===0)&&(v%M===0);
    // On a LIGHT fabric (e.g. Natural) white dots vanish — draw them dark instead
    // (same adaptation as the gallery's _cadDrawStitchGrid dark mode).
    const dark=_fabricById(_cadFabricId()).light;
    x.fillStyle=dark?(onMain?'rgba(28,42,72,0.9)':'rgba(28,42,72,0.55)')
                    :(onMain?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.6)');
    x.beginPath();x.arc(p[0],p[1],onMain?1.25:0.6,0,Math.PI*2);x.fill();
  }
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
  x.clearRect(0,0,500,500);_cadDrawFabricBg(x);
  const sc=_cadStitchScene();
  // Grid is always on in the CAD Live Tiling, covering the whole canvas; stitches stay at
  // FULL contrast (subduing-under-grid is a gallery-only feature). Draw with the LAID width
  // (sc.w) so stitch width matches stitch length — same as the gallery.
  _cadEditorGrid(x,sc);
  sc.stitches.forEach(s=>_cadDrawStitch(x,s,sc.w,_cadThreadColor(s.fam)));
}
window.cadToggleStitchView=function(){
  if(_tpOn)_stopTilePlay();
  cadStitchView=document.getElementById('cadStitchToggle').checked;
  document.getElementById('cadStitchControls').style.display=cadStitchView?'flex':'none';
  cadDrawPattern();
};
window.cadSetStitchLen=function(v){
  cadStitchLen=parseInt(v)||8;
  const el=document.getElementById('cadStitchLenVal');if(el)el.textContent=cadStitchLen;
  _cadStitchCache=null;
  if(!_tpOn)cadDrawPattern();
};
// +/− stepper (replaces the old slider); clamp 1–40, default 8.
window.cadStepStitchLen=function(dir){window.cadSetStitchLen(Math.max(1,Math.min(40,cadStitchLen+dir)));};
window.cadSetStitchRatio=function(v){
  cadStitchRatio=v;_cadStitchCache=null;
  if(!_tpOn)cadDrawPattern();
};
window.cadSetHubScale=function(v){
  _starHubScale=parseFloat(v)/100;
  const lbl=s=>s&&(s.textContent=_starHubScale.toFixed(2)+'×');
  lbl(document.getElementById('cadHubScaleVal'));
  lbl(document.getElementById('galHubScaleVal'));
  const gs=document.getElementById('galHubScale');if(gs)gs.value=v;
  _cadStitchCache=null;if(!_tpOn)cadDrawPattern();
};
window.cadToggleStitchGrid=function(){
  cadStitchGrid=document.getElementById('cadStitchGrid').checked;
  if(!_tpOn)cadDrawPattern();else _renderTileFrame();
};
// Reflect the current stitch params (view/len/ratio) into the stitch-view controls. Called by the
// load/reset paths (editExpPattern/remixPattern/showCAD) so a pattern's saved stitch settings are
// restored in the editor — otherwise re-editing resets them to defaults and a save overwrites them.
function _cadSyncStitchUI(){
  const t=document.getElementById('cadStitchToggle'); if(t)t.checked=cadStitchView;
  const sc=document.getElementById('cadStitchControls'); if(sc)sc.style.display=cadStitchView?'flex':'none';
  const lv=document.getElementById('cadStitchLenVal'); if(lv)lv.textContent=cadStitchLen;
  const r=document.getElementById('cadStitchRatio'); if(r)r.value=cadStitchRatio;
  // Coloured-thread toggle + fabric picker: community patterns only (traditional
  // keep off-white thread on the classic denim).
  const cw=document.getElementById('cadStitchColorsWrap'); if(cw)cw.style.display=cadCommunity?'':'none';
  const cc=document.getElementById('cadStitchColors'); if(cc)cc.checked=cadStitchColors;
  const fw=document.getElementById('cadFabricWrap'); if(fw)fw.style.display=cadCommunity?'':'none';
  const fs=document.getElementById('cadFabric'); if(fs)fs.value=cadFabric;
}
window.cadSetFabric=function(v){
  cadFabric=_fabricById(v).id;   // sanitise to a known id
  cadDrawPattern();              // instant background swap in the stitch view
};
window.cadToggleStitchColors=function(){
  cadStitchColors=document.getElementById('cadStitchColors').checked;
  cadDrawPattern();
};
// Thread colour for one stitch in the CAD stitch view: custom family colour when the
// community "Coloured thread" toggle is on, else the classic off-white yarn.
function _cadThreadColor(fam){
  return (cadCommunity&&cadStitchColors&&cadFamColors[fam])||undefined;
}
window.cadSetSpeed=function(v){_cadSpeedV=parseInt(v)||0;};

function cadGetPos(e,cv){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*500/r.width,y:(e.clientY-r.top)*500/r.height};}
function cadInit(){
  if(cadInited)return;cadInited=true;
  const cv=document.getElementById('cadCanvas');
  cadUpdateSettings();
  _cadRefMacro=cadPatMacro;   // freeze the stitch-length reference at the loaded tile count
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
    // Alt+drag moves the background sketch image (free, fractional — for fitting it to the grid).
    if(cadBgImg&&e.altKey&&e.button===0){
      const gb=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
      cadBgDrag={u:gb.u-cadBgU,v:gb.v-cadBgV};
      cv.style.cursor='move';return;
    }
    const g=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
    cadCur=cadSnapPoint(g.u,g.v);
    if(cadTool==='draw'){
      if(cadFamSel>=0){
        const hit=cadHoveredSeg(g.u,g.v);
        if(hit&&hit.li>=0&&cadFamSel<cadFamOrder.length){cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});cadFamilies[hit.li]=cadFamOrder[cadFamSel];cadFamsLocked=true;cadUpdateAll();return;}
      }
      // Click-move-click (like the arc tool): first click sets the start, second click commits the line.
      if(!cadDrawing){
        cadDrawing=true;cadStart=[cadCur[0],cadCur[1]];
      }else{
        if(cadStart&&cadCur&&(cadStart[0]!==cadCur[0]||cadStart[1]!==cadCur[1])){
          cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
          cadLines.push({start:cadStart,end:cadCur});
          cadFamsLocked=false;cadFamSel=-1;cadAutoExtendGrid();
        }
        cadDrawing=false;cadStart=null;
      }
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
      else if(cadArcState===1){
        cadArcStart=[...cadCur];cadArcState=2;
        cadArcSweep=0;cadArcPrevAng=Math.atan2(cadArcStart[1]-cadArcCenter[1],cadArcStart[0]-cadArcCenter[0]);
      }
      else if(cadArcState===2){
        cadHistory.push({l:JSON.parse(JSON.stringify(cadLines)),f:[...cadFamilies]});
        const newArc=cadGenArcSweep(cadArcCenter,cadArcStart,cadArcSweep);
        if(newArc)cadLines.push(newArc);
        cadFamsLocked=false;cadFamSel=-1;
        cadArcState=0;cadArcCenter=null;cadArcStart=null;cadArcSweep=0;
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
      cadHover=null;cadFamsLocked=false;cadFamSel=-1;cadAutoShrinkGrid();
    }
    cadUpdateAll();
  });
  cv.addEventListener('pointermove',e=>{
    const pos=cadGetPos(e,cv);
    if(cadPanning){cadPanX+=pos.x-cadPanStart.x;cadPanY+=pos.y-cadPanStart.y;cadPanStart=pos;cadApplyView();cadBakeLeft();cadUpdateAll();return;}
    if(cadBgDrag){
      const gb=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
      cadBgU=gb.u-cadBgDrag.u;cadBgV=gb.v-cadBgDrag.v;
      cadDrawWorkspace();return;
    }
    const g=cadS2G(pos.x,pos.y,cadOX,cadOY,cadTileSize);
    if(cadTool==='draw'||cadTool==='arc')cadCur=cadSnapPoint(g.u,g.v);
    // Arc: after the radius click, accumulate the sweep continuously as the mouse circles the
    // centre — so the arc can be any size and close a full circle whichever way you go round.
    if(cadTool==='arc'&&cadArcState===2&&cadArcCenter){
      const ang=Math.atan2(g.v-cadArcCenter[1],g.u-cadArcCenter[0]);
      let d=ang-cadArcPrevAng; while(d>Math.PI)d-=2*Math.PI; while(d<=-Math.PI)d+=2*Math.PI;
      cadArcSweep=Math.max(-2*Math.PI,Math.min(2*Math.PI,cadArcSweep+d)); cadArcPrevAng=ang;
    }
    else if(cadTool==='recolor'){cadHover=cadHoveredSeg(g.u,g.v);cv.style.cursor=cadHover?'pointer':'default';}
    else{cadHover=cadHoveredSeg(g.u,g.v);cv.style.cursor=cadHover?'pointer':'default';}
    cadUpdateAll();
  });
  cv.addEventListener('pointerup',e=>{
    if(cadBgDrag){cadBgDrag=null;cv.style.cursor='crosshair';cv.releasePointerCapture(e.pointerId);return;}
    if(cadPanning){cadPanning=false;cv.style.cursor='crosshair';cv.releasePointerCapture(e.pointerId);return;}
    // Draw is now click-move-click (committed on the second pointerdown), so pointerup no longer
    // finishes a line — it only releases the pointer capture.
    cv.releasePointerCapture(e.pointerId);
  });
  // Keep an in-progress draw/arc alive when the cursor leaves the canvas (matches the arc tool):
  // only clear the live preview point + hover, not the pending start.
  cv.addEventListener('pointerleave',()=>{cadCur=null;cadHover=null;cadUpdateAll();});
  document.addEventListener('keydown',e=>{
    if(!document.getElementById('cadView').classList.contains('open'))return;
    if(e.ctrlKey&&(e.key==='z'||e.key==='Z'))cadUndo();
    if(e.key==='Escape'&&cadTool==='arc'){cadArcState=0;cadArcCenter=null;cadArcStart=null;cadArcSweep=0;cadArcLabel();cadUpdateAll();}
    if(e.key==='Escape'&&cadTool==='draw'){cadDrawing=false;cadStart=null;cadUpdateAll();}
  });
  if(!_cadResizeBound){_cadResizeBound=true;window.addEventListener('resize',()=>{if(document.getElementById('cadView').classList.contains('open'))cadAlignHeads();});}
  cadAlignHeads();
}
// Make the Draw and Live-Tiling canvases line up: equalise the two pre-canvas heads to the
// taller one (toolbar wrapping varies with viewport width, so measure rather than hard-code).
let _cadResizeBound=false;
function cadAlignHeads(){
  const heads=[...document.querySelectorAll('#cadView .cad-panel-head')];
  if(heads.length<2)return;
  heads.forEach(h=>{h.style.minHeight='0px';});
  const mx=Math.max(...heads.map(h=>h.getBoundingClientRect().height));
  heads.forEach(h=>{h.style.minHeight=mx+'px';});
}

// ── Admin toolbar rearrange (drag-and-drop) ──────────────────────────────────
// Every tool in the CAD toolbars (`.cad-toolbar[data-dragzone]` → its `[data-did]` children)
// is draggable when signed in as admin; dropping reorders it within its toolbar. The GLOBAL
// layout everyone sees lives in the repo (cad-toolbar.json → CAD_TOOLBAR_LAYOUT, baked in at
// build). An admin's drag persists to a localStorage draft; to publish it for everyone, run
// sashikoToolbarLayout(), paste into cad-toolbar.json, and push (see _cadSaveToolbarOrder).
let _cadTbDrag=null;
function _cadTbZones(){return document.querySelectorAll('.cad-toolbar[data-dragzone]');}
function _cadTbItems(zone){return zone.querySelectorAll(':scope > [data-did]');}
function _cadTbCollect(){const o={};_cadTbZones().forEach(z=>{o[z.dataset.dragzone]=[..._cadTbItems(z)].map(el=>el.dataset.did);});return o;}
function _cadTbApply(order){
  if(!order)return;
  _cadTbZones().forEach(z=>{
    const dids=order[z.dataset.dragzone]; if(!Array.isArray(dids)||!dids.length)return;
    dids.forEach(did=>{const el=z.querySelector(':scope > [data-did="'+did+'"]'); if(el)z.appendChild(el);});
  });
}
function _cadTbSetDraggable(on){_cadTbZones().forEach(z=>_cadTbItems(z).forEach(el=>{el.draggable=!!on;}));}
function _cadInitToolbarDrag(){
  _cadTbZones().forEach(z=>_cadTbItems(z).forEach(item=>{
    if(item._tbw)return; item._tbw=true;
    item.addEventListener('dragstart',e=>{
      if(!document.body.classList.contains('is-admin')){e.preventDefault();return;}
      _cadTbDrag=item; e.dataTransfer.effectAllowed='move';
      try{e.dataTransfer.setData('text/plain',item.dataset.did);}catch(_){}
      item.classList.add('cad-tb-dragging');
    });
    item.addEventListener('dragend',()=>{item.classList.remove('cad-tb-dragging');document.querySelectorAll('.cad-tb-over').forEach(el=>el.classList.remove('cad-tb-over'));_cadTbDrag=null;});
    item.addEventListener('dragover',e=>{
      if(!document.body.classList.contains('is-admin')||!_cadTbDrag||_cadTbDrag===item||_cadTbDrag.parentNode!==item.parentNode)return;
      e.preventDefault(); item.classList.add('cad-tb-over');
    });
    item.addEventListener('dragleave',()=>item.classList.remove('cad-tb-over'));
    item.addEventListener('drop',e=>{
      item.classList.remove('cad-tb-over');
      if(!document.body.classList.contains('is-admin')||!_cadTbDrag||_cadTbDrag===item||_cadTbDrag.parentNode!==item.parentNode){_cadTbDrag=null;return;}
      e.preventDefault();
      const r=item.getBoundingClientRect(), after=(e.clientX-r.left)>r.width/2;
      item.parentNode.insertBefore(_cadTbDrag, after?item.nextSibling:item);
      _cadTbDrag=null; _cadSaveToolbarOrder();
    });
  }));
  _cadTbSetDraggable(document.body.classList.contains('is-admin'));
}
// The global layout lives in the repo (cad-toolbar.json, baked in at build) — only the owner
// can push it, everyone sees it. An admin's in-browser drag persists to localStorage as a local
// draft; to publish it for everyone, run sashikoToolbarLayout() and commit the result to
// cad-toolbar.json (browsers can't push to GitHub, so publishing is a commit, not a live sync).
function _cadSaveToolbarOrder(){try{localStorage.setItem('sashiko_cadtoolbar',JSON.stringify(_cadTbCollect()));}catch(_){}}
function _cadApplyToolbarCache(){try{const c=JSON.parse(localStorage.getItem('sashiko_cadtoolbar')||'null'); if(c)_cadTbApply(c);}catch(_){}}
window._cadTbSetDraggable=_cadTbSetDraggable;
function _cadCopyText(text){
  const legacy=()=>new Promise((res,rej)=>{try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');document.body.removeChild(ta);ok?res():rej();}catch(e){rej(e);}});
  if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(text).catch(legacy);
  return legacy();
}
// Admin export: copy the current toolbar layout to paste into cad-toolbar.json (→ global on push).
window.sashikoToolbarLayout=function(){
  const o=_cadTbCollect(), json=JSON.stringify(o);
  _cadCopyText(json).catch(()=>{});
  console.log('CAD toolbar layout — copied. Paste into cad-toolbar.json and push to publish for everyone:\n'+json);
  return o;
};
// Admin-only header button: copy the current toolbar layout, with feedback on the button itself.
window.cadCopyToolbarLayout=function(){
  const json=JSON.stringify(_cadTbCollect());
  const btn=document.getElementById('cadCopyLayoutBtn');
  console.log('CAD toolbar layout:\n'+json);
  _cadCopyText(json).then(()=>{if(btn){btn.textContent='✓ Copied';setTimeout(()=>{btn.textContent='📋 Copy layout';},2000);}}).catch(()=>{});
  // Guaranteed path: show the code pre-selected in a prompt so it can always be copied (Ctrl/Cmd+C)
  // and pasted anywhere — e.g. straight into the chat with Claude, or into cad-toolbar.json.
  window.prompt('Toolbar layout — copy this (Ctrl/Cmd+C) and paste it to Claude, or into cad-toolbar.json:', json);
};

// ── Init ───────────────────────────────────────────────────────────────────
document.getElementById('cadView').classList.remove('open');
document.getElementById('animView').classList.remove('open');
document.getElementById('myPatsView').classList.remove('open');
document.getElementById('galleryView').style.display='block';
initGenUI();
initAnimZoom();
_cadInitToolbarDrag();
if(typeof CAD_TOOLBAR_LAYOUT!=='undefined')_cadTbApply(CAD_TOOLBAR_LAYOUT);   // committed global layout (everyone)
_cadApplyToolbarCache();                                                      // admin's local draft overrides
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
