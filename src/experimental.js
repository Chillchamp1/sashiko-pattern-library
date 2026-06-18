// ── Firebase config — paste your firebaseConfig values here ─────────────────
// Get these from: Firebase Console → Project Settings → Your apps → Web app
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAUk0RJKsZYaI5K6ixr7tBGe3yxmwBbWgk",
  authDomain:        "sashiko-library.firebaseapp.com",
  projectId:         "sashiko-library",
  storageBucket:     "sashiko-library.firebasestorage.app",
  messagingSenderId: "478200546173",
  appId:             "1:478200546173:web:1b2b0f3fb98ef969600214"
};
// ─────────────────────────────────────────────────────────────────────────────

let EXP_PATTERNS=[];
let _db=null;   // Firestore instance, set after SDK loads
let _firebaseReady=false;

// ── EXP animation state ──────────────────────────────────────────────────────
let EXP_path=[];       // [{start:[u,v], end:[u,v], jump:bool}]
let EXP_g2s=null;      // grid→screen fn (set by setupExpCanvas)
let EXP_canvasH=SIZE;  // canvas height in CSS px (SIZE for square, SIZE/√3 for iso)

// ── Firebase bootstrap ───────────────────────────────────────────────────────
function _initFirebase(){
  if(_firebaseReady||FIREBASE_CONFIG.apiKey.startsWith('PASTE'))return;
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    _db=firebase.firestore();
    _firebaseReady=true;
  }catch(e){console.warn('Firebase init failed:',e);}
}

// ── Persistence helpers ──────────────────────────────────────────────────────
// localStorage is always kept as a local cache so the page works offline.
function _saveLocal(){
  // Don't cache thumbnails in Firestore (too large); keep them only in localStorage.
  try{localStorage.setItem('sashiko_exp',JSON.stringify(EXP_PATTERNS));}catch(e){}
}
function _loadLocal(){
  try{EXP_PATTERNS=JSON.parse(localStorage.getItem('sashiko_exp')||'[]');}catch(e){EXP_PATTERNS=[];}
}

// Upload a single pattern to Firestore (thumbnail stored separately via data URL → stripped before upload)
async function _pushToFirestore(pat){
  if(!_db)return;
  // Strip thumbnail before storing — too large for Firestore (1 MB doc limit).
  // We store the thumbnail only in localStorage on the creating device.
  const doc={...pat};delete doc.thumbnail;
  try{
    await _db.collection('patterns').doc(pat.id).set(doc);
  }catch(e){console.warn('Firestore write failed:',e);}
}

async function _deleteFromFirestore(id){
  if(!_db)return;
  try{await _db.collection('patterns').doc(id).delete();}catch(e){console.warn('Firestore delete failed:',e);}
}

// Fetch all patterns from Firestore, merge with local thumbnail cache.
async function _fetchFromFirestore(){
  if(!_db)return;
  try{
    const snap=await _db.collection('patterns').orderBy('createdAt','desc').get();
    const remote=snap.docs.map(d=>d.data());
    // Merge: remote is the truth, but re-attach thumbnails from local cache where available.
    const localMap=Object.fromEntries(EXP_PATTERNS.map(p=>[p.id,p.thumbnail]));
    EXP_PATTERNS=remote.map(p=>({...p,thumbnail:localMap[p.id]||null}));
    _saveLocal();
  }catch(e){console.warn('Firestore fetch failed, using local cache:',e);}
}

// ── Public API ───────────────────────────────────────────────────────────────
function loadExpPatterns(){
  _loadLocal();
  _initFirebase();
  // Async fetch from Firestore; updates UI once done
  if(_firebaseReady){
    _fetchFromFirestore().then(()=>rebuildMyPatsView());
  }
}

async function saveExpPatterns(pat){
  // pat is the pattern being added; for deletes use removeExpPattern
  _saveLocal();
  if(_firebaseReady&&pat)await _pushToFirestore(pat);
}

// ── EXP layout & animation helpers ───────────────────────────────────────────
const _COS30=Math.cos(Math.PI/6), _SIN30=Math.sin(Math.PI/6);

