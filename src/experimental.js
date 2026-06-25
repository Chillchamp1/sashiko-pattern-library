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

// ── Cat name generator ─────────────────────────────────────────────────
const CAT_FIRST=['Sir','Lady','Captain','Prof','Dr','Mr','Miss','Prince','Princess','Duke','Duchess','Lord','Baron','Count','Madame','Chef','DJ','King','Queen','Emperor'];
const CAT_SECOND=['Fluffington','Whiskerface','Meowington','Pawsley','Furball','Snugglepuss','Cuddlebug','Purrington','Tailsworth','Clawdia','Scratchington','Nibbles','Socks','Mittens','Patches','Smudge','Pounce','Biscuit','Muffin','Crumpet','Waffles','Sprinkles'];
function _hashUID(uid){
  let h=0;for(let i=0;i<uid.length;i++)h=((h<<5)-h)+uid.charCodeAt(i)|0;
  return Math.abs(h);
}
function _catName(uid,seed){
  const s=seed!==undefined?seed:_avatarSeed();
  const h=_hashUID(uid+'_'+s);
  return CAT_FIRST[h%CAT_FIRST.length]+' '+CAT_SECOND[(h*7+3)%CAT_SECOND.length];
}

// ── Cat avatar: tuxedo-style (two-tone face, horizontal split) ────────
const CAT_COATS=['#e67e22','#d35400','#bdc3c7','#7f8c8d','#2c3e50','#ecf0f1','#8d6e63','#5d4037','#f39c12','#9b59b6'];

function _avatarSeed(){
  let s=parseInt(localStorage.getItem('sashiko_avseed')||'0');
  return s;
}
function _nextAvatarSeed(){
  let s=_avatarSeed()+1;
  localStorage.setItem('sashiko_avseed',s);
  return s;
}
function cycleAvatar(){
  _nextAvatarSeed();
  renderFamEditor();
  _renderCatAvatars();
}
window.cycleAvatar=cycleAvatar;

function _drawCatAvatar(canvas,uid){
  const seed=_avatarSeed();
  const h=_hashUID(uid+'_'+seed);
  const S=48;canvas.width=S;canvas.height=S;
  const x=canvas.getContext('2d');
  x.clearRect(0,0,S,S);

  const fur=CAT_COATS[h%CAT_COATS.length];
  const eyeC=CAT_COATS[(h*4+3)%CAT_COATS.length];

  function g(xx,yy,c){x.fillStyle=c;x.fillRect(xx*2,yy*2,2,2);}
  function b(xx,yy,w,h,c){x.fillStyle=c;x.fillRect(xx*2,yy*2,w*2,h*2);}

  // Head (wide rectangular)
  b(4,7,16,12,fur);b(3,8,1,10,fur);b(20,8,1,10,fur);
  b(5,6,14,1,fur);b(6,5,12,1,fur);b(7,4,10,1,fur);
  b(4,19,16,1,fur);b(6,20,12,1,fur);b(7,21,10,1,fur);b(8,22,8,1,fur);

  // Two-tone face (horizontal split)
  b(3,16,18,6,'#fff');

  // Ears
  b(6,0,1,2,fur);b(5,2,2,1,fur);b(4,3,3,2,fur);b(4,5,2,1,fur);
  g(5,3,'#ffccbb');g(6,2,'#ffccbb');
  b(17,0,1,2,fur);b(17,2,2,1,fur);b(17,3,3,2,fur);b(18,5,2,1,fur);
  g(17,3,'#ffccbb');g(18,2,'#ffccbb');

  // Eyes
  b(6,9,4,3,'#fff');b(14,9,4,3,'#fff');
  b(7,10,2,2,eyeC);b(15,10,2,2,eyeC);
  g(7,10,'#111');g(16,10,'#111');g(6,9,'#fff');g(14,9,'#fff');

  // Nose + mouth
  g(11,13,'#ff8888');g(12,13,'#ff8888');g(11,14,'#ff8888');g(12,14,'#ff8888');
  g(11,15,'#555');g(12,15,'#555');g(10,16,'#555');g(13,16,'#555');

  // Whiskers
  const wc=fur==='#ecf0f1'?'#aaa':'#ddd';
  b(1,10,2,1,wc);b(0,11,2,1,wc);b(1,12,2,1,wc);b(1,14,2,1,wc);b(0,15,2,1,wc);
  b(21,10,2,1,wc);b(22,11,2,1,wc);b(21,12,2,1,wc);b(21,14,2,1,wc);b(22,15,2,1,wc);

  // Blush
  if(!((h>>6)%2)){b(3,13,2,2,'#ee7777');b(19,13,2,2,'#ee7777');}
}

