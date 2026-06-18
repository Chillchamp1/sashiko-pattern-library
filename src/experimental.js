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

// Build animation path: row/column sweep with snake ordering.
// Segments are clustered into direction families, grouped into rows by perpendicular
// coordinate, merged into collinear chains, NN-ordered within each row, then snaked
// (alternating forward/reverse) across rows. Matches how a human stitcher works a grid.
function buildExpPath(lines){
  if(!lines||!lines.length)return[];
  const EPS=0.001;

  // Normalize angle to [0,180) degrees
  function segAngle(l){
    let dx=l.end[0]-l.start[0],dy=l.end[1]-l.start[1];
    let a=Math.atan2(dy,dx)*180/Math.PI;
    if(a<0)a+=180; if(a>=180)a-=180; return a;
  }

  // Cluster into direction families (15° bins so floating-point angles stay in same bin)
  const famMap=new Map();
  for(const l of lines){
    const ang=segAngle(l);
    const key=Math.round(ang/15)*15%180;
    if(!famMap.has(key))famMap.set(key,[]);
    famMap.get(key).push({start:[...l.start],end:[...l.end]});
  }

  // Sort families: 0° (H-ish) first, 90° (V-ish) last
  const famKeys=[...famMap.keys()].sort((a,b)=>a-b);

  const path=[];
  let firstSeg=true;

  for(const angDeg of famKeys){
    const famSegs=famMap.get(angDeg);
    const ang=angDeg*Math.PI/180;
    const fwdU=Math.cos(ang),fwdV=Math.sin(ang);
    // Perpendicular axis (used to separate rows)
    const perpU=-fwdV,perpV=fwdU;

    // Group segments into rows by perpendicular coordinate of midpoint
    const rowMap=new Map();
    for(const s of famSegs){
      const mu=(s.start[0]+s.end[0])/2,mv=(s.start[1]+s.end[1])/2;
      const rowKey=Math.round((mu*perpU+mv*perpV)/EPS); // quantised
      if(!rowMap.has(rowKey))rowMap.set(rowKey,[]);
      rowMap.get(rowKey).push(s);
    }

    // Sort rows by perpendicular coordinate (sweep direction)
    const rows=[...rowMap.entries()].sort((a,b)=>a[0]-b[0]);

    for(let ri=0;ri<rows.length;ri++){
      const [,rowSegs]=rows[ri];
      const goReverse=ri%2===1; // snake

      // Normalise each segment to point in the fwd direction, then sort by start position
      const norm=rowSegs.map(s=>{
        const dot=(s.end[0]-s.start[0])*fwdU+(s.end[1]-s.start[1])*fwdV;
        return dot>=0?{start:[...s.start],end:[...s.end]}:{start:[...s.end],end:[...s.start]};
      }).sort((a,b)=>(a.start[0]*fwdU+a.start[1]*fwdV)-(b.start[0]*fwdU+b.start[1]*fwdV));

      // Merge touching collinear segments into point-chains (Rule 1 — long lines)
      const chains=[];
      for(const s of norm){
        if(chains.length){
          const tail=chains[chains.length-1][chains[chains.length-1].length-1];
          if(Math.abs(s.start[0]-tail[0])<EPS*10&&Math.abs(s.start[1]-tail[1])<EPS*10){
            chains[chains.length-1].push(s.end); continue;
          }
        }
        chains.push([s.start,s.end]);
      }

      // NN-order chains within the row to minimise intra-row jumps (Rule 2)
      if(chains.length>1){
        const ord=[chains[0]],usedC=new Uint8Array(chains.length);usedC[0]=1;
        for(let k=1;k<chains.length;k++){
          const tail=ord[ord.length-1][ord[ord.length-1].length-1];
          let best=Infinity,bi=-1,bFlip=false;
          chains.forEach((c,ci)=>{
            if(usedC[ci])return;
            const d0=Math.hypot(c[0][0]-tail[0],c[0][1]-tail[1]);
            const d1=Math.hypot(c[c.length-1][0]-tail[0],c[c.length-1][1]-tail[1]);
            if(d0<best){best=d0;bi=ci;bFlip=false;}
            if(d1<best){best=d1;bi=ci;bFlip=true;}
          });
          if(bi<0)break;
          usedC[bi]=1; if(bFlip)chains[bi].reverse(); ord.push(chains[bi]);
        }
        chains.length=0; ord.forEach(c=>chains.push(c));
      }

      // Snake: reverse row direction on odd rows
      if(goReverse){chains.reverse();chains.forEach(c=>c.reverse());}

      // Flatten into path; mark jump at the start of each chain (except the very first stitch)
      for(const chain of chains){
        for(let k=0;k<chain.length-1;k++){
          path.push({start:chain[k],end:chain[k+1],jump:!firstSeg&&k===0});
          firstSeg=false;
        }
      }
    }
  }
  return path;
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