// Inward half-planes {n,c} for a convex polygon; a point X is inside ⟺ n·X ≤ c for all.
function convexPlanes(poly){
  let cx=0,cy=0; poly.forEach(p=>{cx+=p[0];cy+=p[1];}); cx/=poly.length; cy/=poly.length;
  return poly.map((a,i)=>{
    const b=poly[(i+1)%poly.length];
    let nx=-(b[1]-a[1]), ny=(b[0]-a[0]);              // normal to edge a→b
    if(nx*(cx-a[0])+ny*(cy-a[1])>0){nx=-nx;ny=-ny;}   // point it OUTWARD (away from centroid)
    return{n:[nx,ny], c:nx*a[0]+ny*a[1]};
  });
}
// Clip segment p0→p1 to the convex region (Liang–Barsky); return [q0,q1] or null if fully outside.
function clipSegConvex(p0,p1,planes){
  let te=0, tl=1; const dx=p1[0]-p0[0], dy=p1[1]-p0[1];
  for(const {n,c} of planes){
    const d0=n[0]*p0[0]+n[1]*p0[1]-c, den=n[0]*dx+n[1]*dy;
    if(Math.abs(den)<1e-12){ if(d0>1e-9)return null; continue; }
    const t=-d0/den;
    if(den>0){ if(t<tl)tl=t; } else { if(t>te)te=t; }
    if(te>tl)return null;
  }
  const q0=[p0[0]+te*dx,p0[1]+te*dy], q1=[p0[0]+tl*dx,p0[1]+tl*dy];
  if(Math.hypot(q1[0]-q0[0],q1[1]-q0[1])<1e-6)return null;
  return [q0,q1];
}

// Pure: square tiled-view layout. BOTH grids fill the full SIZE×SIZE square; the isometric
// lattice is tiled and clipped to the square (no inscribed-diamond gaps). `planes` = the
// visible square expressed as a convex region in grid (u,v) space (for clipping + iso "along
// the grid lines" routing, which happens in (u,v)).
function computeExpLayout(pat){
  const ptc=(pat.patMacro||5)*10;                 // micro-units across the canvas
  const iso=pat.gridType==='isometric';
  const canvasH=SIZE;                             // always square
  let sz,ox,oy;
  if(iso){ sz=SIZE/(2*ptc*_COS30); ox=SIZE/2; oy=0; }
  else   { sz=SIZE/ptc;            ox=0;      oy=0; }
  function g2s(p){const u=p[0],v=p[1];
    if(iso)return{x:ox+(u-v)*sz*_COS30, y:oy+(u+v)*sz*_SIN30};
    return{x:ox+u*sz, y:oy+v*sz};}
  function s2g(x,y){
    if(iso){const a=(x-ox)/(sz*_COS30), b=(y-oy)/(sz*_SIN30); return [(a+b)/2,(b-a)/2];}
    return [(x-ox)/sz,(y-oy)/sz];}
  const corners=[s2g(0,0),s2g(SIZE,0),s2g(SIZE,canvasH),s2g(0,canvasH)];
  let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
  corners.forEach(c=>{minU=Math.min(minU,c[0]);maxU=Math.max(maxU,c[0]);minV=Math.min(minV,c[1]);maxV=Math.max(maxV,c[1]);});
  return{sz,ox,oy,canvasH,g2s,s2g,ptc,iso,corners,planes:convexPlanes(corners),uRange:[minU,maxU],vRange:[minV,maxV]};
}