/* ═══════════════════════════════════════════════════════════════════════════════
   STITCHING ORDER SETTINGS + CAT AVATARS + COMMUNITY PROFILES
   Commented out for later reuse — DO NOT DELETE without asking!
   ═══════════════════════════════════════════════════════════════════════════════
function _catAvatarHTML(uid,seed){
  const s=seed!==undefined?' data-seed="'+seed+'"':'';
  return '<canvas class="cat-avatar" width="48" height="48" data-uid="'+uid+'"'+s+' style="width:48px;height:48px"></canvas>';
}
function _renderCatAvatars(){
  document.querySelectorAll('.cat-avatar').forEach(c=>{
    const uid=c.dataset.uid;
    const seed=c.dataset.seed;
    if(uid){
      if(seed!==undefined){
        const saved=_avatarSeed();
        localStorage.setItem('sashiko_avseed',seed);
        _drawCatAvatar(c,uid);
        localStorage.setItem('sashiko_avseed',saved);
      }else{
        _drawCatAvatar(c,uid);
      }
    }
  });
}
═══════════════════════════════════ END CATS COMMENTED ════════════════════════════ */
// localStorage is always kept as a local cache so the page works offline.
function _saveLocal(){
  try{localStorage.setItem('sashiko_exp',JSON.stringify(EXP_PATTERNS));}catch(e){}
}
function _loadLocal(){
  try{EXP_PATTERNS=JSON.parse(localStorage.getItem('sashiko_exp')||'[]');}catch(e){EXP_PATTERNS=[];}
  // Normalize any patterns saved with raw coords (bbox minU/minV != 0)
  EXP_PATTERNS.forEach(p=>_normalizePat(p));
}
function _normalizePat(pat){
  if(!pat.bbox||(pat.bbox.minU===0&&pat.bbox.minV===0)){/*bbox ok*/}
  else{
    const dU=pat.bbox.maxU-pat.bbox.minU, dV=pat.bbox.maxV-pat.bbox.minV;
    (pat.lines||[]).forEach(l=>{l.start[0]-=pat.bbox.minU;l.start[1]-=pat.bbox.minV;l.end[0]-=pat.bbox.minU;l.end[1]-=pat.bbox.minV;});
    pat.bbox.minU=0;pat.bbox.maxU=dU;pat.bbox.minV=0;pat.bbox.maxV=dV;
  }
  // Compact families: remove unused, renumber used to 0,1,2...
  if(pat.families&&pat.families.length){
    const used=[...new Set(pat.families.filter(f=>f>=0))].sort((a,b)=>a-b);
    if(used.length>0&&used[used.length-1]>=used.length){
      const map={};used.forEach((of,i)=>{map[of]=i;});
      pat.families=pat.families.map(f=>f>=0?map[f]:-1);
      if(pat.famOrder)pat.famOrder=pat.famOrder.filter(f=>used.includes(f)).map(f=>map[f]);
    }
  }
}
function _getUserId(){
  let id=localStorage.getItem('sashiko_uid');
  if(!id){id='u'+Math.random().toString(36).slice(2,12);localStorage.setItem('sashiko_uid',id);}
  return id;
}
// ── Trash (1-week retention) ──────────────────────────────────────────────
const TRASH_KEY='sashiko_trash';
const WEEK_MS=7*24*60*60*1000;
function _loadTrash(){
  try{return JSON.parse(localStorage.getItem(TRASH_KEY)||'[]');}catch(e){return[];}
}
function _saveTrash(trash){
  try{localStorage.setItem(TRASH_KEY,JSON.stringify(trash));}catch(e){}
}
function cleanTrash(){
  const trash=_loadTrash();
  const now=Date.now();
  const kept=trash.filter(t=>now-t.deletedAt<WEEK_MS);
  if(kept.length!==trash.length)_saveTrash(kept);
}
function moveToTrash(pat){
  const trash=_loadTrash();
  trash.unshift({pattern:pat,deletedAt:Date.now()});
  _saveTrash(trash);
}
window.toggleTrash=function(){
  const sec=document.getElementById('trashSection');
  if(!sec)return;
  const open=sec.style.display!=='none';
  sec.style.display=open?'none':'block';
  if(!open)renderTrash();
};
window.restoreFromTrash=function(idx){
  const trash=_loadTrash();
  if(idx<0||idx>=trash.length)return;
  const restored=trash.splice(idx,1)[0].pattern;
  _saveTrash(trash);
  // Clear from deleted list so Firestore sync doesn't filter it out
  try{const del=JSON.parse(localStorage.getItem('sashiko_deleted')||'[]');const i=del.indexOf(restored.id);if(i>=0){del.splice(i,1);localStorage.setItem('sashiko_deleted',JSON.stringify(del));}}catch(e){}
  EXP_PATTERNS.unshift(restored);
  _saveLocal();
  if(_firebaseReady)_pushToFirestore(restored);
  rebuildMyPatsView();
  renderTrash();
};
window.permDeleteFromTrash=function(idx){
  if(!confirm('Permanently delete this pattern? This cannot be undone.'))return;
  const trash=_loadTrash();
  if(idx<0||idx>=trash.length)return;
  trash.splice(idx,1);
  _saveTrash(trash);
  renderTrash();
};
function renderTrash(){
  cleanTrash();
  const el=document.getElementById('trashList');
  if(!el)return;
  const trash=_loadTrash();
  if(!trash.length){el.innerHTML='<p style="font-size:11px;color:#665555;text-align:center;padding:12px">Trash is empty.</p>';return;}
  const now=Date.now();
  el.innerHTML=trash.map((t,i)=>{
    const pat=t.pattern;
    const remaining=Math.max(0,WEEK_MS-(now-t.deletedAt));
    const days=Math.ceil(remaining/(24*60*60*1000));
    const meta=days<=0?'expires soon':days+'d left';
    return`<div class="trash-item">
      <span class="trash-name">${(pat.name||'Custom').replace(/[<>"'&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]))}</span>
      <span class="trash-meta">${meta}</span>
      <button class="trash-restore-btn" onclick="event.stopPropagation();restoreFromTrash(${i})">Restore</button>
      <button class="trash-perm-del-btn" onclick="event.stopPropagation();permDeleteFromTrash(${i})">✕</button>
    </div>`;
  }).join('');
}

/* ═══ CONTINUED: STITCHING PROFILES + FAMILY EDITOR (commented out) ═══
// ── Stitching profiles (per-pattern community submissions) ────────────────
// Subcollection: patterns/{patternId}/profiles/{profileId}
// Each profile: { families, creatorId, creatorLabel, created, likeCount, likedBy:[], dislikeCount, dislikedBy:[] }
async function _saveProfileToFirestore(patternId, families){
  if(!_db){
    console.warn('Firebase not ready — profile saved locally only');
    return;
  }
  const uid=_getUserId();
  const id='sp_'+Date.now();
  const doc={
    id, families, creatorId:uid,
    creatorLabel:_catName(uid),
    avatarSeed:_avatarSeed(),
    created:Date.now(),
    likeCount:0, likedBy:[],
    dislikeCount:0, dislikedBy:[]
  };
  try{await _db.collection('patterns').doc(patternId).collection('profiles').doc(id).set(doc);}
  catch(e){console.warn('Profile save failed:',e);throw e;}
}
async function _fetchProfilesFromFirestore(patternId){
  if(!_db)return[];
  try{
    const snap=await _db.collection('patterns').doc(patternId).collection('profiles')
      .orderBy('created','desc').get();
    return snap.docs.map(d=>d.data());
  }catch(e){console.warn('Profile fetch failed:',e);return[];}
}
async function _deleteProfileFromFirestore(patternId, profileId){
  if(!_db)return;
  try{await _db.collection('patterns').doc(patternId).collection('profiles').doc(profileId).delete();}
  catch(e){console.warn('Profile delete failed:',e);}
}
async function _voteProfile(patternId, profileId, delta){
  if(!_db)return;
  const uid=_getUserId();
  const ref=_db.collection('patterns').doc(patternId).collection('profiles').doc(profileId);
  try{
    await _db.runTransaction(async t=>{
      const snap=await t.get(ref);
      if(!snap.exists)return;
      const d=snap.data();
      const likedBy=d.likedBy||[], dislikedBy=d.dislikedBy||[];
      let lc=d.likeCount||0, dc=d.dislikeCount||0;
      // Remove existing votes by this user
      const wasLiked=likedBy.indexOf(uid);
      if(wasLiked>=0){likedBy.splice(wasLiked,1);lc--;}
      const wasDisliked=dislikedBy.indexOf(uid);
      if(wasDisliked>=0){dislikedBy.splice(wasDisliked,1);dc--;}
      // Add new vote
      if(delta===1 && wasLiked<0){likedBy.push(uid);lc++;}
      if(delta===-1 && wasDisliked<0){dislikedBy.push(uid);dc++;}
      t.update(ref,{likeCount:lc,dislikeCount:dc,likedBy,dislikedBy});
    });
  }catch(e){console.warn('Vote failed:',e);}
}
══════ END PROFILES COMMENTED ══════ */
// Upload a single pattern to Firestore (thumbnail stripped — too large for 1 MB doc limit)
async function _pushToFirestore(pat){
  if(!_db)return;
  if(!pat.creatorId)pat.creatorId=_getUserId();
  const doc={...pat};delete doc.thumbnail;
  // Firestore rejects undefined values — strip them
  Object.keys(doc).forEach(k=>{if(doc[k]===undefined)delete doc[k];});
  try{
    await _db.collection('patterns').doc(pat.id).set(doc);
  }catch(e){console.warn('Firestore write failed:',e);}
}

// Push all local patterns that are missing from Firestore (first-time sync, offline recovery)
async function _syncLocalToFirestore(){
  if(!_firebaseReady)return;
  const uid=_getUserId();
  for(const pat of EXP_PATTERNS){
    if(!pat.creatorId){pat.creatorId=uid;}
    await _pushToFirestore(pat);
  }
  _saveLocal();
}

async function _deleteFromFirestore(id){
  if(!_db)return;
  try{await _db.collection('patterns').doc(id).delete();}catch(e){console.warn('Firestore delete failed:',e);}
}

