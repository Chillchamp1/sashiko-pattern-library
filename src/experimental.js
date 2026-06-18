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

// Pure: compute tiled-view layout for pat (scale = patMacro tiles across canvas).
function computeExpLayout(pat){
  const bbox=pat.bbox||{minU:0,maxU:10,minV:0,maxV:10};
  const dU=Math.max(bbox.maxU-bbox.minU,1), dV=Math.max(bbox.maxV-bbox.minV,1);
  const ptc=(pat.patMacro||5)*10; // total micro-units across canvas
  const iso=pat.gridType==='isometric';
  let sz,ox,oy,canvasH;
  if(iso){
    sz=SIZE/(2*ptc*_COS30);
    ox=SIZE/2; oy=0;
    canvasH=Math.round(ptc*2*sz*_SIN30); // = Math.round(SIZE/√3) ≈ 215
  }else{
    sz=SIZE/ptc;
    ox=0; oy=0; canvasH=SIZE;
  }
  function g2s(p){
    const u=p[0],v=p[1];
    if(iso)return{x:ox+(u-v)*sz*_COS30,y:oy+(u+v)*sz*_SIN30};
    return{x:ox+u*sz,y:oy+v*sz};
  }
  return{sz,ox,oy,canvasH,g2s,ptc,dU,dV};
}