// ── Symmetry family detection ──────────────────────────────────────────────
// Analyses the unit cell: lines that connect across tile boundaries (and
// are therefore symmetric counterparts) form one family — routed together as zigzag.
//
// For each pair of lines (i,j) we test all 8 neighbouring tile-offsets (±dU,±dV).
// If end(i) ≈ start(j)+offset (within threshold), they connect → same family.
// Connected components = families.  Unconnected lines stay solo families.
// Families are ordered by their smallest line-index (foundation rule).
function detectSymmetryFamilies(pat){
  const lines=pat.lines||[];
  if(lines.length<=1)return lines.map((_,i)=>[i]);

  const bbox=pat.bbox||{minU:0,maxU:10,minV:0,maxV:10};
  const dU=Math.max(bbox.maxU-bbox.minU,1), dV=Math.max(bbox.maxV-bbox.minV,1);
  const THRESH=0.8;  // grid-unit connection threshold

  const n=lines.length;
  const parent=[...Array(n).keys()];
  function find(x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
  function union(a,b){a=find(a);b=find(b);if(a!==b)parent[b]=a;}

  for(let i=0;i<n;i++){
    const la=lines[i];
    for(let j=i+1;j<n;j++){
      const lb=lines[j];
      // Is line i's end near line j's start (or vice versa) under some tile offset?
      let connected=false;
      for(let du=-dU;du<=dU;du+=dU){
        for(let dv=-dV;dv<=dV;dv+=dV){
          const sx=lb.start[0]+du-la.end[0], sy=lb.start[1]+dv-la.end[1];
          if(Math.hypot(sx,sy)<THRESH){connected=true;break;}
          const ex=la.start[0]+du-lb.end[0], ey=la.start[1]+dv-lb.end[1];
          if(Math.hypot(ex,ey)<THRESH){connected=true;break;}
        }
        if(connected)break;
      }
      if(connected)union(i,j);
    }
  }

  // Build families from connected components, order by min line-index
  const groups=new Map();
  for(let i=0;i<n;i++){
    const r=find(i);
    if(!groups.has(r))groups.set(r,[]);
    groups.get(r).push(i);
  }
  return [...groups.values()].sort((a,b)=>Math.min(...a)-Math.min(...b));
}

// ── Tiled segments (with symmetry-family assignment) ───────────────────────
function genTiledSegs(pat){
  const lay=computeExpLayout(pat);
  const bbox=pat.bbox||{minU:0,maxU:10,minV:0,maxV:10};
  const dU=Math.max(bbox.maxU-bbox.minU,1), dV=Math.max(bbox.maxV-bbox.minV,1);
  const [minU,maxU]=lay.uRange, [minV,maxV]=lay.vRange;
  const ou0=Math.floor((minU-bbox.maxU)/dU)*dU, ou1=Math.ceil((maxU-bbox.minU)/dU)*dU;
  const ov0=Math.floor((minV-bbox.maxV)/dV)*dV, ov1=Math.ceil((maxV-bbox.minV)/dV)*dV;
  const families=pat.families||detectSymmetryFamilies(pat);
  const nLines=(pat.lines||[]).length;
  const famOfLine=new Array(nLines);
  // Handle both flat format [0,0,-1,2] and array-of-arrays [[0,2],[1]]
  if(families.length>0&&Array.isArray(families[0])){
    families.forEach((group,fi)=>{group.forEach(li=>{famOfLine[li]=fi;});});
  }else{
    families.forEach((fi,li)=>{famOfLine[li]=fi;});
  }
  // Unassigned lines (-1 or undefined) each get their own family
  let nextFam=Math.max(0,...famOfLine.filter(f=>f>=0))+1;
  for(let li=0;li<nLines;li++){
    if(famOfLine[li]===undefined||famOfLine[li]<0)famOfLine[li]=nextFam++;
  }
  const segs=[];
  for(let ou=ou0;ou<=ou1;ou+=dU){
    for(let ov=ov0;ov<=ov1;ov+=dV){
      (pat.lines||[]).forEach((l,li)=>{
        const c=clipSegConvex([l.start[0]+ou,l.start[1]+ov],[l.end[0]+ou,l.end[1]+ov],lay.planes);
        if(c)segs.push({start:c[0],end:c[1],fam:famOfLine[li]});
      });
    }
  }
  return segs;
}

// Resize cv for this exp pattern, store EXP_g2s/EXP_canvasH, re-apply DPR scale.
function setupExpCanvas(pat){
  const lay=computeExpLayout(pat);
  EXP_g2s=lay.g2s; EXP_canvasH=lay.canvasH;
  cv.height=EXP_canvasH*DPR; cv.style.height=EXP_canvasH+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
}

// ── Family editor (unit cell, inside Stitching Order Settings) ──────────
let _famSel=0, _famCount=0;
function initExpFamilies(pat){
  if(!pat.families)pat.families=new Array((pat.lines||[]).length).fill(-1);
}

// Find lines that are redundant (exact duplicates or collinear overlaps)
function findRedundant(lines){
  if(!lines||lines.length<2)return[];
  const Q=1e-4, PERP_THRESH=0.5; const redundant=new Set();
  for(let i=0;i<lines.length;i++){
    const a=lines[i];
    const dxA=a.end[0]-a.start[0], dyA=a.end[1]-a.start[1];
    const lenA=Math.hypot(dxA,dyA); if(lenA<Q)continue;
    const ndxA=dxA/lenA, ndyA=dyA/lenA;
    for(let j=i+1;j<lines.length;j++){
      const b=lines[j];
      const dxB=b.end[0]-b.start[0], dyB=b.end[1]-b.start[1];
      const lenB=Math.hypot(dxB,dyB); if(lenB<Q)continue;
      const dot=ndxA*(dxB/lenB)+ndyA*(dyB/lenB);
      if(Math.abs(Math.abs(dot)-1)>Q)continue;
      // Must lie on the same line: perpendicular distance of both B endpoints to A's line < threshold
      function perpDist(p){return Math.abs((p[0]-a.start[0])*ndyA-(p[1]-a.start[1])*ndxA);}
      if(perpDist(b.start)>PERP_THRESH||perpDist(b.end)>PERP_THRESH)continue;
      // Project onto shared line and check overlap
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
function toggleStitchSettings(){
  const body=document.getElementById('stitchBody');
  const tog=document.getElementById('stitchToggle');
  if(!body||!tog)return;
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  tog.textContent=open?'⚙ Stitching Order Settings ▸':'⚙ Stitching Order Settings ▾';
  tog.classList.toggle('on',!open);
  if(!open)renderFamEditor();
}
window.toggleStitchSettings=toggleStitchSettings;
function renderFamEditor(){
  if(!curPat||curPat.type!=='exp')return;
  const fc=document.getElementById('famCanvas');
  const sw=document.getElementById('famSwatches');
  const body=document.getElementById('stitchBody');
  if(!fc||!sw||!body)return;
  if(body.style.display==='none')return;
  initExpFamilies(curPat);
  const lines=curPat.lines||[];
  const fams=curPat.families;
  const FW=180,FH=180;

  // Sync _famCount: highest assigned family + 1, minimum 0
  const assigned=fams.filter(f=>f>=0);
  _famCount=Math.max(5,assigned.length?Math.max(...assigned)+1:0);

  const x=fc.getContext('2d');
  fc.width=FW;fc.height=FH;
  x.fillStyle='#1a3a5c';x.fillRect(0,0,FW,FH);

  if(!lines.length){sw.innerHTML='';return;}

  const iso=curPat.gridType==='isometric';
  const COS30=Math.cos(Math.PI/6),SIN30=Math.sin(Math.PI/6);
  function toScr(u,v){
    if(iso)return{x:(u-v)*COS30,y:(u+v)*SIN30};
    return{x:u,y:v};
  }
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  lines.forEach(l=>{[l.start,l.end].forEach(p=>{const s=toScr(p[0],p[1]);minX=Math.min(minX,s.x);maxX=Math.max(maxX,s.x);minY=Math.min(minY,s.y);maxY=Math.max(maxY,s.y);});});
  const cellW=maxX-minX||1,cellH=maxY-minY||1;
  const pad=16,sc=Math.min((FW-2*pad)/cellW,(FH-2*pad)/cellH);
  const ox=(FW-cellW*sc)/2-minX*sc,oy=(FH-cellH*sc)/2-minY*sc;

  fc._famHit=lines.map((l,li)=>{
    const p1=toScr(l.start[0],l.start[1]),p2=toScr(l.end[0],l.end[1]);
    return{sx:ox+p1.x*sc,sy:oy+p1.y*sc,ex:ox+p2.x*sc,ey:oy+p2.y*sc,li};
  });

  // Draw lines (gray if unassigned, family colour if assigned)
  x.lineWidth=3.5;x.lineCap='round';
  lines.forEach((l,li)=>{
    const fi=fams[li];
    x.strokeStyle=fi>=0?famColor(fi):'#556677';
    const h=fc._famHit[li];
    x.beginPath();x.moveTo(h.sx,h.sy);x.lineTo(h.ex,h.ey);x.stroke();
  });

  // Redundancy overlay
  const redundant=findRedundant(lines);
  if(redundant.length){
    x.lineWidth=2;x.strokeStyle='#ff3333';x.setLineDash([3,3]);
    redundant.forEach(li=>{
      const h=fc._famHit[li];
      x.beginPath();x.moveTo(h.sx,h.sy);x.lineTo(h.ex,h.ey);x.stroke();
    });
    x.setLineDash([]);
  }

  // Build swatches
  sw.innerHTML='';
  for(let f=0;f<_famCount;f++){
    const b=document.createElement('button');
    b.className='fam-swatch'+(f===_famSel?' sel':'');
    b.style.background=famColor(f);
    b.title='Family '+(f+1);
    b.onclick=e=>{e.stopPropagation();_famSel=f;renderFamEditor();};
    sw.appendChild(b);
  }
  const add=document.createElement('button');
  add.className='fam-swatch add';
  add.textContent='+';
  add.title='Add new colour';
  add.onclick=e=>{
    e.stopPropagation();
    _famCount++;
    _famSel=_famCount-1;
    renderFamEditor();
  };
  sw.appendChild(add);

  // Update hint
  const hint=document.querySelector('#stitchSettings .fam-hint');
  if(hint){
    const nAssigned=fams.filter(f=>f>=0).length;
    const nRed=redundant.length;
    let msg;
    if(nAssigned)msg=nAssigned+'/'+lines.length+' lines assigned';
    else if(_famCount)msg=_famCount+' colours available';
    else msg='Click + to add a colour';
    if(nRed)msg='<span style=\"color:#ff5555\">'+nRed+' redundant</span> &middot; '+msg;
    hint.innerHTML=msg;
  }
}

// Click handler: assign clicked line to selected family
function famEditorClick(e){
  const fc=document.getElementById('famCanvas');
  if(!fc||!fc._famHit||!curPat)return;
  const rect=fc.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  let best=-1,bd=14;
  fc._famHit.forEach(h=>{
    const d=distToSeg(mx,my,h.sx,h.sy,h.ex,h.ey);
    if(d<bd){bd=d;best=h.li;}
  });
  if(best<0)return;
  initExpFamilies(curPat);
  // Toggle: if already assigned to _famSel, unassign (-1). Otherwise assign to _famSel.
  curPat.families[best]=curPat.families[best]===_famSel?-1:_famSel;
  // Save and re-route
  const orig=EXP_PATTERNS.find(p=>p.id===curPat.id);
  if(orig)orig.families=[...curPat.families];
  _saveLocal();
  renderFamEditor();
  rerouteExp();
}
function distToSeg(px,py,ax,ay,bx,by){
  const l2=(bx-ax)**2+(by-ay)**2;
  if(l2===0)return Math.hypot(px-ax,py-ay);
  let t=((px-ax)*(bx-ax)+(py-ay)*(by-ay))/l2;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-ax-t*(bx-ax),py-ay-t*(by-ay));
}

// Build animation path: family-first routing.
//
// Foundation rule: symmetry families are routed in order (smallest line-index first).
// Each family's tiled segments are routed with min-deflection strokes → band-snake ordering.
// Between families: minimal jump.
function buildExpPath(lines){
  if(!lines||!lines.length)return[];

  // Group segments by family
  const famGroups=new Map();
  lines.forEach(l=>{
    const fi=l.fam||0;
    if(!famGroups.has(fi))famGroups.set(fi,[]);
    famGroups.get(fi).push(l);
  });
  const fams=[...famGroups.keys()].sort((a,b)=>a-b);

  const path=[];
  let cur=null;

  for(const fi of fams){
    const segs=famGroups.get(fi);
    const strokes=buildStrokesForFamily(segs);
    if(!strokes.length)continue;

    const ordered=orderStrokesFamily(strokes);

    if(cur&&ordered.length>0){
      const s0=ordered[0].pts;
      const dS=Math.hypot(s0[0][0]-cur[0],s0[0][1]-cur[1]);
      const dE=Math.hypot(s0[s0.length-1][0]-cur[0],s0[s0.length-1][1]-cur[1]);
      if(dE<dS)ordered[0].pts=s0.slice().reverse();
    }

    for(let si=0;si<ordered.length;si++){
      let pts=ordered[si].pts;
      if(cur){
        const dS=Math.hypot(pts[0][0]-cur[0],pts[0][1]-cur[1]);
        const dE=Math.hypot(pts[pts.length-1][0]-cur[0],pts[pts.length-1][1]-cur[1]);
        if(dE<dS)pts=pts.slice().reverse();
      }
      for(let k=0;k<pts.length-1;k++){
        path.push({start:pts[k],end:pts[k+1],jump:!!cur&&k===0, fam:fi});
      }
      cur=pts[pts.length-1];
    }
  }
  return path;
}

// ── Stroke formation for one family (Rule 1: min-deflection) ──────────────
function buildStrokesForFamily(segs){
  const Q=1e-4;
  const MAXTURN=90*Math.PI/180;

  const vId=new Map(), vPos=[];
  const vidOf=p=>{const k=Math.round(p[0]/Q)+','+Math.round(p[1]/Q);let id=vId.get(k);
    if(id===undefined){id=vPos.length;vId.set(k,id);vPos.push([p[0],p[1]]);}return id;};
  const seen=new Set(), edges=[];
  for(const l of segs){
    const a=vidOf(l.start), b=vidOf(l.end);
    if(a===b)continue;
    const ek=a<b?a+'_'+b:b+'_'+a;
    if(seen.has(ek))continue; seen.add(ek);
    edges.push([a,b]);
  }
  if(!edges.length)return[];

  const adj=vPos.map(()=>[]);
  edges.forEach(([a,b],ei)=>{
    let dx=vPos[b][0]-vPos[a][0], dy=vPos[b][1]-vPos[a][1];
    const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
    adj[a].push({e:ei,to:b,dir:[dx,dy],tw:-1});
    adj[b].push({e:ei,to:a,dir:[-dx,-dy],tw:-1});
  });
  {const slot=new Map();
  adj.forEach((list,v)=>list.forEach((h,li)=>{
    const s=slot.get(h.e);
    if(s===undefined)slot.set(h.e,{v,li});
    else{h.tw=s.li; adj[s.v][s.li].tw=li;}
  }));}

  const partner=adj.map(list=>new Int32Array(list.length).fill(-1));
  adj.forEach((list,v)=>{
    const d=list.length; if(d<2)return;
    const cost=(i,j)=>{let dt=list[i].dir[0]*list[j].dir[0]+list[i].dir[1]*list[j].dir[1];
      dt=Math.max(-1,Math.min(1,dt)); return Math.PI-Math.acos(dt);};
    partner[v].set(matchVertex(d,cost,MAXTURN));
  });

  const usedE=new Uint8Array(edges.length), strokes=[];
  function trace(v0,li0){
    const pts=[vPos[v0].slice()]; let v=v0,li=li0;
    for(;;){
      const h=adj[v][li]; if(usedE[h.e])break; usedE[h.e]=1;
      pts.push(vPos[h.to].slice());
      const nl=partner[h.to][h.tw];
      if(nl<0)break;
      v=h.to; li=nl;
    }
    if(pts.length>=2)strokes.push(pts);
  }
  adj.forEach((list,v)=>list.forEach((h,li)=>{
    if(partner[v][li]<0 && !usedE[h.e])trace(v,li);
  }));
  edges.forEach(([a],ei)=>{
    if(usedE[ei])return;
    trace(a, adj[a].findIndex(h=>h.e===ei));
  });

  return strokes;
}

// ── Stroke ordering within one super-family (ROUTING.md Rules 2+3: band-snake) ─
function orderStrokesFamily(strokes){
  if(strokes.length<=1)return strokes.map(pts=>({pts}));

  // metrics per stroke
  const S=strokes.map(pts=>{
    let cx=0,cy=0;
    pts.forEach(p=>{cx+=p[0];cy+=p[1];});
    cx/=pts.length; cy/=pts.length;
    let dx=pts[pts.length-1][0]-pts[0][0], dy=pts[pts.length-1][1]-pts[0][1];
    const len=Math.hypot(dx,dy);
    if(len<1e-6){
      const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
      dx=Math.max(...xs)-Math.min(...xs); dy=Math.max(...ys)-Math.min(...ys);
    }
    let ang=Math.atan2(dy,dx); if(ang<0)ang+=Math.PI; if(ang>=Math.PI)ang-=Math.PI;
    return{pts,cx,cy,ang};
  });

  // mean orientation via double-angle weighting
  let sc=0,ss=0;
  S.forEach(s=>{const w=Math.hypot(s.pts[s.pts.length-1][0]-s.pts[0][0],s.pts[s.pts.length-1][1]-s.pts[0][1])||1; sc+=w*Math.cos(2*s.ang); ss+=w*Math.sin(2*s.ang);});
  const tf=0.5*Math.atan2(ss,sc);
  const dir=[Math.cos(tf),Math.sin(tf)], perp=[-Math.sin(tf),Math.cos(tf)];

  // band coordinate = perpendicular projection of centroid
  S.forEach(s=>{s.bc=s.cx*perp[0]+s.cy*perp[1]; s.ac=s.cx*dir[0]+s.cy*dir[1];});

  // detect natural band pitch
  const bcs=[...new Set(S.map(s=>Math.round(s.bc*2)/2))].sort((a,b)=>a-b);
  let pitch=Infinity;
  for(let i=1;i<bcs.length;i++)pitch=Math.min(pitch,bcs[i]-bcs[i-1]);
  if(!isFinite(pitch)||pitch<1e-6)pitch=1;
  const minbc=Math.min(...S.map(s=>s.bc));
  S.forEach(s=>s.band=Math.round((s.bc-minbc)/pitch));

  // snake the bands: even bands forward, odd bands backward
  S.sort((a,b)=> a.band-b.band || (a.band%2===0 ? a.ac-b.ac : b.ac-a.ac));

  return S;
}

// Minimum-deflection maximal matching for one (small-degree) vertex.
// Returns partner[] of length d: pairs indices, -1 if unpaired. Maximises pairs first,
// then minimises total deflection cost; never pairs above maxCost.
function matchVertex(d,cost,maxCost){
  if(d>8){
    const allPairs=[];
    for(let i=0;i<d;i++)for(let j=i+1;j<d;j++){const c=cost(i,j); if(c<=maxCost)allPairs.push([c,i,j]);}
    if(!allPairs.length) return new Int32Array(d).fill(-1);
    let bestPairs=-1, bestCost=Infinity, bestArr=null;
    const ITERS=Math.min(40, Math.max(15, Math.ceil(allPairs.length/2)));
    for(let iter=0;iter<ITERS;iter++){
      for(let k=allPairs.length-1;k>0;k--){const r=Math.floor(Math.random()*(k+1));[allPairs[k],allPairs[r]]=[allPairs[r],allPairs[k]];}
      const arr=new Int32Array(d).fill(-1), used=new Uint8Array(d); let prs=0, csum=0;
      for(const[c,i,j]of allPairs){if(!used[i]&&!used[j]){used[i]=used[j]=1;arr[i]=j;arr[j]=i;prs++;csum+=c;}}
      if(prs>bestPairs||(prs===bestPairs&&csum<bestCost)){bestPairs=prs;bestCost=csum;bestArr=arr;}
    }
    return bestArr||new Int32Array(d).fill(-1);
  }
  let bestPairs=-1,bestCost=Infinity,bestArr=null;
  const arr=new Int32Array(d).fill(-1), used=new Uint8Array(d);
  (function rec(start,pairs,csum){
    let i=start; while(i<d&&used[i])i++;
    if(i>=d){ if(pairs>bestPairs||(pairs===bestPairs&&csum<bestCost)){bestPairs=pairs;bestCost=csum;bestArr=arr.slice();} return; }
    used[i]=1; arr[i]=-1; rec(i+1,pairs,csum); used[i]=0;
    used[i]=1;
    for(let j=i+1;j<d;j++){ if(used[j])continue; const c=cost(i,j); if(c>maxCost)continue;
      used[j]=1; arr[i]=j; arr[j]=i; rec(i+1,pairs+1,csum+c); used[j]=0; arr[i]=-1; arr[j]=-1; }
    used[i]=0;
  })(0,0,0);
  return bestArr||new Int32Array(d).fill(-1);
}

function drawExpGuide(){
  if(!curPat||!EXP_g2s)return;
  const lay=computeExpLayout(curPat);
  const [minU,maxU]=lay.uRange, [minV,maxV]=lay.vRange;
  const STEP=10;                                   // one macro cell; canvas clips lines to the square
  const u0=Math.floor(minU/STEP)*STEP, u1=Math.ceil(maxU/STEP)*STEP;
  const v0=Math.floor(minV/STEP)*STEP, v1=Math.ceil(maxV/STEP)*STEP;
  ctx.strokeStyle='rgba(220,235,255,0.07)'; ctx.lineWidth=0.8; ctx.setLineDash([]);
  for(let u=u0;u<=u1;u+=STEP){
    const a=EXP_g2s([u,v0]),b=EXP_g2s([u,v1]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  for(let v=v0;v<=v1;v+=STEP){
    const a=EXP_g2s([u0,v]),b=EXP_g2s([u1,v]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
}

function renderExp(step){
  const ch=EXP_canvasH||SIZE;
  // Fabric background
  ctx.fillStyle='#1a3a5c'; ctx.fillRect(0,0,SIZE,ch);
  ctx.strokeStyle='rgba(255,255,255,0.025)'; ctx.lineWidth=1; ctx.setLineDash([]);
  for(let y=4;y<ch;y+=5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(SIZE,y);ctx.stroke();}
  drawExpGuide();
  if(!EXP_path.length)return;
  // Completed stitches — coloured by family
  ctx.lineWidth=3; ctx.lineCap='round';
  for(let i=0;i<Math.min(step,EXP_path.length);i++){
    const s=EXP_path[i],p1=EXP_g2s(s.start),p2=EXP_g2s(s.end);
    ctx.strokeStyle=famColor(s.fam);
    ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
  }
  // Back-thread dashes for completed jumps
  ctx.strokeStyle='rgba(243,239,228,0.18)'; ctx.lineWidth=1.4;
  ctx.setLineDash([2,4]); ctx.lineCap='butt';
  for(let i=1;i<EXP_path.length&&i<=step;i++){
    if(EXP_path[i].jump){
      const p1=EXP_g2s(EXP_path[i-1].end),p2=EXP_g2s(EXP_path[i].start);
      ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  // Needle
  if(step>0&&step<=EXP_path.length){
    const s=EXP_path[step-1];
    const col=famColor(s.fam);
    const p=EXP_g2s(s.end);
    const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,16);
    g.addColorStop(0,hexA(col,0.55));g.addColorStop(1,hexA(col,0));
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=col;ctx.beginPath();ctx.arc(p.x,p.y,3.4,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.x-1,p.y-1,1.1,0,Math.PI*2);ctx.fill();
  }
}

window.openExpPattern=function openExpPattern(idOrPat){
  const pat=typeof idOrPat==='string'?EXP_PATTERNS.find(p=>p.id===idOrPat):idOrPat;
  if(!pat)return;
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
};

// Re-run the router on the current custom pattern (no redraw needed when routing rules change).
window.rerouteExp=function rerouteExp(){
  if(!curPat||curPat.type!=='exp')return;
  setupExpCanvas(curPat);
  EXP_path=buildExpPath(genTiledSegs(curPat));
  TOTAL=EXP_path.length; PASSES=[];
  step=0; if(playing)pause();
  buildJumpBar(); render(0);
};

// ── My Patterns view ─────────────────────────────────────────────────────────
function expCardHTML(pat){
  const esc=s=>s.replace(/[<>"'&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
  return`<div class="pcard exp-card" data-id="${esc(pat.id)}" onclick="openExpPattern('${esc(pat.id)}')">
    <canvas class="pcard-thumb" width="120" height="120" data-expid="${esc(pat.id)}"></canvas>
    <div class="pcard-body">
      <div class="pcard-name">${esc(pat.name||'Custom')}</div>
      <span class="pcard-badge">${pat.gridType==='isometric'?'Isometric':'Square'}</span>
    </div>
    <button class="exp-del-btn" title="Delete" onclick="event.stopPropagation();removeExpPattern('${esc(pat.id)}')">✕</button>
  </div>`;
}

function rebuildMyPatsView(){
  const grid=document.getElementById('myPatsGrid');
  if(!grid)return;
  grid.innerHTML='';
  if(!EXP_PATTERNS.length){
    const offline=!_firebaseReady?' (offline — patterns sync when Firebase is configured)':'';
    grid.innerHTML=`<p class="no-results" style="display:block;margin:24px auto">No saved patterns yet — use the CAD Editor to draw one.${offline}</p>`;
    return;
  }
  EXP_PATTERNS.forEach(pat=>{
    grid.insertAdjacentHTML('beforeend',expCardHTML(pat));
    const thumb=grid.querySelector(`[data-expid="${pat.id}"]`);
    if(thumb)setTimeout(()=>renderThumb(thumb,pat),0);
  });
}

function rebuildExpGallery(){rebuildMyPatsView();}

window.removeExpPattern=async function removeExpPattern(id){
  EXP_PATTERNS=EXP_PATTERNS.filter(p=>p.id!==id);
  _saveLocal();
  await _deleteFromFirestore(id);
  rebuildMyPatsView();
};

window.showMyPatterns=function(){
  document.getElementById('galleryView').style.display='none';
  document.getElementById('cadView').classList.remove('open');
  document.getElementById('myPatsView').classList.add('open');
  // Always refresh from Firestore when opening the view
  if(_firebaseReady){_fetchFromFirestore().then(()=>rebuildMyPatsView());}
  else{rebuildMyPatsView();}
  window.scrollTo({top:0,behavior:'smooth'});
};
window.showGalleryFromMyPats=function(){
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('galleryView').style.display='block';
};

// ── CAD view switching ────────────────────────────────────────────────────────
window.showCAD=function(){
  document.getElementById('galleryView').style.display='none';
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.remove('open');
  document.getElementById('cadView').classList.add('open');
  cadInit();
  window.scrollTo({top:0,behavior:'smooth'});
};
window.showGalleryFromCAD=function(){
  document.getElementById('cadView').classList.remove('open');
  document.getElementById('myPatsView').classList.add('open');
  rebuildMyPatsView();
};