// Seed patterns from embedded backup data into localStorage (once per origin),
// so offline / file:// testing also has the same seed patterns as the live site.
function _seedLocalFromBackup(){
  if(localStorage.getItem('sashiko_backup_seeded'))return;
  const data=typeof SEED_PATTERNS!=='undefined'?SEED_PATTERNS:null;
  if(!data||!Array.isArray(data.patterns))return;
  const existingIds=new Set(EXP_PATTERNS.map(p=>p.id));
  let added=false;
  for(const p of data.patterns){
    if(!p.id||existingIds.has(p.id))continue;
    if(!p.creatorId)p.creatorId=_getUserId();
    EXP_PATTERNS.push(p);
    added=true;
  }
  if(added)_saveLocal();
  localStorage.setItem('sashiko_backup_seeded','1');
}

// Fetch all patterns from Firestore, intelligently merge with local.
// Timestamp-based: newer version wins for duplicate IDs.
// Local-only patterns (new) get pushed to Firestore automatically.
async function _fetchFromFirestore(){
  if(!_db)return;
  try{
    const snap=await _db.collection('patterns').orderBy('createdAt','desc').get();
    const remote=snap.docs.map(d=>d.data());
    const remoteById=Object.fromEntries(remote.map(p=>[p.id,p]));
    const uid=_getUserId();

    // Filter out patterns that were explicitly deleted by the user
    let deletedIds=[];
    try{deletedIds=JSON.parse(localStorage.getItem('sashiko_deleted')||'[]');}catch(e){}

    const localById=Object.fromEntries(EXP_PATTERNS.map(p=>[p.id,p]));
    const merged=[];
    const seenIds=new Set();

    // Merge: newer timestamp wins for duplicate IDs
    for(const p of remote){
      if(deletedIds.indexOf(p.id)>=0)continue; // skip user-deleted
      seenIds.add(p.id);
      const lpat=localById[p.id];
      if(lpat && (lpat.createdAt||0) >= (p.createdAt||0)){
        // Local is same age or newer — keep local, push to Firestore if newer
        merged.push({...lpat});
        if((lpat.createdAt||0) > (p.createdAt||0)){
          await _pushToFirestore(lpat);
        }
      }else{
        // Remote is newer or local doesn't have it
        merged.push({...p,thumbnail:null});
        _saveLocal();
      }
    }

    // Local patterns not in remote: push to Firestore (they're new)
    for(const p of EXP_PATTERNS){
      if(seenIds.has(p.id))continue;
      merged.push(p);
      if(!p.creatorId)p.creatorId=uid;
      await _pushToFirestore(p);
    }

    EXP_PATTERNS=merged;
    EXP_PATTERNS.forEach(p=>_normalizePat(p));
    _saveLocal();
    buildGallery();
  }catch(e){console.warn('Firestore fetch failed, using local cache:',e);}
}
// ── Public API ───────────────────────────────────────────────────────────────
function loadExpPatterns(){
  _loadLocal();
  cleanTrash();
  _seedLocalFromBackup();
  _initFirebase();
  if(_firebaseReady){
    _fetchFromFirestore()
      .then(()=>{
        rebuildMyPatsView();
        // Re-check deep link for exp patterns (Firebase wasn't ready at init time)
        const hash=location.hash.slice(1);
        if(hash&&!PATTERNS.find(p=>p.id===hash)){
          const exp=EXP_PATTERNS.find(p=>p.id===hash);
          if(exp)openExpPattern(exp);
        }
      });
  }
}

