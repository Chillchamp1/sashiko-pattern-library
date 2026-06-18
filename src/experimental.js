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

// ── Rendering ────────────────────────────────────────────────────────────────
function renderExpPattern(pat){
  if(!pat||!pat.lines)return;
  const x=ctx;
  x.fillStyle='#1a3a5c';x.fillRect(0,0,SIZE,SIZE);
  const COS30=Math.cos(Math.PI/6),SIN30=Math.sin(Math.PI/6);
  const bbox=pat.bbox;
  const dU=Math.max(bbox.maxU-bbox.minU,0.01),dV=Math.max(bbox.maxV-bbox.minV,0.01);
  const isIso=pat.gridType==='isometric';
  // Use the same tiling scale as patCanvas did when the user saved.
  // patMacro * CAD_MICRO = total micro-units across the 500px patCanvas.
  const micro=10, ptc=(pat.patMacro||5)*micro;
  let tileSize, ox, oy;
  if(isIso){
    tileSize=SIZE/(2*ptc*COS30);
    ox=SIZE/2; oy=(SIZE-(ptc*2*tileSize*SIN30))/2;
  }else{
    tileSize=SIZE/ptc;
    ox=0; oy=0;
  }
  function g2s(u,v){
    if(isIso)return{x:ox+(u-v)*tileSize*COS30,y:oy+(u+v)*tileSize*SIN30};
    return{x:ox+u*tileSize,y:oy+v*tileSize};
  }
  x.lineWidth=1.5;x.lineCap='round';x.strokeStyle='#9cbcd8';
  const over=ptc;
  for(let ou=-over;ou<=ptc+over;ou+=dU){for(let ov=-over;ov<=ptc+over;ov+=dV){
    pat.lines.forEach(l=>{
      const u1=l.start[0]+ou,v1=l.start[1]+ov;
      const u2=l.end[0]+ou,v2=l.end[1]+ov;
      const p1=g2s(u1,v1),p2=g2s(u2,v2);
      if((p1.x>-50&&p1.x<SIZE+50&&p1.y>-50&&p1.y<SIZE+50)||(p2.x>-50&&p2.x<SIZE+50&&p2.y>-50&&p2.y<SIZE+50)){
        x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
      }
    });
  }}
}

window.openExpPattern=function openExpPattern(idOrPat){
  const pat=typeof idOrPat==='string'?EXP_PATTERNS.find(p=>p.id===idOrPat):idOrPat;
  if(!pat)return;
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.add('open');
  curPat=pat;isEXP=true;isHM=false;isPL=false;
  TOTAL=1;step=1;playing=false;
  showGenUI(false);
  document.getElementById('info').textContent=pat.name||'Custom Pattern';
  renderExpPattern(pat);
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
    if(thumb&&pat.thumbnail){const img=new Image();img.onload=()=>{const tc=thumb.getContext('2d');tc.drawImage(img,0,0,120,120);};img.src=pat.thumbnail;}
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
