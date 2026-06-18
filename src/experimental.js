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

// Pure: compute scale/origin for one-tile view of pat.
function computeExpLayout(pat){
  const bbox=pat.bbox||{minU:0,maxU:60,minV:0,maxV:60};
  const dU=Math.max(bbox.maxU-bbox.minU,1), dV=Math.max(bbox.maxV-bbox.minV,1);
  const iso=pat.gridType==='isometric';
  let sz,ox,oy,canvasH;
  if(iso){
    sz=SIZE/((dU+dV)*_COS30);
    ox=dV*sz*_COS30; oy=0;
    canvasH=Math.round((dU+dV)*sz*_SIN30);
  }else{
    sz=(SIZE-2*PAD)/Math.max(dU,dV);
    ox=PAD; oy=PAD; canvasH=SIZE;
  }
  function g2s(p){
    const u=p[0],v=p[1];
    if(iso)return{x:ox+(u-v)*sz*_COS30,y:oy+(u+v)*sz*_SIN30};
    return{x:ox+u*sz,y:oy+v*sz};
  }
  return{sz,ox,oy,canvasH,g2s};
}

// Resize cv for this exp pattern, store EXP_g2s/EXP_canvasH, re-apply DPR scale.
function setupExpCanvas(pat){
  const lay=computeExpLayout(pat);
  EXP_g2s=lay.g2s; EXP_canvasH=lay.canvasH;
  cv.height=EXP_canvasH*DPR; cv.style.height=EXP_canvasH+'px';
  ctx.scale(DPR,DPR);
}

// Build animation path from pat.lines: chain connected segments, NN-order chains.
function buildExpPath(lines){
  if(!lines||!lines.length)return[];
  // Work on copies so we don't mutate the saved pattern.
  const segs=lines.map(l=>({start:[...l.start],end:[...l.end]}));
  const n=segs.length;
  const EPS=0.01;
  function key(p){return Math.round(p[0]/EPS)+','+Math.round(p[1]/EPS);}
  // adj: endpoint key → [{i, atStart}]
  const adj=new Map();
  segs.forEach((s,i)=>{
    [key(s.start),key(s.end)].forEach((k,ki)=>{
      if(!adj.has(k))adj.set(k,[]);
      adj.get(k).push({i,atStart:ki===0});
    });
  });
  const used=new Uint8Array(n);
  const chains=[];
  for(let s=0;s<n;s++){
    if(used[s])continue;
    used[s]=1;
    const chain=[s];
    // Extend forward (from end)
    for(;;){
      const nb=(adj.get(key(segs[chain[chain.length-1]].end))||[]).find(c=>!used[c.i]);
      if(!nb)break;
      used[nb.i]=1;
      if(!nb.atStart)[segs[nb.i].start,segs[nb.i].end]=[segs[nb.i].end,segs[nb.i].start];
      chain.push(nb.i);
    }
    // Extend backward (from start)
    for(;;){
      const nb=(adj.get(key(segs[chain[0]].start))||[]).find(c=>!used[c.i]);
      if(!nb)break;
      used[nb.i]=1;
      if(nb.atStart)[segs[nb.i].start,segs[nb.i].end]=[segs[nb.i].end,segs[nb.i].start];
      chain.unshift(nb.i);
    }
    chains.push(chain);
  }
  // NN-order chains
  const usedC=new Uint8Array(chains.length), ordered=[chains[0]];
  usedC[0]=1;
  function ep(chain,fromEnd){const si=fromEnd?chain[chain.length-1]:chain[0];return fromEnd?segs[si].end:segs[si].start;}
  for(let k=1;k<chains.length;k++){
    const tail=ep(ordered[ordered.length-1],true);
    let best=Infinity,bi=-1,bFlip=false;
    chains.forEach((c,ci)=>{
      if(usedC[ci])return;
      const d0=Math.hypot(ep(c,false)[0]-tail[0],ep(c,false)[1]-tail[1]);
      const d1=Math.hypot(ep(c,true)[0]-tail[0],ep(c,true)[1]-tail[1]);
      if(d0<best){best=d0;bi=ci;bFlip=false;}
      if(d1<best){best=d1;bi=ci;bFlip=true;}
    });
    if(bi<0)break;
    usedC[bi]=1;
    if(bFlip){chains[bi].reverse();chains[bi].forEach(i=>{[segs[i].start,segs[i].end]=[segs[i].end,segs[i].start];});}
    ordered.push(chains[bi]);
  }
  // Flatten with jump markers
  const path=[];
  ordered.forEach((chain,ci)=>{
    chain.forEach((si,k)=>path.push({start:segs[si].start,end:segs[si].end,jump:ci>0&&k===0}));
  });
  return path;
}

function drawExpGuide(){
  if(!curPat||!EXP_g2s)return;
  const bbox=curPat.bbox||{maxU:60,maxV:60};
  const dU=bbox.maxU, dV=bbox.maxV;
  ctx.strokeStyle='rgba(220,235,255,0.07)'; ctx.lineWidth=0.8; ctx.setLineDash([]);
  const STEP=10;
  if(curPat.gridType==='isometric'){
    for(let u=0;u<=dU;u+=STEP){
      const a=EXP_g2s([u,0]),b=EXP_g2s([u,dV]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    for(let v=0;v<=dV;v+=STEP){
      const a=EXP_g2s([0,v]),b=EXP_g2s([dU,v]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
  }else{
    for(let u=0;u<=dU;u+=STEP){
      const a=EXP_g2s([u,0]),b=EXP_g2s([u,dV]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    for(let v=0;v<=dV;v+=STEP){
      const a=EXP_g2s([0,v]),b=EXP_g2s([dU,v]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
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