// Kept for console access during migration: syncPatternsToCloud()
window.syncPatternsToCloud=async function(){
  if(!_firebaseReady){_initFirebase();if(!_firebaseReady){console.warn('Firebase not available');return;}}
  await _syncLocalToFirestore();
  await _fetchFromFirestore();
  rebuildMyPatsView();
  console.log('Synced. '+EXP_PATTERNS.length+' patterns.');
};

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
  const bbox=pat.bbox||{minU:0,maxU:ptc,minV:0,maxV:ptc};
  const dU=Math.max(bbox.maxU-bbox.minU,1);
  const dV=Math.max(bbox.maxV-bbox.minV,1);
  let sz,ox,oy;
  if(iso){
    sz=SIZE/(2*ptc*_COS30);
    // Place bbox centre at canvas centre: g2s([dU/2, dV/2]) = (SIZE/2, SIZE/2)
    ox=SIZE/2-(dU/2-dV/2)*sz*_COS30;
    oy=SIZE/2-(dU/2+dV/2)*sz*_SIN30;
  }else{
    sz=SIZE/ptc;
    // Place bbox centre at canvas centre
    ox=(ptc-dU)/2*sz; oy=(ptc-dV)/2*sz;
  }
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
      for(let du=-2*dU;du<=2*dU;du+=dU){
        for(let dv=-2*dV;dv<=2*dV;dv+=dV){
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
  const families=pat.families||detectSymmetryFamilies(pat);
  const nLines=(pat.lines||[]).length;
  const famOfLine=new Array(nLines);
  if(families.length>0&&Array.isArray(families[0])){
    families.forEach((group,fi)=>{group.forEach(li=>{famOfLine[li]=fi;});});
  }else{
    families.forEach((fi,li)=>{famOfLine[li]=fi;});
  }
  let nextFam=Math.max(0,...famOfLine.filter(f=>f>=0))+1;
  for(let li=0;li<nLines;li++){
    if(famOfLine[li]===undefined||famOfLine[li]<0)famOfLine[li]=nextFam++;
  }
  const lines=pat.lines||[];
  const spacing=pat.spacing||0;
  const segs=[];
  if(pat.bboxRotated){
    // 45° rotated diamond tiling: use p=u+v, q=u-v axes
    let mnP=Infinity,mxP=-Infinity,mnQ=Infinity,mxQ=-Infinity;
    lines.forEach(l=>{
      const p1=l.start[0]+l.start[1], q1=l.start[0]-l.start[1];
      const p2=l.end[0]+l.end[1], q2=l.end[0]-l.end[1];
      mnP=Math.min(mnP,p1,p2);mxP=Math.max(mxP,p1,p2);
      mnQ=Math.min(mnQ,q1,q2);mxQ=Math.max(mxQ,q1,q2);
    });
    const sP=Math.max(mxP-mnP+spacing,1), sQ=Math.max(mxQ-mnQ+spacing,1);
    const base_u=(mnP+mnQ)/2, base_v=(mnP-mnQ)/2;
    const pad=sP+sQ;
    const N=Math.ceil((Math.abs(maxU-minU)+Math.abs(maxV-minV)+pad)/Math.min(sP,sQ));
    for(let a=-N;a<=N;a++){
      for(let b=-N;b<=N;b++){
        const ou=(a*sP+b*sQ)/2, ov=(a*sP-b*sQ)/2;
        lines.forEach((l,li)=>{
          const c=clipSegConvex([l.start[0]+ou,l.start[1]+ov],[l.end[0]+ou,l.end[1]+ov],lay.planes);
          if(c)segs.push({start:c[0],end:c[1],fam:famOfLine[li]});
        });
      }
    }
  }else{
    const su=dU+spacing, sv=dV+spacing;
    const ou0=Math.floor((minU-dU)/su)*su, ou1=Math.ceil((maxU-0)/su)*su;
    const ov0=Math.floor((minV-dV)/sv)*sv, ov1=Math.ceil((maxV-0)/sv)*sv;
    for(let ou=ou0;ou<=ou1;ou+=su){
      for(let ov=ov0;ov<=ov1;ov+=sv){
        lines.forEach((l,li)=>{
          const c=clipSegConvex([l.start[0]+ou,l.start[1]+ov],[l.end[0]+ou,l.end[1]+ov],lay.planes);
          if(c)segs.push({start:c[0],end:c[1],fam:famOfLine[li]});
        });
      }
    }
  }
  return segs;
}

// Resize cv for this exp pattern, store EXP_g2s/EXP_canvasH, re-apply DPR scale.
function setupExpCanvas(pat){
  const lay=computeExpLayout(pat);
  EXP_g2s=lay.g2s; EXP_canvasH=lay.canvasH;
  _setupCanvasSize(SIZE,EXP_canvasH);
}

/* ═══════ FAMILY EDITOR + PUBLISH (commented out for later reuse) ═══════
// ── Family editor (unit cell, inside Stitching Order Settings) ──────────
let _famSel=0, _famCount=0;
function initExpFamilies(pat){
  if(!pat.families)pat.families=new Array((pat.lines||[]).length).fill(-1);
}
function autoAssignFamilies(pat){
  const lines=pat.lines||[];
  if(!lines.length)return;
  const iso=pat.gridType==='isometric';
  const THRESH=5*Math.PI/180; // 5 degrees
  // Compute orientation angle in [0,π) — opposite directions are the same line
  const angles=lines.map(l=>{
    const du=l.end[0]-l.start[0], dv=l.end[1]-l.start[1];
    let dx=du, dy=dv;
    if(iso){dx=du-dv; dy=du+dv;}
    if(!dx&&!dy)return 0;
    const a=Math.atan2(dy,dx);
    return a<0?a+Math.PI:a;
  });
  function angDist(a,b){
    let d=Math.abs(a-b);
    if(d>Math.PI/2)d=Math.PI-d;
    return d;
  }
  // Greedy grouping: each line joins the first existing group within threshold
  const groups=[];
  for(let i=0;i<lines.length;i++){
    let found=false;
    for(const g of groups){
      if(angDist(angles[i],g.angle)<THRESH){g.members.push(i);found=true;break;}
    }
    if(!found)groups.push({angle:angles[i],members:[i]});
  }
  // Assign families sorted by angle
  groups.sort((a,b)=>a.angle-b.angle);
  pat.families=new Array(lines.length).fill(-1);
  groups.forEach((g,fi)=>{g.members.forEach(i=>{pat.families[i]=fi;});});
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
  const badge=tog.querySelector('.prof-badge')?.textContent||'';
  tog.innerHTML='⚙ Stitching Order Settings '+(open?'▸':'▾')+(badge?' <span class=\"prof-badge\">'+badge+'</span>':'');
  tog.classList.toggle('on',!open);
  if(!open)renderFamEditor();
}
window.toggleStitchSettings=toggleStitchSettings;

async function updateProfileBadge(){
  const tog=document.getElementById('stitchToggle');
  if(!curPat||!curPat.id||!_firebaseReady||!tog)return;
  try{
    const profiles=await _fetchProfilesFromFirestore(curPat.id);
    const badge=profiles.length?' <span class=\"prof-badge\">'+profiles.length+'</span>':'';
    const open=document.getElementById('stitchBody')?.style.display!=='none';
    tog.innerHTML='⚙ Stitching Order Settings '+(open?'▾':'▸')+badge;
  }catch(e){}
}
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

  // Build swatches (click to select, click a line to assign)
  sw.innerHTML='';
  for(let f=0;f<_famCount;f++){
    const b=document.createElement('button');
    b.className='fam-swatch'+(f===_famSel?' sel':'');
    b.style.background=famColor(f);
    b.title='Family '+(f+1)+' — click line to assign';
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

  // Fetch and render community profiles (async)
  if(curPat.id&&_firebaseReady){
    _fetchProfilesFromFirestore(curPat.id).then(profiles=>renderProfileList(profiles));
  }else{
    renderProfileList([]);
  }
}

function renderProfileList(profiles){
  const el=document.getElementById('profileList');
  if(!el)return;
  const uid=_getUserId();
  profiles.sort((a,b)=>(b.likeCount-b.dislikeCount)-(a.likeCount-a.dislikeCount)||b.created-a.created);
  if(!profiles.length){el.innerHTML='';return;}
  el.innerHTML='<div class="profile-title">Community stitching profiles</div>'+profiles.map(p=>{
    const score=p.likeCount-p.dislikeCount;
    const isOwn=p.creatorId===uid;
    const wasLiked=(p.likedBy||[]).includes(uid);
    const wasDisliked=(p.dislikedBy||[]).includes(uid);
    return`<div class="profile-item">
      <div class="cat-avatar-wrap">`+_catAvatarHTML(p.creatorId,p.avatarSeed)+`</div>
      <div class="prof-info">${p.creatorLabel||'Anonymous'}</div>
      <div class="prof-votes">
        <button class="${wasLiked?'liked':''}" onclick="voteProfile('${p.id}',1)" title="Like">👍</button>
        <span class="vc">${score>0?'+'+score:score}</span>
        <button class="${wasDisliked?'disliked':''}" onclick="voteProfile('${p.id}',-1)" title="Dislike">👎</button>
      </div>
      <div class="prof-actions">
        <button onclick="loadStitchingProfile('${p.id}')" title="Apply">Load</button>
        ${isOwn?'<button onclick="deleteStitchingProfile(\''+p.id+'\')" title="Delete">✕</button>':''}
      </div>
    </div>`;
  }).join('');
  setTimeout(_renderCatAvatars,0);
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
  if(best===fc._lastPainted&&_famPainting)return; // skip if same line during drag
  fc._lastPainted=best;
  initExpFamilies(curPat);
  // Toggle: if already assigned to _famSel, unassign (-1). Otherwise assign to _famSel.
  curPat.families[best]=curPat.families[best]===_famSel?-1:_famSel;
  // Save and re-route
  const orig=EXP_PATTERNS.find(p=>p.id===curPat.id);
  if(orig)orig.families=[...curPat.families];
  _saveLocal();
  if(_firebaseReady&&orig) _pushToFirestore(orig);
  renderFamEditor();
  if(!_famPainting) rerouteExp(); // only reroute on click, not during drag
}
// On mouseup after drag, do the final reroute
document.addEventListener('mouseup',()=>{
  if(_famPainting){_famPainting=false;if(curPat&&curPat.type==='exp')rerouteExp();}
});

// ── Profile sharing ──────────────────────────────────────────────────────
async function saveStitchingProfile(){
  if(!curPat||!curPat.id)return;
  initExpFamilies(curPat);
  const btn=document.getElementById('profileSaveBtn');
  if(!btn)return;
  if(!_firebaseReady){btn.textContent='Firebase not connected';setTimeout(()=>{btn.textContent='⊕ Share this stitching order';btn.disabled=false;},2000);return;}
  btn.textContent='Saving…';btn.disabled=true;
  try{
    // Ensure pattern exists in Firestore first
    await _pushToFirestore(curPat);
    await _saveProfileToFirestore(curPat.id, [...curPat.families]);
    btn.textContent='✓ Shared!';
  }catch(e){
    console.error('Share failed:',e);
    btn.textContent='Failed — retry';
  }
  setTimeout(()=>{btn.textContent='⊕ Share this stitching order';btn.disabled=false;},2000);
  renderFamEditor();
  updateProfileBadge();
}
window.saveStitchingProfile=saveStitchingProfile;
window.loadStitchingProfile=async function(profileId){
  if(!curPat)return;
  const profiles=await _fetchProfilesFromFirestore(curPat.id);
  const prof=profiles.find(p=>p.id===profileId);
  if(!prof)return;
  curPat.families=[...prof.families];
  const orig=EXP_PATTERNS.find(p=>p.id===curPat.id);
  if(orig)orig.families=[...curPat.families];
  _saveLocal();
  _famToggles={};
  setupExpCanvas(curPat);
  EXP_path=buildExpPath(genTiledSegs(curPat),curPat.famOrder,curPat.routingMode);
  TOTAL=EXP_path.length; PASSES=[];
  step=TOTAL;
  if(playing)pause();
  buildJumpBar();render(step);
  renderFamEditor();
};
window.deleteStitchingProfile=async function(profileId){
  if(!curPat||!confirm('Delete this stitching order?'))return;
  await _deleteProfileFromFirestore(curPat.id,profileId);
  renderFamEditor();
};
window.voteProfile=async function(profileId,delta){
  if(!curPat)return;
  if(!_firebaseReady){alert('Firebase not connected — cannot vote.');return;}
  await _voteProfile(curPat.id,profileId,delta);
  renderFamEditor();
};
// ── Publish to main library ────────────────────────────────────────────
function publishToLibrary(){
  const pw=prompt('Admin password:');
  if(pw!=='111'){alert('Wrong password');return;}
  if(!curPat||!curPat.id)return;
  initExpFamilies(curPat);
  const orig=EXP_PATTERNS.find(p=>p.id===curPat.id);
  if(orig){
    orig.published=true;
    _saveLocal();
    if(_firebaseReady) _pushToFirestore(orig);
    alert('Published! Visible in main gallery.');
  }
}
window.publishToLibrary=publishToLibrary;
═══════════════════════════════════════════════════════════════════════════════ */
window.editExpPattern=function(idOrPat){
  const pat=typeof idOrPat==='string'?EXP_PATTERNS.find(p=>p.id===idOrPat):idOrPat;
  if(!pat)return;
  const pw=prompt('Admin password:');
  if(pw!=='111'){alert('Wrong password');return;}
  cadHistory=[];
  cadTool='draw';
  cadArcState=0;cadArcCenter=null;cadArcStart=null;
  document.getElementById('cadGridType').value=pat.gridType||'isometric';
  const maxDim=Math.max(pat.bbox.maxU,pat.bbox.maxV);
  const macroVal=Math.max(2,Math.min(6,Math.ceil(maxDim/CAD_MICRO)));
  // Center lines in the grid: shift so bbox center lands at grid center
  {const tc=macroVal*CAD_MICRO;
   const cu=(pat.bbox.minU+pat.bbox.maxU)/2, cv=(pat.bbox.minV+pat.bbox.maxV)/2;
   const gc=tc/2;
   cadLines=pat.lines.map(l=>({start:[l.start[0]+gc-cu,l.start[1]+gc-cv],end:[l.end[0]+gc-cu,l.end[1]+gc-cv],...(l.arc?{arc:true}:{})}));
  }
  // Restore families and order from saved pattern
  cadFamilies=(pat.families||[]).slice();
  while(cadFamilies.length<cadLines.length)cadFamilies.push(-1);
  cadFamOrder=(pat.famOrder||[]).slice();
  cadFamsLocked=cadFamilies.some(f=>f>=0);
  cadFamSel=-1;
  cadBBoxRotated=pat.bboxRotated||false;
  cadRoutingMode=pat.routingMode||'default';
  // Legacy smooth/fewer-jumps are Logik-1 variants — collapse to the Straight option.
  if(cadRoutingMode==='smooth'||cadRoutingMode==='fewer-jumps')cadRoutingMode='default';
  document.getElementById('cadRoutingMode').value=cadRoutingMode;
  cadSpacing=parseInt(pat.spacing)||0;
  document.getElementById('cadSpacing').value=cadSpacing;
  document.getElementById('cadGridSize').value=macroVal;
  const pmOpts=[3,4,5,8,12];let bestPM=5,bestD=Infinity;
  pmOpts.forEach(o=>{const d=Math.abs(o-(pat.patMacro||5));if(d<bestD){bestD=d;bestPM=o;}});
  document.getElementById('cadPatSize').value=bestPM;
  document.getElementById('cadPatName').value=pat.name||'Custom Pattern';
  cadEditId=pat.id;
  cadIsPublished=pat.published||false;
  cadInited=false;
  document.getElementById('galleryView').style.display='none';
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.remove('open');
  document.getElementById('cadView').classList.add('open');
  cadInit();
  cadSetTool('draw');
  window.scrollTo({top:0,behavior:'smooth'});
};
function distToSeg(px,py,ax,ay,bx,by){
  const l2=(bx-ax)**2+(by-ay)**2;
  if(l2===0)return Math.hypot(px-ax,py-ay);
  let t=((px-ax)*(bx-ax)+(py-ay)*(by-ay))/l2;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-ax-t*(bx-ax),py-ay-t*(by-ay));
}