// Generate all tiled segment instances that cover the visible canvas area.
function genTiledSegs(pat){
  const bbox=pat.bbox||{minU:0,maxU:10,minV:0,maxV:10};
  const dU=Math.max(bbox.maxU-bbox.minU,1), dV=Math.max(bbox.maxV-bbox.minV,1);
  const ptc=(pat.patMacro||5)*10;
  const segs=[];
  for(let ou=-dU;ou<=ptc;ou+=dU){
    for(let ov=-dV;ov<=ptc;ov+=dV){
      (pat.lines||[]).forEach(l=>{
        segs.push({start:[l.start[0]+ou,l.start[1]+ov],end:[l.end[0]+ou,l.end[1]+ov]});
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
  ctx.scale(DPR,DPR);
}

// Build animation path with "human-makable" routing.
//
// Cost model we approximately minimise (priority high → low):
//   A·(#jumps)  +  B·(total jump length)  +  C·(turn sharpness)  +  D·(retrace)
// A ≫ B ≫ C,D — re-inserting the needle dominates, so we first form the longest
// continuous strokes possible, then order them so every jump is short and always
// moves into UNSTITCHED area.
//
// Phase 1 — stroke formation (minimises #jumps and turn sharpness together):
//   Build a vertex/edge graph; at each vertex pair the incident edges by MINIMUM
//   DEFLECTION (straightest through-passage). A stroke follows these pairings, so
//   it runs straight through crossings AND smoothly along curves — a whole
//   semicircle becomes ONE stroke regardless of how many small angles it contains.
//   It only breaks at genuine endpoints or near-reversals (deflection > MAXTURN).
// Phase 2 — stroke ordering (minimises jump length and retrace):
//   Group strokes into orientation families (Rule 3 pass order), then into parallel
//   bands; sweep bands and SNAKE (reverse alternate bands). Monotonic progress means
//   each jump is a short hop into new territory, never back over finished stitches.
function buildExpPath(lines){
  if(!lines||!lines.length)return[];
  const Q=1e-4;                    // vertex-merge quantum (shared endpoints are computed identically)
  const MAXTURN=135*Math.PI/180;   // break a stroke rather than force a turn sharper than this

  // ---- vertex / edge graph ----
  const vId=new Map(), vPos=[];
  const vidOf=p=>{const k=Math.round(p[0]/Q)+','+Math.round(p[1]/Q);let id=vId.get(k);
    if(id===undefined){id=vPos.length;vId.set(k,id);vPos.push([p[0],p[1]]);}return id;};
  const seen=new Set(), edges=[];
  for(const l of lines){
    const a=vidOf(l.start), b=vidOf(l.end);
    if(a===b)continue;
    const ek=a<b?a+'_'+b:b+'_'+a;
    if(seen.has(ek))continue; seen.add(ek);          // dedupe exact-duplicate edges (overlapping tiles)
    edges.push([a,b]);
  }
  if(!edges.length)return[];
  const adj=vPos.map(()=>[]);                         // adj[v] = [{e,to,dir:[ux,uy],tw}]
  edges.forEach(([a,b],ei)=>{
    let dx=vPos[b][0]-vPos[a][0], dy=vPos[b][1]-vPos[a][1];
    const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
    adj[a].push({e:ei,to:b,dir:[dx,dy],tw:-1});
    adj[b].push({e:ei,to:a,dir:[-dx,-dy],tw:-1});
  });
  {                                                   // link the two half-edges (twins) of each edge
    const slot=new Map();
    adj.forEach((list,v)=>list.forEach((h,li)=>{
      const s=slot.get(h.e);
      if(s===undefined)slot.set(h.e,{v,li});
      else{h.tw=s.li; adj[s.v][s.li].tw=li;}
    }));
  }

  // ---- Phase 1: min-deflection maximal matching at each vertex ----
  const partner=adj.map(list=>new Int32Array(list.length).fill(-1));
  adj.forEach((list,v)=>{
    const d=list.length; if(d<2)return;
    // deflection: 0 = straight through (opposite outgoing dirs), π = fold straight back
    const cost=(i,j)=>{let dt=list[i].dir[0]*list[j].dir[0]+list[i].dir[1]*list[j].dir[1];
      dt=Math.max(-1,Math.min(1,dt)); return Math.PI-Math.acos(dt);};
    partner[v].set(matchVertex(d,cost,MAXTURN));
  });

  // ---- trace strokes following the pairings ----
  const usedE=new Uint8Array(edges.length), strokes=[];
  function trace(v0,li0){
    const pts=[vPos[v0].slice()]; let v=v0,li=li0;
    for(;;){
      const h=adj[v][li]; if(usedE[h.e])break; usedE[h.e]=1;
      pts.push(vPos[h.to].slice());
      const nl=partner[h.to][h.tw];     // continue out along the partner of the arriving half-edge
      if(nl<0)break;                    // dangling → stroke ends
      v=h.to; li=nl;
    }
    if(pts.length>=2)strokes.push(pts);
  }
  adj.forEach((list,v)=>list.forEach((h,li)=>{        // open strokes: start at unpaired half-edges
    if(partner[v][li]<0 && !usedE[h.e])trace(v,li);
  }));
  edges.forEach(([a],ei)=>{                           // closed loops: any remaining edges
    if(usedE[ei])return;
    trace(a, adj[a].findIndex(h=>h.e===ei));
  });

  // ---- Phase 2: order strokes — family → band → snake ----
  const FAMBIN=Math.PI/6, FAMS=Math.round(Math.PI/FAMBIN);   // 30° bins
  function metrics(pts){
    let len=0,cx=0,cy=0;
    for(let k=0;k<pts.length-1;k++)len+=Math.hypot(pts[k+1][0]-pts[k][0],pts[k+1][1]-pts[k][1]);
    pts.forEach(p=>{cx+=p[0];cy+=p[1];}); cx/=pts.length; cy/=pts.length;
    let dx=pts[pts.length-1][0]-pts[0][0], dy=pts[pts.length-1][1]-pts[0][1];
    if(Math.hypot(dx,dy)<len*0.3){                    // closed/curly stroke → use bbox major axis
      const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
      dx=Math.max(...xs)-Math.min(...xs); dy=Math.max(...ys)-Math.min(...ys);
    }
    let ang=Math.atan2(dy,dx); if(ang<0)ang+=Math.PI; if(ang>=Math.PI)ang-=Math.PI;
    return {len,cx,cy,ang};
  }
  const S=strokes.map(pts=>({pts,...metrics(pts)}));
  const famMap=new Map();
  S.forEach(s=>{const fb=Math.round(s.ang/FAMBIN)%FAMS;
    if(!famMap.has(fb))famMap.set(fb,[]); famMap.get(fb).push(s);});
  const fams=[...famMap.entries()].sort((a,b)=>a[0]-b[0]).map(e=>e[1]);

  const ordered=[];
  for(const fam of fams){
    let sc=0,ss=0; fam.forEach(s=>{sc+=s.len*Math.cos(2*s.ang); ss+=s.len*Math.sin(2*s.ang);});
    const tf=0.5*Math.atan2(ss,sc);                   // family mean orientation (double-angle)
    const dir=[Math.cos(tf),Math.sin(tf)], perp=[-Math.sin(tf),Math.cos(tf)];
    fam.forEach(s=>{s.bc=s.cx*perp[0]+s.cy*perp[1]; s.ac=s.cx*dir[0]+s.cy*dir[1];});
    const bcs=[...new Set(fam.map(s=>Math.round(s.bc*2)/2))].sort((a,b)=>a-b);
    let pitch=Infinity; for(let i=1;i<bcs.length;i++)pitch=Math.min(pitch,bcs[i]-bcs[i-1]);
    if(!isFinite(pitch)||pitch<1e-6)pitch=1;
    const minbc=Math.min(...fam.map(s=>s.bc));
    fam.forEach(s=>s.band=Math.round((s.bc-minbc)/pitch));
    fam.sort((a,b)=> a.band-b.band || (a.band%2===0 ? a.ac-b.ac : b.ac-a.ac));   // snake
    fam.forEach(s=>ordered.push(s));
  }

  // ---- emit, picking each stroke's direction nearest the running cursor ----
  const path=[]; let cur=null, first=true;
  for(const s of ordered){
    let pts=s.pts;
    if(cur){
      const dS=Math.hypot(pts[0][0]-cur[0],pts[0][1]-cur[1]);
      const dE=Math.hypot(pts[pts.length-1][0]-cur[0],pts[pts.length-1][1]-cur[1]);
      if(dE<dS)pts=pts.slice().reverse();
    }
    for(let k=0;k<pts.length-1;k++){ path.push({start:pts[k],end:pts[k+1],jump:!first&&k===0}); first=false; }
    cur=pts[pts.length-1];
  }
  return path;
}

// Minimum-deflection maximal matching for one (small-degree) vertex.
// Returns partner[] of length d: pairs indices, -1 if unpaired. Maximises pairs first,
// then minimises total deflection cost; never pairs above maxCost.
function matchVertex(d,cost,maxCost){
  if(d>8){                                            // greedy fallback for rare high-degree hubs
    const arr=new Int32Array(d).fill(-1), used=new Uint8Array(d), pairs=[];
    for(let i=0;i<d;i++)for(let j=i+1;j<d;j++){const c=cost(i,j); if(c<=maxCost)pairs.push([c,i,j]);}
    pairs.sort((a,b)=>a[0]-b[0]);
    for(const[,i,j]of pairs)if(!used[i]&&!used[j]){used[i]=used[j]=1;arr[i]=j;arr[j]=i;}
    return arr;
  }
  let bestPairs=-1,bestCost=Infinity,bestArr=null;
  const arr=new Int32Array(d).fill(-1), used=new Uint8Array(d);
  (function rec(start,pairs,csum){
    let i=start; while(i<d&&used[i])i++;
    if(i>=d){ if(pairs>bestPairs||(pairs===bestPairs&&csum<bestCost)){bestPairs=pairs;bestCost=csum;bestArr=arr.slice();} return; }
    used[i]=1; arr[i]=-1; rec(i+1,pairs,csum); used[i]=0;             // leave i unpaired
    used[i]=1;
    for(let j=i+1;j<d;j++){ if(used[j])continue; const c=cost(i,j); if(c>maxCost)continue;
      used[j]=1; arr[i]=j; arr[j]=i; rec(i+1,pairs+1,csum+c); used[j]=0; arr[i]=-1; arr[j]=-1; }
    used[i]=0;
  })(0,0,0);
  return bestArr||new Int32Array(d).fill(-1);
}

function drawExpGuide(){
  if(!curPat||!EXP_g2s)return;
  const {ptc,dU,dV}=computeExpLayout(curPat);
  ctx.strokeStyle='rgba(220,235,255,0.07)'; ctx.lineWidth=0.8; ctx.setLineDash([]);
  for(let u=0;u<=ptc;u+=dU){
    const a=EXP_g2s([u,0]),b=EXP_g2s([u,ptc]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  for(let v=0;v<=ptc;v+=dV){
    const a=EXP_g2s([0,v]),b=EXP_g2s([ptc,v]);
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
  // Completed stitches
  ctx.lineWidth=3; ctx.lineCap='round'; ctx.strokeStyle='#9cbcd8';
  for(let i=0;i<Math.min(step,EXP_path.length);i++){
    const s=EXP_path[i],p1=EXP_g2s(s.start),p2=EXP_g2s(s.end);
    ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
  }
  // Back-thread dashes for completed jumps
  ctx.strokeStyle='rgba(243,239,228,0.16)'; ctx.lineWidth=1.4;
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
    const p=EXP_g2s(EXP_path[step-1].end);
    const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,16);
    g.addColorStop(0,'rgba(156,188,216,0.55)');g.addColorStop(1,'rgba(156,188,216,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#9cbcd8';ctx.beginPath();ctx.arc(p.x,p.y,3.4,0,Math.PI*2);ctx.fill();
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