// ── Routing helpers ──────────────────────────────────────────────────────────
function _seg2Intersect(a0,a1,b0,b1){
  const dx1=a1[0]-a0[0],dy1=a1[1]-a0[1],dx2=b1[0]-b0[0],dy2=b1[1]-b0[1];
  const den=dx1*dy2-dy1*dx2; if(Math.abs(den)<1e-10)return false;
  const t=((b0[0]-a0[0])*dy2-(b0[1]-a0[1])*dx2)/den;
  const u=((b0[0]-a0[0])*dy1-(b0[1]-a0[1])*dx1)/den;
  return t>0.01&&t<0.99&&u>0.01&&u<0.99;
}
function _retraceCost(from,to,stitched){
  for(const s of stitched)if(_seg2Intersect(from,to,s.start,s.end))return 500;
  return 0;
}
function _rotateClosedEntry(pts,needle){
  const n=pts.length-1; if(n<2)return pts;
  let best=0,bestD=Infinity;
  for(let r=0;r<n;r++){const d=Math.hypot(pts[r][0]-needle[0],pts[r][1]-needle[1]);if(d<bestD){bestD=d;best=r;}}
  if(best===0)return pts;
  const core=pts.slice(0,n);
  return[...core.slice(best),...core.slice(0,best),core[best].slice()];
}
function _permute(arr){
  if(arr.length<=1)return[arr.slice()];
  const r=[];
  arr.forEach((x,i)=>{const rest=[...arr.slice(0,i),...arr.slice(i+1)];_permute(rest).forEach(p=>r.push([x,...p]));});
  return r;
}

// Build animation path: family-first routing with optimised family order.
// Pre-builds all family strokes, then brute-force (≤7 families) or greedy NN finds
// the visitation order that minimises total inter-family jump distance.
// Closed-loop strokes rotate their entry vertex to be nearest the current needle.
// Retrace penalty (500 units) discourages jumps that cross already-stitched segments.
// Merge chain endpoints within tolerance — stitches arc sub-chains into full wave paths.
// Greedy O(n²) per pass; fast enough for typical sashiko tile counts (<500 chains).
function _stitchChains(chains, tol){
  if(chains.length<=1)return chains;
  const d2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2, t2=tol*tol;
  let any=true;
  while(any){
    any=false;
    done:for(let i=0;i<chains.length;i++){
      const a=chains[i], aS=a[0], aE=a[a.length-1];
      for(let j=i+1;j<chains.length;j++){
        const b=chains[j], bS=b[0], bE=b[b.length-1];
        let merged=null;
        if(d2(aE,bS)<=t2)      merged=[...a,...b.slice(1)];
        else if(d2(aE,bE)<=t2) merged=[...a,...b.slice().reverse().slice(1)];
        else if(d2(aS,bE)<=t2) merged=[...b,...a.slice(1)];
        else if(d2(aS,bS)<=t2) merged=[...b.slice().reverse(),...a.slice(1)];
        if(merged){chains[i]=merged;chains.splice(j,1);any=true;break done;}
      }
    }
  }
  return chains;
}

function buildExpPath(lines, famOrderOverride, routingMode){
  if(!lines||!lines.length)return[];

  const mode=routingMode||'default';
  // Logik 1 (default) + legacy smooth/fewer-jumps = family band-snake, varying turn budget.
  // Logik 2 (continuous) = global-NN follow-path. Logik 3 (contour) = outline shapes, float between.
  const maxTurnMap={smooth:60*Math.PI/180, default:90*Math.PI/180, 'fewer-jumps':120*Math.PI/180, continuous:Math.PI, contour:90*Math.PI/180};
  const maxTurn=maxTurnMap[mode]||90*Math.PI/180;

  const famGroups=new Map();
  lines.forEach(l=>{const fi=l.fam||0;if(!famGroups.has(fi))famGroups.set(fi,[]);famGroups.get(fi).push(l);});

  if(mode==='continuous'){
    // Follow-path: build strokes per family with no turn limit,
    // then order all chains globally via nearest-neighbour.
    const allChains=[];
    for(const[fi,segs]of famGroups){
      buildStrokesForFamily(segs,maxTurn).forEach(pts=>allChains.push({pts,fi}));
    }
    const rem=allChains.slice(), path=[];
    let cur=null;
    while(rem.length){
      let best=-1,bd=Infinity,brev=false;
      for(let i=0;i<rem.length;i++){
        const{pts}=rem[i];
        const s=pts[0],e=pts[pts.length-1];
        const ds=cur?Math.hypot(s[0]-cur[0],s[1]-cur[1]):0;
        const de=cur?Math.hypot(e[0]-cur[0],e[1]-cur[1]):0;
        if(ds<bd){bd=ds;best=i;brev=false;}
        if(de<bd){bd=de;best=i;brev=true;}
      }
      const{pts:rawPts,fi}=rem[best];
      const pts=brev?rawPts.slice().reverse():[...rawPts];
      for(let k=0;k<pts.length-1;k++){
        path.push({start:pts[k],end:pts[k+1],jump:!!cur&&k===0,fam:fi});
      }
      cur=pts[pts.length-1];
      rem.splice(best,1);
    }
    return path;
  }

  if(mode==='contour'){
    // Logik 3 — Contour stitching with wave rastering.
    // 1. Trace each closed shape / connected curve as ONE smooth outline (min-deflection,
    //    turn budget 90° → right-angle corners stay in-stroke, sharper pointed turns break
    //    instead of being forced → flowing curves, no spikes).
    // 2. Sweep the strokes in orientation-aware bands with snaking (orderStrokesFamily),
    //    so long smooth curves/waves are taken lane-by-lane — diagonal lanes included.
    // Closed loops enter at the point nearest the needle; shapes never merge.
    const pooled=[], fiOf=new Map();
    for(const[fi,segs]of famGroups){
      buildStrokesForFamily(segs,maxTurn).forEach(pts=>{pooled.push(pts);fiOf.set(pts,fi);});
    }
    if(!pooled.length)return[];
    const ordered=orderStrokesFamily(pooled);  // band-snake; pts references preserved
    const path=[]; let cur=null;
    for(const s of ordered){
      const fi=fiOf.get(s.pts);
      let pts=s.pts;
      if(cur){
        const dS=Math.hypot(pts[0][0]-cur[0],pts[0][1]-cur[1]);
        const dE=Math.hypot(pts[pts.length-1][0]-cur[0],pts[pts.length-1][1]-cur[1]);
        if(dE<dS)pts=pts.slice().reverse();
      }
      if(cur&&pts.length>=3&&Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1e-3)
        pts=_rotateClosedEntry(pts,cur);
      for(let k=0;k<pts.length-1;k++)
        path.push({start:pts[k],end:pts[k+1],jump:!!cur&&k===0,fam:fi});
      cur=pts[pts.length-1];
    }
    return path;
  }

  // Family-by-family routing: build strokes per family, order with band-snake,
  // then visit families in optimised order.
  const famStrokes=new Map(), famEnds=new Map();
  for(const[fi,segs]of famGroups){
    const ordered=orderStrokesFamily(buildStrokesForFamily(segs,maxTurn));
    if(!ordered.length)continue;
    famStrokes.set(fi,ordered);
    const p0=ordered[0].pts[0];
    const p1=ordered[ordered.length-1].pts[ordered[ordered.length-1].pts.length-1];
    famEnds.set(fi,{p0,p1});
  }
  if(!famStrokes.size)return[];

  // Determine family visitation order
  const allFamIds=[...famStrokes.keys()];
  let bestOrder;
  if(famOrderOverride && famOrderOverride.length){
    bestOrder=famOrderOverride.filter(fi=>famStrokes.has(fi));
    for(const fi of allFamIds)if(!bestOrder.includes(fi))bestOrder.push(fi);
  }else{
    bestOrder=allFamIds;
  }

  // Optimise family visitation order: minimise total inter-family jump
  if(bestOrder.length>1&&!famOrderOverride){
    const evalPerm=perm=>{
      let cost=0,cur2=null;
      for(const fi of perm){
        const{p0,p1}=famEnds.get(fi);
        if(!cur2){cur2=p1;continue;}
        const dF=Math.hypot(p0[0]-cur2[0],p0[1]-cur2[1]);
        const dB=Math.hypot(p1[0]-cur2[0],p1[1]-cur2[1]);
        if(dF<=dB){cost+=dF;cur2=p1;}else{cost+=dB;cur2=p0;}
      }
      return cost;
    };
    if(bestOrder.length<=7){
      let bestCost=Infinity;
      for(const p of _permute(bestOrder)){const c=evalPerm(p);if(c<bestCost){bestCost=c;bestOrder=p;}}
    }else{
      const rem=new Set(bestOrder);bestOrder=[];let cur2=null;
      while(rem.size){
        let bf=null,bd=Infinity,useFront=true;
        for(const fi of rem){
          const{p0,p1}=famEnds.get(fi);
          const dF=cur2?Math.hypot(p0[0]-cur2[0],p0[1]-cur2[1]):0;
          const dB=cur2?Math.hypot(p1[0]-cur2[0],p1[1]-cur2[1]):0;
          const d=cur2?Math.min(dF,dB):0;
          if(d<bd){bd=d;bf=fi;useFront=!cur2||dF<=dB;}
        }
        rem.delete(bf);bestOrder.push(bf);
        const{p0,p1}=famEnds.get(bf);cur2=useFront?p1:p0;
      }
    }
  }

  const path=[];
  const stitched=[];
  let cur=null;

  for(const fi of bestOrder){
    const ordered=famStrokes.get(fi);
    if(cur&&ordered.length>0){
      const sFirst=ordered[0].pts, sLast=ordered[ordered.length-1].pts;
      const fPt=sFirst[0], bPt=sLast[sLast.length-1];
      const dF=Math.hypot(fPt[0]-cur[0],fPt[1]-cur[1])+_retraceCost(cur,fPt,stitched);
      const dB=Math.hypot(bPt[0]-cur[0],bPt[1]-cur[1])+_retraceCost(cur,bPt,stitched);
      if(dB<dF){ordered.reverse();ordered.forEach(s=>{s.pts=s.pts.slice().reverse();});}
    }
    for(let si=0;si<ordered.length;si++){
      let pts=ordered[si].pts;
      if(cur&&pts.length>=3&&Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1e-3)
        pts=_rotateClosedEntry(pts,cur);
      if(cur){
        const dS=Math.hypot(pts[0][0]-cur[0],pts[0][1]-cur[1]);
        const dE=Math.hypot(pts[pts.length-1][0]-cur[0],pts[pts.length-1][1]-cur[1]);
        if(dE<dS)pts=pts.slice().reverse();
      }
      for(let k=0;k<pts.length-1;k++){
        path.push({start:pts[k],end:pts[k+1],jump:!!cur&&k===0,fam:fi});
        stitched.push({start:pts[k],end:pts[k+1]});
      }
      cur=pts[pts.length-1];
    }
  }
  return path;
}

// ── Stroke formation for one family (Rule 1: min-deflection) ──────────────
function buildStrokesForFamily(segs, maxTurn){
  const Q=1e-4;

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
    partner[v].set(matchVertex(d,cost,maxTurn));
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

  // detect natural band pitch — use 4-decimal rounding, not Math.round, to avoid integer aliasing
  const sortedBcs=[...new Set(S.map(s=>+s.bc.toFixed(4)))].sort((a,b)=>a-b);
  let pitch=Infinity;
  for(let i=1;i<sortedBcs.length;i++)pitch=Math.min(pitch,sortedBcs[i]-sortedBcs[i-1]);
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
    // Deterministic greedy: sort pairs by cost ascending, pick cheapest available
    const allPairs=[];
    for(let i=0;i<d;i++)for(let j=i+1;j<d;j++){const c=cost(i,j); if(c<=maxCost)allPairs.push([c,i,j]);}
    if(!allPairs.length) return new Int32Array(d).fill(-1);
    allPairs.sort((a,b)=>a[0]-b[0]);
    const arr=new Int32Array(d).fill(-1), used=new Uint8Array(d);
    for(const[c,i,j]of allPairs){if(!used[i]&&!used[j]){used[i]=used[j]=1;arr[i]=j;arr[j]=i;}}
    return arr;
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
  const STEP=10;
  const u0=Math.floor(minU/STEP)*STEP, u1=Math.ceil(maxU/STEP)*STEP;
  const v0=Math.floor(minV/STEP)*STEP, v1=Math.ceil(maxV/STEP)*STEP;
  // Grid lines — match CAD style exactly
  ctx.strokeStyle='rgba(220,235,255,0.15)'; ctx.lineWidth=zlw(1.5); ctx.setLineDash([]);
  for(let u=u0;u<=u1;u+=STEP){
    const a=EXP_g2s([u,v0]),b=EXP_g2s([u,v1]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  for(let v=v0;v<=v1;v+=STEP){
    const a=EXP_g2s([u0,v]),b=EXP_g2s([u1,v]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  // Sub-grid dots + main intersections — match CAD size
  ctx.fillStyle='rgba(160,160,184,0.25)';
  const sds=zlw(2), mds=zlw(4);
  for(let u=u0;u<=u1;u++){
    for(let v=v0;v<=v1;v++){
      const onMain=(u%STEP===0)&&(v%STEP===0);
      const p=EXP_g2s([u,v]);
      const d=onMain?mds:sds;
      ctx.fillRect(p.x-d/2,p.y-d/2,d,d);
    }
  }
}

function renderExp(step){
  const ch=EXP_canvasH||SIZE;
  // Fabric background
  ctx.fillStyle='#1a3a5c'; ctx.fillRect(0,0,SIZE,ch);
  drawExpGuide();
  if(!EXP_path.length)return;
  // Completed stitches — coloured by family (skip toggled-off)
  ctx.lineWidth=zlw(3); ctx.lineCap='round';
  for(let i=0;i<Math.min(step,EXP_path.length);i++){
    const s=EXP_path[i];
    if(_famToggles[s.fam]===false)continue;
    const p1=EXP_g2s(s.start),p2=EXP_g2s(s.end);
    ctx.strokeStyle=famColor(s.fam);
    ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
  }
  // Needle (skip if toggled off)
  if(step>0&&step<=EXP_path.length){
    const s=EXP_path[step-1];
    if(_famToggles[s.fam]!==false){
      const col=famColor(s.fam);
      const p=EXP_g2s(s.end);
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,16);
      g.addColorStop(0,hexA(col,0.55));g.addColorStop(1,hexA(col,0));
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,16,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=col;ctx.beginPath();ctx.arc(p.x,p.y,3.4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.x-1,p.y-1,1.1,0,Math.PI*2);ctx.fill();
    }
  }
}

window.openExpPattern=function openExpPattern(idOrPat){
  const pat=typeof idOrPat==='string'?EXP_PATTERNS.find(p=>p.id===idOrPat):idOrPat;
  if(!pat)return;
  // Track source: if gallery is visible we came from there, otherwise sandbox
  _animSource=document.getElementById('galleryView').style.display!=='none'?'gallery':'sandbox';
  history.replaceState(null,'','#'+pat.id);
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
};

// Re-run the router on the current custom pattern (no redraw needed when routing rules change).
window.rerouteExp=function rerouteExp(){
  if(!curPat||curPat.type!=='exp')return;
  setupExpCanvas(curPat);
  EXP_path=buildExpPath(genTiledSegs(curPat),curPat.famOrder,curPat.routingMode);
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
      <span class="pcard-badge">${pat.traditional?'Traditional · ':''}${pat.gridType==='isometric'?'Iso':'Sq'} · ${new Set((pat.families||[]).filter(f=>f>=0)).size||1} passes</span>
    </div>
    <div class="like-row" data-id="${esc(pat.id)}"></div>
    <button class="exp-edit-btn" title="Edit (admin)" onclick="event.stopPropagation();editExpPattern('${esc(pat.id)}')">✎</button>
    <button class="exp-del-btn" title="Delete" onclick="event.stopPropagation();removeExpPattern('${esc(pat.id)}')">✕</button>
  </div>`;
}

function rebuildMyPatsView(){
  const grid=document.getElementById('myPatsGrid');
  if(!grid)return;
  grid.innerHTML='';
  const unpub=EXP_PATTERNS.filter(p=>!p.published);
  if(!unpub.length){
    const offline=!_firebaseReady?' (offline — patterns sync when Firebase is configured)':'';
    grid.innerHTML=`<p class="no-results" style="display:block;margin:24px auto">No saved patterns yet — use the CAD Editor to draw one.${offline}</p>`;
  }else{
    unpub.forEach(pat=>{
      grid.insertAdjacentHTML('beforeend',expCardHTML(pat));
      const thumb=grid.querySelector(`[data-expid="${pat.id}"]`);
      if(thumb)setTimeout(()=>renderThumb(thumb,pat),0);
      setTimeout(()=>renderLikeButtons(pat.id),0);
    });
  }
  const trash=_loadTrash();
  const tbtn=document.getElementById('trashToggleBtn');
  if(tbtn)tbtn.textContent=trash.length?'🗑 Trash ('+trash.length+')':'🗑 Trash';
}

function rebuildExpGallery(){rebuildMyPatsView();}

window.removeExpPattern=async function removeExpPattern(id){
  if(!confirm('Move this pattern to trash? It can be restored within 1 week.'))return;
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(!pat)return;
  moveToTrash(pat);
  EXP_PATTERNS=EXP_PATTERNS.filter(p=>p.id!==id);
  // Persist deletion even if Firestore sync fails — prevents reappearing
  try{const del=JSON.parse(localStorage.getItem('sashiko_deleted')||'[]');del.push(id);localStorage.setItem('sashiko_deleted',JSON.stringify(del));}catch(e){}
  _saveLocal();
  await _deleteFromFirestore(id);
  rebuildMyPatsView();
};

window.showMyPatterns=function(){
  document.getElementById('galleryView').style.display='none';
  document.getElementById('cadView').classList.remove('open');
  document.getElementById('myPatsView').classList.add('open');
  const trash=_loadTrash();
  const tbtn=document.getElementById('trashToggleBtn');
  if(tbtn)tbtn.textContent=trash.length?'🗑 Trash ('+trash.length+')':'🗑 Trash';
  document.getElementById('trashSection').style.display='none';
  // Always refresh from Firestore when opening the view
  if(_firebaseReady){_fetchFromFirestore().then(()=>rebuildMyPatsView());}
  else{rebuildMyPatsView();}
  window.scrollTo({top:0,behavior:'smooth'});
};
window.showGalleryFromMyPats=function(){
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('galleryView').style.display='block';
};

// ── Likes & Remix ────────────────────────────────────────────────────────────
function _getLikes(){try{return JSON.parse(localStorage.getItem('sashiko_likes')||'{}');}catch(e){return{};}}
function _saveLikes(l){localStorage.setItem('sashiko_likes',JSON.stringify(l));}
window.likePattern=function(id,delta){
  if(!id)return;
  const likes=_getLikes();if(!likes[id])likes[id]={up:0,down:0};
  const uid=_getUserId();const prev=likes[id][uid];
  if(prev===delta){delete likes[id][uid];if(delta===1)likes[id].up--;if(delta===-1)likes[id].down--;_saveLikes(likes);_updatePatternLikes(id);renderLikeButtons(id);return;}
  if(prev===1)likes[id].up--;if(prev===-1)likes[id].down--;
  if(delta===1)likes[id].up++;if(delta===-1)likes[id].down++;
  likes[id][uid]=delta;
  _saveLikes(likes);
  _updatePatternLikes(id);
  renderLikeButtons(id);
};
function _updatePatternLikes(id){
  const likes=_getLikes();const l=likes[id]||{up:0,down:0};
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(pat){pat.likes=l.up;pat.dislikes=l.down;_saveLocal();}
}
function renderLikeButtons(id){
  const likes=_getLikes();const l=likes[id]||{up:0,down:0};
  const uid=_getUserId();const myVote=likes[id]?.[uid];
  const score=l.up-l.down;
  const btns=document.querySelectorAll(`.like-row[data-id="${id}"]`);
  btns.forEach(el=>{
    el.innerHTML=
      `<button class="like-btn${myVote===1?' liked':''}" onclick="event.stopPropagation();likePattern('${id}',1)" title="Like">▲ ${l.up}</button>`+
      `<span class="like-score" style="color:${score>0?'#88c4a4':score<0?'#e09090':'var(--muted)'}">${score>0?'+':''}${score}</span>`+
      `<button class="like-btn${myVote===-1?' disliked':''}" onclick="event.stopPropagation();likePattern('${id}',-1)" title="Dislike">▼ ${l.down}</button>`+
      `<button class="like-btn remix" onclick="event.stopPropagation();remixPattern('${id}')" title="Remix">↗ Remix</button>`;
  });
}
window.remixPattern=function(id){
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(!pat)return;
  if(!confirm('Create a remix of "'+(pat.name||'Custom')+'"?'))return;
  cadLines=pat.lines.map(l=>({start:[l.start[0],l.start[1]],end:[l.end[0],l.end[1]]}));
  cadHistory=[];cadEditId=null;cadRemixOf=pat.id;
  cadTool='draw';cadArcState=0;cadArcCenter=null;cadArcStart=null;
  document.getElementById('cadGridType').value=pat.gridType||'isometric';
  const maxDim=Math.max(pat.bbox.maxU,pat.bbox.maxV);
  const macroVal=Math.max(2,Math.min(6,Math.ceil(maxDim/CAD_MICRO)));
  document.getElementById('cadGridSize').value=macroVal;
  const pmOpts=[3,4,5,8,12];let bestPM=5,bestD=Infinity;
  pmOpts.forEach(o=>{const d=Math.abs(o-(pat.patMacro||5));if(d<bestD){bestD=d;bestPM=o;}});
  document.getElementById('cadPatSize').value=bestPM;
  document.getElementById('cadPatName').value=(pat.name||'Custom')+' Remix';
  document.getElementById('cadTraditional').checked=false;cadTraditional=false;
  cadRoutingMode='default';document.getElementById('cadRoutingMode').value='default';
  cadBBoxRotated=pat.bboxRotated||false;
  cadFamsLocked=false;cadFamOrder=[];cadFamSel=-1;
  cadInited=false;
  document.getElementById('galleryView').style.display='none';
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.remove('open');
  document.getElementById('cadView').classList.add('open');
  cadInit();
  cadSetTool('draw');
  window.scrollTo({top:0,behavior:'smooth'});
};
function renderRemixes(pat){
  const el=document.getElementById('remixesSection');if(!el)return;
  const allIds=new Set(pat.remixes||[]);
  EXP_PATTERNS.forEach(p=>{if(p.remixOf===pat.id)allIds.add(p.id);});
  const remixes=[...allIds].map(id=>EXP_PATTERNS.find(p=>p.id===id)).filter(Boolean);
  if(!remixes.length){el.style.display='none';return;}
  remixes.sort((a,b)=>(b.likes||0)-(b.dislikes||0)-((a.likes||0)-(a.dislikes||0)));
  el.innerHTML='<div class="remixes-title">Remixes</div><div class="remixes-grid">'+
    remixes.map((p,i)=>{
      const sc=(p.likes||0)-(p.dislikes||0);
      return `<button class="pcard remix-card" onclick="openExpPattern('${p.id}')">
        <canvas class="pcard-thumb" width="120" height="120" data-expid="${p.id}"></canvas>
        <div class="pcard-name">${(p.name||'Custom').replace(/[<>"'&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]))}</div>
        <span class="pcard-badge">${sc>0?'+':''}${sc} · ${p.gridType==='isometric'?'Iso':'Sq'}</span>
      </button>`;
    }).join('')+
  '</div>';
  el.style.display='block';
  setTimeout(()=>remixes.forEach(p=>{
    const thumb=el.querySelector(`[data-expid="${p.id}"]`);
    if(thumb)renderThumb(thumb,p);
  }),0);
}

// ── CAD view switching ────────────────────────────────────────────────────────
window.exportAllPatterns=function(){
  const data={exported:new Date().toISOString(), patterns:EXP_PATTERNS.map(p=>{
    const{thumbnail,...rest}=p;return rest; // strip thumbnail to keep file small
  })};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='sashiko-patterns-backup.json';a.click();
  URL.revokeObjectURL(a.href);
};
window.showCAD=function(){
  document.getElementById('galleryView').style.display='none';
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.remove('open');
  document.getElementById('cadView').classList.add('open');
  cadEditId=null;cadRemixOf=null;cadIsPublished=false;cadLines=[];cadFamilies=[];cadHistory=[];cadManualBBox=null;
  cadBBoxRotated=false;cadFamOrder=[];cadFamSel=-1;cadFamsLocked=false;cadTraditional=false;cadRoutingMode='default';
  document.getElementById('cadRoutingMode').value='default';
  cadInited=false;
  cadInit();
  window.scrollTo({top:0,behavior:'smooth'});
};
window.showGalleryFromCAD=function(){
  cadEditId=null;
  document.getElementById('cadView').classList.remove('open');
  document.getElementById('myPatsView').classList.add('open');
  rebuildMyPatsView();
};
