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

// Admin gate (client UI only) — by SHA-256 HASH of the Google email, so the e-mail itself
// is never exposed in the public client. The real power boundary is the Firestore rules
// (isAdmin() there checks the plaintext e-mail, which lives only in the private, server-side
// rules — never in the repo). To set yours: deploy, click "Admin login", then run
// sashikoAdminHash() in the console and paste the printed hash below.
// While left as the placeholder it's "not configured" → any Google sign-in shows the admin
// UI (rules still enforce real power), so you can't lock yourself out before setting it.
const ADMIN_EMAIL_HASHES=['10f67e4ab1ba318f34f1f133726ad885cb3e5edc9ce86731468156774ad39620'];
let _adminVerified=false;
async function _sha256hex(s){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(s).trim().toLowerCase()));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function _adminConfigured(){return ADMIN_EMAIL_HASHES.some(h=>h&&!/^PASTE_/.test(h));}
async function _verifyAdmin(user){
  if(!user||user.isAnonymous){_adminVerified=false;return false;}
  if(!_adminConfigured()){_adminVerified=true;return true;}   // unconfigured → don't lock out
  try{_adminVerified=ADMIN_EMAIL_HASHES.includes(await _sha256hex(user.email||''));}
  catch(e){_adminVerified=false;}
  return _adminVerified;
}

let EXP_PATTERNS=[];
let _cadSource='sandbox';
let _db=null;   // Firestore instance, set after SDK loads
let _firebaseReady=false;
let _auth=null, _authUid=null, _authReady=null;   // anonymous-auth session (for Firestore rules)
let _adminUser=null;                              // set when signed in with a real (Google) account = admin

// ── EXP animation state ──────────────────────────────────────────────────────
let EXP_path=[];       // [{start:[u,v], end:[u,v], jump:bool}]
let EXP_g2s=null;      // grid→screen fn (set by setupExpCanvas)
let EXP_canvasH=SIZE;  // canvas height in CSS px (SIZE for square, SIZE/√3 for iso)
let EXP_uRange=[0,0], EXP_vRange=[0,0];  // visible grid range (for stitch-view grid overlay)
// Layout scale (screen px per grid unit). EXP_sz tracks the current tile count; EXP_szRef
// is frozen at the pattern's natural patMacro on load. Stitch length is expressed in grid
// units relative to EXP_szRef, so changing the tile count rescales the whole scene uniformly
// (constant number of stitches per line — the pattern stays static).
let EXP_sz=1, EXP_szRef=1;
// ── Gallery realistic stitch view (always on for custom patterns) ────────────
let galStitch=true, galStitchLen=8, galStitchRatio='standard', galStitchGrid=false;
// Draft mode: drafting help lines (full pattern geometry + full circles for arcs), shown
// together with the grid and the toned-down threads.
let galDraft=false;
let _galStitchCache=null, _galDraftCache=null;
// Optional thread-colour preview: family index → hex (absent = off-white yarn).
// Default palette is the Olympus sashiko set (the "Sashiko yarn" option).
let galThreadColors={}, galPalette='sashiko', galActiveFam=0;
// Selected fabric (gallery viewer only) — persists across pattern loads (an aesthetic
// preference, not tied to a pattern's family indices the way thread colours are).
let galFabric='indigo';
// Soft pastel thread palette — named, and a touch more saturated (less pale) than before.
const GAL_PASTEL=[
  {name:'Cream',      hex:'#e8dcb5'}, {name:'Rose',     hex:'#eaa9b8'},
  {name:'Peach',      hex:'#f0c293'}, {name:'Butter',   hex:'#ecd680'},
  {name:'Mint',       hex:'#9fd5b4'}, {name:'Sky',      hex:'#9cc4e2'},
  {name:'Periwinkle', hex:'#b0b2e0'}, {name:'Lavender',  hex:'#cfa9dd'},
  {name:'Seafoam',    hex:'#a7d2c6'}, {name:'Sand',     hex:'#c4bca7'},
];
// Olympus Sashiko Thread — full 40-colour official lineup (Olympus #42 single colours).
// Names + hex codes are the official catalogue values (olympus-thread.com #42 sashiko).
// `brand:'olympus'` is internal-only metadata so the set can be filtered later. `code` = skein number.
const OLYMPUS_SASHIKO=[
  {code:1, name:'White',           hex:'#dcdde1'}, {code:2, name:'Off-White',        hex:'#e5dac3'},
  {code:3, name:'Brown',           hex:'#71391c'}, {code:4, name:'Carrot Orange',    hex:'#d8761b'},
  {code:5, name:'Gold',            hex:'#c09d33'}, {code:6, name:'Yellowish Green',  hex:'#88ac4f'},
  {code:7, name:'Green',           hex:'#527d55'}, {code:8, name:'Aqua',             hex:'#8ac0d1'},
  {code:9, name:'Sky Blue',        hex:'#467189'}, {code:10,name:'Cobalt Blue',      hex:'#204670'},
  {code:11,name:'Navy',            hex:'#111527'}, {code:12,name:'Rose Red',         hex:'#9d1329'},
  {code:13,name:'Rose Pink',       hex:'#db6f7f'}, {code:14,name:'Orchid Pink',      hex:'#eca1ab'},
  {code:15,name:'Red',             hex:'#bc0307'}, {code:16,name:'Yellow',           hex:'#f3b004'},
  {code:17,name:'Teal',            hex:'#0695ad'}, {code:18,name:'Royal Blue',       hex:'#071f57'},
  {code:19,name:'Purple',          hex:'#62457f'}, {code:20,name:'Black',            hex:'#22211f'},
  {code:21,name:'Hot Pink',        hex:'#da1162'}, {code:22,name:'Orange',           hex:'#f85305'},
  {code:23,name:'Ultramarine Blue',hex:'#20338a'}, {code:24,name:'Orchid',           hex:'#cb70a5'},
  {code:25,name:'Salmon',          hex:'#f3967b'}, {code:26,name:'Viridian Green',   hex:'#057e2c'},
  {code:27,name:'Blue',            hex:'#0464b0'}, {code:28,name:'Grey',             hex:'#abaaa9'},
  {code:29,name:'Lemon Yellow',    hex:'#f5da0e'}, {code:30,name:'Crimson Red',      hex:'#d30152'},
  {code:31,name:'Bright Orange',   hex:'#e54802'}, {code:32,name:'Dusty Rose',       hex:'#dd5570'},
  {code:33,name:'Mellow Yellow',   hex:'#f6ce6d'}, {code:34,name:'Emerald Teal',     hex:'#01a38b'},
  {code:35,name:'Bright Purple',   hex:'#992a84'}, {code:36,name:'Petrol Blue',      hex:'#0a7091'},
  {code:37,name:'Forest Green',    hex:'#096656'}, {code:38,name:'Stone Beige',      hex:'#b8af9f'},
  {code:39,name:'Dark Brown',      hex:'#533b29'}, {code:40,name:'Charcoal',         hex:'#514f5e'},
].map(o=>({...o, brand:'olympus'}));
const GAL_SASHIKO=OLYMPUS_SASHIKO.map(o=>o.hex);
// Membership set for "is this an Olympus yarn colour?" filtering later.
const OLYMPUS_HEXES=new Set(GAL_SASHIKO);
// Thread palettes shown as labelled SECTIONS in one panel (Olympus, Pastel, …future).
// Each section = {label, items:[{hex,name}]}. Add more brands here later.
function _galPaletteSections(){
  return [
    {label:'Olympus', items:OLYMPUS_SASHIKO.map(o=>({hex:o.hex,name:'#'+o.code+' '+o.name}))},
    {label:'Pastel',  items:GAL_PASTEL.map(o=>({hex:o.hex,name:o.name}))},
  ];
}
// Flat list of every swatch (for name lookup of the currently-assigned colour).
function _galAllSwatches(){return _galPaletteSections().reduce((a,s)=>a.concat(s.items),[]);}
// The default yarn is always off-white — the thread keeps its true colour regardless of
// the cloth, even if that means low contrast on a light fabric (the user picks a darker
// thread themselves if they want more contrast; we never silently recolour a thread).
function _galDefaultYarn(){return CAD_YARN;}
// Legacy name kept for any external caller — returns the flat swatch list.
function _galPaletteArr(){
  return galPalette==='sashiko'
    ? OLYMPUS_SASHIKO.map(o=>({hex:o.hex,name:'#'+o.code+' '+o.name}))
    : GAL_PASTEL.map(o=>({hex:o.hex,name:o.name}));
}

// ── Firebase bootstrap ───────────────────────────────────────────────────────
function _initFirebase(){
  if(_firebaseReady||FIREBASE_CONFIG.apiKey.startsWith('PASTE'))return;
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    _db=firebase.firestore();
    _firebaseReady=true;
    // Anonymous sign-in: gives every visitor a stable Firebase uid so the Firestore
    // rules can require auth and tie each pattern to its creator (creatorId == uid).
    // Reads stay public; only writes need this. Requires "Anonymous" enabled in
    // Firebase Console → Authentication → Sign-in method.
    if(firebase.auth){
      _auth=firebase.auth();
      _authReady=new Promise(res=>{
        let done=false;
        _auth.onAuthStateChanged(async u=>{
          _authUid=u?u.uid:null;
          // A non-anonymous session (Google) = admin candidate; verify by e-mail hash
          // (and the Firestore rules enforce the real power boundary).
          _adminUser=(u&&!u.isAnonymous)?u:null;
          await _verifyAdmin(u);
          if(u&&!done){done=true;res(u.uid);}   // resolve once we actually hold a session
          _updateAdminUI();
          // Keep everyone signed in: if there's no session, fall back to anonymous so
          // the open sandbox stays writable. (Doesn't clobber a Google session.)
          if(!u)_auth.signInAnonymously().catch(e=>console.warn('Anonymous auth failed — enable it in Firebase Console → Authentication → Anonymous:',e));
        });
      });
    }
  }catch(e){console.warn('Firebase init failed:',e);}
}
// Run in the browser console on the live site to get the uid to add to the
// Firestore-rules admin allowlist (isAdmin()).
window.sashikoMyUid=function(){const id=_authUid||null;console.log('Your Firebase admin uid:',id||'(signing in… try again in a second)');return id;};
// Sign in with Google (Admin login) first, then run this to get the hash to paste into
// ADMIN_EMAIL_HASHES. Your e-mail never appears in the code — only its hash.
window.sashikoAdminHash=async function(){
  if(!_adminUser||!_adminUser.email){console.log('Sign in with Google first (Admin login), then run sashikoAdminHash().');return;}
  const h=await _sha256hex(_adminUser.email);
  console.log('Add this to ADMIN_EMAIL_HASHES in src/experimental.js:\n  "'+h+'"');
  return h;
};
// Wait (briefly) for the anonymous session so writes carry a valid auth.uid.
async function _awaitAuth(){ if(_authReady){try{await Promise.race([_authReady,new Promise(r=>setTimeout(r,4000))]);}catch(e){}} }

// ── Admin (Google sign-in) ───────────────────────────────────────────────────
// Admin = signed in with a real Google account whose email is allow-listed in the
// Firestore rules (isAdmin()). The client only knows "signed in with Google"; the
// rules are the real boundary (publish + any gallery edit/delete).
function _isAdmin(){return !!_adminUser && _adminVerified;}
function _updateAdminUI(){
  const on=_isAdmin();
  if(document.body)document.body.classList.toggle('is-admin',on);
  document.querySelectorAll('.admin-login-btn').forEach(b=>{
    b.textContent=on?('✓ Admin — sign out'):'Admin login';
    b.classList.toggle('on',on);
  });
  // CAD "Publish" button visibility tracks admin too (it sets its own inline display).
  const pb=document.getElementById('cadPublishBtn');
  if(pb)pb.style.display=(on&&!cadIsPublished)?'inline-block':'none';
}
// Ensure an admin session, prompting Google sign-in if needed. Returns true if admin.
async function _ensureAdmin(){
  if(_isAdmin())return true;
  if(!_firebaseReady||!_auth){alert('Admin needs an internet connection.');return false;}
  const provider=new firebase.auth.GoogleAuthProvider();
  try{
    const res=await _auth.signInWithPopup(provider);
    _adminUser=(res&&res.user&&!res.user.isAnonymous)?res.user:null;
    await _verifyAdmin(_adminUser);
    if(_adminUser&&_adminConfigured()&&!_adminVerified){
      // Signed in, but not an authorized admin account — drop back to anonymous.
      alert('This Google account is not an authorized admin.');
      _adminUser=null;_adminVerified=false;_updateAdminUI();
      try{await _auth.signInAnonymously();}catch(e){}
      return false;
    }
    _updateAdminUI();
    return _isAdmin();
  }catch(e){
    const code=(e&&e.code)||'';
    console.warn('Admin sign-in failed:',code,e);
    // User just closed the popup — not worth an alert.
    if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request')return false;
    // Popups blocked → full-page redirect instead (onAuthStateChanged picks it up on return).
    if(code==='auth/popup-blocked'){try{await _auth.signInWithRedirect(provider);}catch(e2){}return false;}
    let msg='Admin sign-in failed: '+(code||e.message||e);
    if(code==='auth/operation-not-allowed')
      msg='Google sign-in is not enabled.\nFirebase Console → Authentication → Sign-in method → enable Google.';
    else if(code==='auth/unauthorized-domain')
      msg='This site is not an authorized domain.\nFirebase Console → Authentication → Settings → Authorized domains → add '+location.hostname+'.';
    alert(msg);
    return false;
  }
}
window.adminLogin=function(){ if(_isAdmin())window.adminLogout(); else _ensureAdmin(); };
window.adminLogout=function(){
  if(!_auth)return;
  _auth.signOut().then(()=>{ _adminUser=null;_adminVerified=false; _updateAdminUI(); }).catch(()=>{});
  // onAuthStateChanged then signs back in anonymously so the sandbox stays writable.
};
// One-time admin migration: rewrite every stored pattern name to the "Japanese / English"
// format and push to Firestore (so the slash format is persisted, not just displayed).
// Run sashikoMigrateNames() in the console while signed in as admin.
window.sashikoMigrateNames=async function(){
  if(!await _ensureAdmin()){console.warn('Admin sign-in required.');return;}
  let n=0;
  for(const pat of EXP_PATTERNS){
    const nn=_displayName(pat.name||'');
    if(nn&&nn!==pat.name){pat.name=nn;await _pushToFirestore(pat);n++;}
  }
  _saveLocal();buildGallery();rebuildMyPatsView();
  console.log('Renamed '+n+' pattern(s).');
  alert('Renamed '+n+' pattern(s) to the "Japanese / English" format.');
};

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
  await _awaitAuth();
  // Monotonic save marker for conflict resolution. createdAt is preserved across edits,
  // so it can't tell an edited remote doc apart from a stale local/backup copy — updatedAt
  // changes on every save, so the newest version always wins (see _fetchFromFirestore).
  pat.updatedAt=Date.now();
  const doc={...pat};delete doc.thumbnail;
  // creatorId is attribution only (the rules gate by published-state + admin, not by
  // creator). Keep any existing value; stamp the current uid if missing.
  if(!doc.creatorId)doc.creatorId=_authUid||_getUserId();
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

// Soft-delete = a shared tombstone. A HARD delete (.delete()) only removes the doc on the
// cloud, but any *other* device that still holds a stale local copy will see it "missing from
// remote" on its next fetch and helpfully re-upload it (see _fetchFromFirestore's local→remote
// push) — resurrecting it for everyone. A tombstone (deleted:true) stays in Firestore so every
// device learns the pattern is gone and no device ever re-creates it.
async function _deleteFromFirestore(id){
  if(!_db)return;
  await _awaitAuth();
  try{await _db.collection('patterns').doc(id).set({id,deleted:true,deletedAt:Date.now()},{merge:true});}
  catch(e){console.warn('Firestore tombstone failed:',e);}
}

// Seed patterns from embedded backup data into localStorage (once per origin),
// so offline / file:// testing also has the same seed patterns as the live site.
function _seedLocalFromBackup(){
  if(localStorage.getItem('sashiko_backup_seeded'))return;
  const data=typeof SEED_PATTERNS!=='undefined'?SEED_PATTERNS:null;
  if(!data||!Array.isArray(data.patterns))return;
  const existingIds=new Set(EXP_PATTERNS.map(p=>p.id));
  let deletedIds=[];try{deletedIds=JSON.parse(localStorage.getItem('sashiko_deleted')||'[]');}catch(e){}
  const deletedSet=new Set(deletedIds);
  let added=false;
  for(const p of data.patterns){
    if(!p.id||existingIds.has(p.id))continue;
    if(p.deleted||deletedSet.has(p.id))continue;   // don't re-seed a tombstoned / deleted pattern
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

    // Patterns the user deleted (local list) + shared tombstones from the cloud.
    let deletedIds=[];
    try{deletedIds=JSON.parse(localStorage.getItem('sashiko_deleted')||'[]');}catch(e){}
    // Fold remote tombstones into the local deleted set so deletions propagate across devices,
    // and persist so offline / file:// keeps filtering them too.
    let delChanged=false;
    for(const p of remote){if(p.deleted&&deletedIds.indexOf(p.id)<0){deletedIds.push(p.id);delChanged=true;}}
    if(delChanged){try{localStorage.setItem('sashiko_deleted',JSON.stringify(deletedIds));}catch(e){}}
    const deletedSet=new Set(deletedIds);

    const localById=Object.fromEntries(EXP_PATTERNS.map(p=>[p.id,p]));
    const merged=[];
    const seenIds=new Set();

    // Merge: newer timestamp wins for duplicate IDs
    for(const p of remote){
      // Mark every remote id as seen FIRST — even deleted ones — so the local→remote push
      // below can never re-upload a pattern that exists in the cloud (incl. tombstones).
      seenIds.add(p.id);
      if(p.deleted||deletedSet.has(p.id))continue; // tombstoned / user-deleted → don't show
      const lpat=localById[p.id];
      // Compare by updatedAt (changes on every save), falling back to createdAt for old
      // docs. Keep local ONLY if it is STRICTLY newer (a genuine offline edit) — on a tie
      // the remote (shared source of truth) wins. This is what stops a stale embedded-backup
      // seed (same createdAt, no updatedAt) from overriding the live edited pattern.
      const lv=lpat?(lpat.updatedAt||lpat.createdAt||0):-1;
      const rv=(p.updatedAt||p.createdAt||0);
      if(lpat && lv>rv){
        // Local is a newer unsynced edit — keep it and push it up.
        merged.push({...lpat});
        await _pushToFirestore(lpat);
      }else{
        // Remote is newer or equal (or local doesn't have it) — use remote.
        merged.push({...p,thumbnail:null});
        _saveLocal();
      }
    }

    // Local patterns not in remote: push to Firestore (they're genuinely new).
    // NEVER re-push a deleted one — that was the resurrection bug.
    for(const p of EXP_PATTERNS){
      if(seenIds.has(p.id)||deletedSet.has(p.id))continue;
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
  // Same near-integer period snap as genTiledSegs, so the layout's cell size matches
  // the tiled geometry exactly (otherwise float noise misaligns the viewport edge).
  const snapInt=v=>{const r=Math.round(v);return Math.abs(v-r)<0.005?r:v;};
  const dU=Math.max(snapInt(bbox.maxU-bbox.minU),1);
  const dV=Math.max(snapInt(bbox.maxV-bbox.minV),1);
  let sz,ox,oy;
  if(iso){
    sz=SIZE/(2*ptc*_COS30);
    // Place bbox centre at canvas centre: g2s([dU/2, dV/2]) = (SIZE/2, SIZE/2)
    ox=SIZE/2-(dU/2-dV/2)*sz*_COS30;
    oy=SIZE/2-(dU/2+dV/2)*sz*_SIN30;
  }else{
    // Show a whole number of cells so the viewport edges land exactly on cell borders
    // (no pattern cut mid-cell at the window edge). nU cells fill the width at a uniform
    // scale; the cell block is anchored to the top-left cell border (u=v=0). For a square
    // cell this exactly fills and centres the SIZE×SIZE canvas.
    const nU=Math.max(1,Math.round(ptc/dU));
    sz=SIZE/(nU*dU);
    ox=0; oy=0;
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
  return{sz,ox,oy,canvasH,g2s,s2g,ptc,iso,dU,dV,corners,planes:convexPlanes(corners),uRange:[minU,maxU],vRange:[minV,maxV]};
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

// Number of stitch families (= "passes") a custom pattern routes into — the same families
// genTiledSegs/buildExpPath colour by. Used to set the gallery pass-filter automatically.
// Uses the pattern's saved families (flat `famIdx`/line or grouped `[lines]` form) when present,
// otherwise derives them by symmetry. So filtering by passes works without any manual tagging.
window.expFamilyCount=function expFamilyCount(pat){
  let fams=pat&&pat.families;
  if(!fams||!fams.length){try{fams=detectSymmetryFamilies(pat);}catch(e){fams=null;}}
  if(!fams||!fams.length)return 0;
  return Array.isArray(fams[0])?fams.length:new Set(fams.filter(f=>f>=0)).size;
};

// Flatten an arc to polyline segments in grid space.
function _flattenArc(l, nSegs, arcId){
  const a1=l.a1, a2=l.a2;
  let sweep=a2-a1;
  if(sweep>=2*Math.PI-0.001)sweep=2*Math.PI;
  else if(sweep<=-2*Math.PI+0.001)sweep=-2*Math.PI;
  const totalSweep=Math.abs(sweep);
  const segs=Math.max(2,Math.round(totalSweep/(2*Math.PI)*(nSegs||60)));
  const result=[]; let prev=[...l.start];
  // Use the exact center→start radius, not the stored l.r (which may be rounded, e.g.
  // 1.414 vs √2). A rounded radius drifts the computed points off the clean grid by
  // float noise — enough to break arc→arc endpoint merging when tiled (dead-ends, no
  // wave chaining). Recomputing keeps the curve through its real endpoints; arcs whose
  // stored radius is already exact (e.g. r=5) are unaffected.
  const r=Math.hypot(l.start[0]-l.center[0],l.start[1]-l.center[1])||l.r;
  for(let i=1;i<=segs;i++){
    const a=a1+sweep*(i/segs);
    const next=[l.center[0]+r*Math.cos(a),l.center[1]+r*Math.sin(a)];
    result.push({start:prev,end:next,aid:arcId});
    prev=next;
  }
  return result;
}

// ── Routing engine versioning ──────────────────────────────────────────────
// Published gallery patterns are LOCKED to the routing engine they were published
// with, so future changes to the routing algorithm can never alter an already-published
// pattern. Sandbox / new / remix / edit patterns always use the CURRENT engine, so
// authoring gets the newest routing.
//
// Today there is exactly ONE engine (v1 === the live genTiledSegs / buildExpPath below),
// so this whole layer is a transparent pass-through and changes nothing visible.
//
// >>> WHEN YOU CHANGE ROUTING, FORK FIRST (see CLAUDE.md "Routing engine versioning"):
//   1. Copy the CURRENT genTiledSegs + buildExpPath + their private helpers
//      (buildStrokesForFamily, matchVertex, orderStrokesFamily, buildContourStrokes,
//       _buildMotifPath, …) to frozen *_v1 versions — DO NOT edit those copies ever again.
//   2. Register them:  ROUTING_ENGINES[1] = {genTiledSegs:genTiledSegs_v1, buildExpPath:buildExpPath_v1}
//   3. Write your new algorithm as the live genTiledSegs / buildExpPath.
//   4. Register the new engine:  ROUTING_ENGINES[2] = {genTiledSegs, buildExpPath}
//      and bump ROUTING_ENGINE_CURRENT = 2.
// Every already-published pattern is stamped routingEngine:1 (or has no field → treated
// as 1), so it keeps v1. Everything published from then on gets v2. <<<
const ROUTING_ENGINE_CURRENT = 1;
const ROUTING_ENGINES = {
  1: { genTiledSegs:(p)=>genTiledSegs(p), buildExpPath:(segs,fo,rm,op)=>buildExpPath(segs,fo,rm,op) },
};
// The engine a pattern must route with. Published → its pinned version (a missing field
// means "published before versioning" = engine 1). Unpublished (sandbox/new/remix/edit)
// → the current engine.
function routingEngineFor(pat){
  const v = (pat && pat.published) ? (pat.routingEngine || 1) : ROUTING_ENGINE_CURRENT;
  return ROUTING_ENGINES[v] || ROUTING_ENGINES[ROUTING_ENGINE_CURRENT];
}
// Route an exp pattern's tiled segments / stitch path through its pinned engine.
// Use these (not the bare genTiledSegs/buildExpPath) at every GALLERY-facing call site.
function tiledSegsFor(pat){ return routingEngineFor(pat).genTiledSegs(pat); }
function expPathFor(segs, pat){ return routingEngineFor(pat).buildExpPath(segs, pat.famOrder, pat.routingMode, {iso:!!pat&&pat.gridType==='isometric'}); }

// ── Tiled segments (with symmetry-family assignment) ───────────────────────
function genTiledSegs(pat){
  const lay=computeExpLayout(pat);
  const bbox=pat.bbox||{minU:0,maxU:10,minV:0,maxV:10};
  // Snap a near-integer tiling period to the integer (float noise only, e.g. 4.0003→4).
  // Tiling by the noisy bbox offsets each tile a hair from the true period, so arcs
  // never meet across tiles (dead-ends, no wave chaining). Genuine non-integer periods
  // (Hearts, Waves, …) are >0.005 off an integer and left untouched.
  const snapInt=v=>{const r=Math.round(v);return Math.abs(v-r)<0.005?r:v;};
  const dU=Math.max(snapInt(bbox.maxU-bbox.minU),1), dV=Math.max(snapInt(bbox.maxV-bbox.minV),1);
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
  const rawLines=pat.lines||[];
  // Build flat segments: expand arcs to polyline segments, assign unique arc IDs
  const flatSegs=[];
  const flatFamOf=[];
  let arcIdCounter=0;
  rawLines.forEach((l,li)=>{
    if(l.arc){
      _flattenArc(l, 60, arcIdCounter).forEach(s=>{flatSegs.push(s);flatFamOf.push(famOfLine[li]);});
      arcIdCounter++;
    }else{
      flatSegs.push({start:[...l.start],end:[...l.end],aid:-1});
      flatFamOf.push(famOfLine[li]);
    }
  });
  const spacing=pat.spacing||0;
  const segs=[];
  let tileAid=arcIdCounter;  // running counter for tiled copies
  if(pat.bboxRotated){
    let mnP=Infinity,mxP=-Infinity,mnQ=Infinity,mxQ=-Infinity;
    flatSegs.forEach(l=>{
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
        const base=tileAid; tileAid+=arcIdCounter;
        flatSegs.forEach((l,fi)=>{
          const aid=l.aid>=0?base+l.aid:-1;
          segs.push({start:[l.start[0]+ou,l.start[1]+ov],end:[l.end[0]+ou,l.end[1]+ov],fam:flatFamOf[fi],aid});
        });
      }
    }
  }else{
    const su=dU+spacing, sv=dV+spacing;
    const ou0=Math.floor((minU-dU)/su)*su, ou1=Math.ceil((maxU-0)/su)*su;
    const ov0=Math.floor((minV-dV)/sv)*sv, ov1=Math.ceil((maxV-0)/sv)*sv;
    for(let ou=ou0;ou<=ou1;ou+=su){
      for(let ov=ov0;ov<=ov1;ov+=sv){
        const base=tileAid; tileAid+=arcIdCounter;
        flatSegs.forEach((l,fi)=>{
          const aid=l.aid>=0?base+l.aid:-1;
          segs.push({start:[l.start[0]+ou,l.start[1]+ov],end:[l.end[0]+ou,l.end[1]+ov],fam:flatFamOf[fi],aid});
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
  EXP_uRange=lay.uRange; EXP_vRange=lay.vRange;
  EXP_sz=lay.sz;
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
  EXP_path=_expPathForView(curPat);   // honour the gallery routing test switcher if active
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
window.editExpPattern=async function(idOrPat){
  const pat=typeof idOrPat==='string'?EXP_PATTERNS.find(p=>p.id===idOrPat):idOrPat;
  if(!pat)return;
  // Published (gallery) patterns are admin-only to edit; sandbox patterns stay open.
  if(pat.published && !await _ensureAdmin())return;
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
   cadLines=pat.lines.map(l=>{
     if(l.arc&&l.center!==undefined){
       const nc=[l.center[0]+gc-cu,l.center[1]+gc-cv];
       return{arc:true,center:nc,r:l.r,a1:l.a1,a2:l.a2,start:[l.start[0]+gc-cu,l.start[1]+gc-cv],end:[l.end[0]+gc-cu,l.end[1]+gc-cv]};
     }
     return{start:[l.start[0]+gc-cu,l.start[1]+gc-cv],end:[l.end[0]+gc-cu,l.end[1]+gc-cv],...(l.arc?{arc:true}:{})};
   });
  }
  // Restore families and order from saved pattern
  cadFamilies=(pat.families||[]).slice();
  while(cadFamilies.length<cadLines.length)cadFamilies.push(-1);
  if(cadFamilies.length>cadLines.length)cadFamilies.length=cadLines.length;
  cadFamOrder=(pat.famOrder||[]).slice();
  // If no families were saved, detect from geometry so routing matches gallery
  if(!cadFamilies.some(f=>f>=0)){
    const connFams=detectSymmetryFamilies({lines:cadLines, bbox:cadBBox()||pat.bbox||{minU:0,maxU:10,minV:0,maxV:10}});
    cadFamilies.fill(-1);
    connFams.forEach((group,fi)=>{group.forEach(li=>{cadFamilies[li]=fi;});});
    cadFamOrder=[...Array(connFams.length).keys()];
  }
  cadFamsLocked=cadFamilies.some(f=>f>=0);
  cadFamSel=-1;
  cadBBoxRotated=pat.bboxRotated||false;
  cadTraditional=!!pat.traditional;
  document.getElementById('cadTraditional').checked=cadTraditional;
  cadRoutingMode=pat.routingMode||'default';
  cadThumbCells=pat.thumbCells||0;
  // Legacy smooth/fewer-jumps are Logik-1 variants — collapse to the Straight option.
  if(cadRoutingMode==='smooth'||cadRoutingMode==='fewer-jumps')cadRoutingMode='default';
  document.getElementById('cadRoutingMode').value=cadRoutingMode;
  cadSpacing=parseInt(pat.spacing)||0;
  document.getElementById('cadSpacing').value=cadSpacing;
  document.getElementById('cadGridSize').value=macroVal;
  document.getElementById('cadPatSize').value=pat.patMacro||3;
  document.getElementById('cadPatName').value=pat.name||'';
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

function buildExpPath(lines, famOrderOverride, routingMode, v2opts){
  if(!lines||!lines.length)return[];

  const mode=routingMode||'default';
  // v2 modes route through their own additive pipeline; the four original modes
  // below stay byte-identical (verified via tools/routing/route.js --check).
  if(_isV2Mode(mode))return buildExpPathV2(lines,famOrderOverride,mode,v2opts||{});
  const maxTurnMap={smooth:60*Math.PI/180, default:90*Math.PI/180, 'fewer-jumps':120*Math.PI/180, continuous:Math.PI, contour:120*Math.PI/180, sequential:90*Math.PI/180};
  const maxTurn=maxTurnMap[mode]||90*Math.PI/180;

  const famGroups=new Map();
  lines.forEach(l=>{const fi=l.fam||0;if(!famGroups.has(fi))famGroups.set(fi,[]);famGroups.get(fi).push(l);});

  // Logik 4 — motif "one by one": finish each detected motif before the next.
  if(mode==='sequential')return _buildMotifPath(famGroups,maxTurn);

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
    // Logik 3 — Contour / wave stitching, per family then per colour.
    // 1. buildContourStrokes chains arcs into long forward-marching WAVES (scallops).
    // 2. orderStrokesFamily sweeps wave-rows in orientation-aware bands with snaking.
    // 3. Families are visited one after the other — all lines of one colour before the next.
    const famContourStrokes=new Map(), famEnds=new Map();
    for(const[fi,segs]of famGroups){
      const raw=buildContourStrokes(segs,maxTurn);
      if(!raw.length)continue;
      const ordered=orderStrokesFamily(raw);
      if(!ordered.length)continue;
      famContourStrokes.set(fi,ordered);
      const p0=ordered[0].pts[0];
      const p1=ordered[ordered.length-1].pts[ordered[ordered.length-1].pts.length-1];
      famEnds.set(fi,{p0,p1});
    }
    if(!famContourStrokes.size)return[];

    const allFamIds=[...famContourStrokes.keys()];
    let bestOrder;
    if(famOrderOverride && famOrderOverride.length){
      bestOrder=famOrderOverride.filter(fi=>famContourStrokes.has(fi));
      for(const fi of allFamIds)if(!bestOrder.includes(fi))bestOrder.push(fi);
    }else{
      bestOrder=allFamIds;
    }
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
            if(dF<bd){bd=dF;bf=fi;useFront=true;}
            if(dB<bd){bd=dB;bf=fi;useFront=false;}
          }
          bestOrder.push(bf);rem.delete(bf);
          if(useFront)cur2=famEnds.get(bf).p1;else cur2=famEnds.get(bf).p0;
        }
      }
    }

    const path=[]; let cur=null;
    for(const fi of bestOrder){
      const ordered=famContourStrokes.get(fi);
      for(const s of ordered){
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

  const path=[], stitched=[];
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

// ── Motif routing (Logik 4 — "one by one") ──────────────────────────────────
// For repeat-motif patterns (stone wheels, linked rings, crests…) the intuitive way to
// stitch is to FINISH one motif completely, then move to the next — not sweep one colour
// across the whole cloth. We detect motifs automatically (no manual tagging) and route
// each one fully before the nearest next one.
//
// Motif detection = single-linkage clustering of strokes by endpoint proximity, cut at the
// LARGEST natural gap in the merge distances: strokes inside a motif sit closer together
// than neighbouring motifs do, so that gap is exactly the motif boundary — no fixed
// threshold to tune. Validated on Ishi Guruma: 20-stroke wheels detected cleanly, each
// stitched contiguously. Within a motif, and between motifs, strokes are ordered nearest-
// first so the needle never wanders.
function _buildMotifPath(famGroups, maxTurn){
  const strokes=[];
  for(const[fi,segs]of famGroups)
    buildStrokesForFamily(segs,maxTurn).forEach(pts=>{if(pts&&pts.length>=2)strokes.push({pts,fi});});
  const n=strokes.length; if(!n)return[];
  const ep=strokes.map(s=>[s.pts[0],s.pts[s.pts.length-1]]);   // [start,end] of each stroke
  // Typical stroke length sets the spatial scale (grid cell + the "significant gap" floor).
  const slen=strokes.map(s=>{let L=0;for(let k=1;k<s.pts.length;k++)L+=Math.hypot(s.pts[k][0]-s.pts[k-1][0],s.pts[k][1]-s.pts[k-1][1]);return L;});
  const med=[...slen].sort((a,b)=>a-b)[n>>1]||1;
  const minEndDist=(a,b)=>{let d=Infinity;for(const u of ep[a])for(const v of ep[b]){const dd=Math.hypot(u[0]-v[0],u[1]-v[1]);if(dd<d)d=dd;}return d;};

  // Candidate proximity edges via a spatial hash (avoids O(n²) over the whole tiling).
  const cell=Math.max(med*1.5,1e-3), grid=new Map();
  ep.forEach((pp,i)=>pp.forEach(p=>{const k=Math.floor(p[0]/cell)+','+Math.floor(p[1]/cell);let a=grid.get(k);if(!a){a=[];grid.set(k,a);}a.push(i);}));
  const edges=[], seen=new Set();
  ep.forEach((pp,i)=>pp.forEach(p=>{const cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const arr=grid.get((cx+dx)+','+(cy+dy));if(!arr)continue;
      for(const j of arr){if(j===i)continue;const a=i<j?i:j,b=i<j?j:i,pk=a*n+b;if(seen.has(pk))continue;seen.add(pk);edges.push([minEndDist(a,b),a,b]);}}}));
  edges.sort((e,f)=>e[0]-f[0]);

  // MST merge-distance sequence → cut at the largest gap above a small floor.
  const tmp=[...Array(n).keys()], f2=x=>{while(tmp[x]!==x){tmp[x]=tmp[tmp[x]];x=tmp[x];}return x;};
  const mw=[];
  for(const[d,a,b]of edges){const ra=f2(a),rb=f2(b);if(ra!==rb){tmp[rb]=ra;mw.push(d);}}
  const FLOOR=Math.max(med*0.15,0.3);
  let bestGap=0, cut=FLOOR;
  for(let k=0;k<mw.length-1;k++){if(mw[k+1]<FLOOR)continue;const g=mw[k+1]-mw[k];if(g>bestGap){bestGap=g;cut=mw[k];}}
  if(bestGap<Math.max(med*0.5,1))cut=FLOOR;   // no clear separation → motif = touch-component

  // Apply merges up to the cut.
  const par=[...Array(n).keys()], find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  for(const[d,a,b]of edges){if(d<=cut+1e-9){const ra=find(a),rb=find(b);if(ra!==rb)par[rb]=ra;}}
  const motifs=new Map();
  for(let i=0;i<n;i++){const r=find(i);if(!motifs.has(r))motifs.set(r,[]);motifs.get(r).push(i);}
  const ml=[...motifs.values()];
  const cent=ml.map(idx=>{let x=0,y=0,c=0;idx.forEach(i=>strokes[i].pts.forEach(p=>{x+=p[0];y+=p[1];c++;}));return[x/c,y/c];});

  // Visit motifs nearest-first, starting from the top-left one (deterministic).
  const mUsed=new Uint8Array(ml.length);
  let m0=0,bb=Infinity;cent.forEach((p,i)=>{const v=p[0]+p[1];if(v<bb){bb=v;m0=i;}});
  const mOrder=[m0];mUsed[m0]=1;let mc=cent[m0];
  for(let c=1;c<ml.length;c++){let best=-1,bd=Infinity;for(let i=0;i<ml.length;i++){if(mUsed[i])continue;const d=Math.hypot(cent[i][0]-mc[0],cent[i][1]-mc[1]);if(d<bd){bd=d;best=i;}}mUsed[best]=1;mOrder.push(best);mc=cent[best];}

  // Emit: within each motif, nearest-first from the entry point; reverse strokes as needed.
  const path=[]; let cur=null;
  for(const mi of mOrder){
    const idx=ml[mi], u2=new Uint8Array(idx.length);
    for(let c=0;c<idx.length;c++){
      let best=-1,bdir=false,bdist=Infinity;
      for(let k=0;k<idx.length;k++){if(u2[k])continue;const i=idx[k];
        const d0=cur?Math.hypot(ep[i][0][0]-cur[0],ep[i][0][1]-cur[1]):(ep[i][0][0]+ep[i][0][1]);
        const d1=cur?Math.hypot(ep[i][1][0]-cur[0],ep[i][1][1]-cur[1]):(ep[i][1][0]+ep[i][1][1]);
        const d=Math.min(d0,d1);if(d<bdist){bdist=d;best=k;bdir=d1<d0;}}
      u2[best]=1;const i=idx[best];let pts=strokes[i].pts;if(bdir)pts=pts.slice().reverse();
      for(let q=0;q<pts.length-1;q++)path.push({start:pts[q],end:pts[q+1],jump:!!cur&&q===0,fam:strokes[i].fi});
      cur=pts[pts.length-1];
    }
  }
  return path;
}

// Filter a stitch path to only include segments visible in the canvas viewport.
// Maintains jump flags so the needle jumps across invisible regions.
function filterVisiblePath(path, lay){
  const w=SIZE, h=lay.canvasH||SIZE;
  const g2s=lay.g2s;
  const result=[];
  let skipped=false;
  for(const s of path){
    const a=g2s(s.start), b=g2s(s.end);
    const vis=(a.x>-50&&a.x<w+50&&a.y>-50&&a.y<h+50)||(b.x>-50&&b.x<w+50&&b.y>-50&&b.y<h+50);
    if(vis){
      result.push({...s, jump:s.jump||skipped});
      skipped=false;
    }else{
      skipped=true;
    }
  }
  return result;
}

// ── Arc atomicity (routing rule: an arc starts at one of its endpoints) ─────
// Each drawn arc (segments sharing an aid≥0) is pulled out as ONE complete stroke
// running from one endpoint to the other. This guarantees — in every routing mode —
// that the needle begins an arc at a drawn endpoint, never somewhere in its middle.
// The flattened segments arrive in sweep order and chain end→start, so the polyline
// is just their points concatenated. Returns {arcStrokes:[[pt,…]], lineSegs:[…]}.
function extractArcStrokes(segs){
  const order=[], byAid=new Map(), lineSegs=[];
  for(const s of segs){
    if(s.aid!==undefined && s.aid>=0){
      if(!byAid.has(s.aid)){byAid.set(s.aid,[]);order.push(s.aid);}
      byAid.get(s.aid).push(s);
    }else lineSegs.push(s);
  }
  const arcStrokes=[];
  for(const aid of order){
    const list=byAid.get(aid);
    if(!list.length)continue;
    const pts=[list[0].start.slice()];
    let prev=list[0].start;
    for(const s of list){
      // Tolerate a rare ordering gap: re-anchor if this segment doesn't continue the chain.
      if(Math.hypot(s.start[0]-prev[0],s.start[1]-prev[1])>1e-3)pts.push(s.start.slice());
      pts.push(s.end.slice());
      prev=s.end;
    }
    if(pts.length>=2)arcStrokes.push(pts);
  }
  return {arcStrokes, lineSegs};
}

// ── Stroke formation for one family (Rule 1: min-deflection) ──────────────
// Arcs and straight lines both become whole SUPER-EDGES, entered only at a drawn
// endpoint (the start-at-endpoint rule). Min-deflection matching chains them at
// shared endpoints into long strokes. A super-edge is always traversed in full,
// so a stroke can never start in the middle of an arc.
//
// Arc continuation is TANGENT-ONLY: an arc chains into a neighbour only if the join
// is near-smooth (same curve continuing) — so a circle drawn as quarter-arcs becomes
// one half-circle, but a corner/cusp where two scallops meet (e.g. Seigaiha's ~90°
// joins) BREAKS, leaving each bump its own half-circle stroke to be swept row-by-row.
// Pure line junctions keep the full maxTurn budget (straight through crossings).
// (The Waves/contour engine, by contrast, deliberately chains scallops across cusps.)
const ARC_TANGENT=45*Math.PI/180;
function buildStrokesForFamily(segs, maxTurn){
  const Q=1e-4;
  const {arcStrokes, lineSegs}=extractArcStrokes(segs);

  const vId=new Map(), vPos=[];
  const vidOf=p=>{const k=Math.round(p[0]/Q)+','+Math.round(p[1]/Q);let id=vId.get(k);
    if(id===undefined){id=vPos.length;vId.set(k,id);vPos.push([p[0],p[1]]);}return id;};

  const E=[];                 // open super-edges {a,b,pts,isArc} (pts run a→b)
  const closedStrokes=[];     // closed-loop arcs (no endpoint) — can't chain, emitted as-is
  for(const pts of arcStrokes){
    if(Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1e-6){closedStrokes.push(pts);continue;}
    E.push({a:vidOf(pts[0]),b:vidOf(pts[pts.length-1]),pts:pts.map(p=>p.slice()),isArc:true});
  }
  const seen=new Set();
  for(const l of lineSegs){
    const a=vidOf(l.start), b=vidOf(l.end);
    if(a===b)continue;
    const ek=a<b?a+'_'+b:b+'_'+a;
    if(seen.has(ek))continue; seen.add(ek);
    E.push({a,b,pts:[l.start.slice(),l.end.slice()],isArc:false});
  }
  if(!E.length)return closedStrokes;

  // Tangent at an endpoint, pointing INTO the super-edge (continuation dir from that end).
  const dirInto=(e,fromA)=>{
    const p=e.pts, n=p.length; let dx,dy;
    if(fromA){dx=p[1][0]-p[0][0];dy=p[1][1]-p[0][1];}
    else     {dx=p[n-2][0]-p[n-1][0];dy=p[n-2][1]-p[n-1][1];}
    const L=Math.hypot(dx,dy)||1; return[dx/L,dy/L];
  };
  const polyFrom=(e,fromA)=> fromA ? e.pts.map(p=>p.slice()) : e.pts.slice().reverse().map(p=>p.slice());

  const adj=vPos.map(()=>[]);
  E.forEach((e,ei)=>{
    adj[e.a].push({e:ei,to:e.b,fromA:true, dir:dirInto(e,true), tw:-1, arc:e.isArc});
    adj[e.b].push({e:ei,to:e.a,fromA:false,dir:dirInto(e,false),tw:-1, arc:e.isArc});
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
    const cost=(i,j)=>{
      let dt=list[i].dir[0]*list[j].dir[0]+list[i].dir[1]*list[j].dir[1];
      dt=Math.max(-1,Math.min(1,dt)); const turn=Math.PI-Math.acos(dt);  // deviation from straight-through
      // An arc only continues into a near-tangent neighbour; a corner/cusp breaks it.
      if((list[i].arc||list[j].arc) && turn>ARC_TANGENT) return 9;  // > any maxTurn ⇒ forbidden
      return turn;
    };
    partner[v].set(matchVertex(d,cost,maxTurn));
  });

  const usedE=new Uint8Array(E.length), strokes=[];
  function trace(v0,li0){
    let v=v0,li=li0,pts=null;
    for(;;){
      const h=adj[v][li]; if(usedE[h.e])break; usedE[h.e]=1;
      const poly=polyFrom(E[h.e],h.fromA);
      if(!pts)pts=[poly[0]];
      for(let k=1;k<poly.length;k++)pts.push(poly[k]);
      const nl=partner[h.to][h.tw];
      if(nl<0)break;
      v=h.to; li=nl;
    }
    if(pts&&pts.length>=2)strokes.push(pts);
  }
  adj.forEach((list,v)=>list.forEach((h,li)=>{
    if(partner[v][li]<0 && !usedE[h.e])trace(v,li);
  }));
  E.forEach((e,ei)=>{
    if(usedE[ei])return;
    trace(e.a, adj[e.a].findIndex(h=>h.e===ei));
  });

  return closedStrokes.concat(strokes);
}

// ── Contour/wave tracer (Logik 3) ────────────────────────────────────────────
// Chains whole arcs into long forward-marching waves (scallops / diagonal sines).
//
// Each arc is an ATOMIC super-edge between its two drawn endpoints: a wave may chain
// one arc into the next at a shared endpoint, but can never enter or leave an arc in
// its middle. This restores Shippō's continuous diagonal sine curves (arcs that meet
// tangent-smooth chain into one wave) while keeping the start-at-endpoint rule, and
// Seigaiha's scallops stay separate because their meets are cusps that exceed maxTurn.
//
// Tries 4 sweep axes (horizontal, vertical, both diagonals) and keeps the decomposition
// with the FEWEST strokes = longest continuous runs. Within a wave the needle always
// progresses along the axis, taking the smoothest forward arc at each shared endpoint.
// Leftover super-edges (≈perpendicular to the axis) are traced straightest-first.
function buildContourStrokes(segs, maxTurn){
  const Q=1e-4;
  // Arcs become whole-polyline super-edges; straight lines are single-segment super-edges.
  const {arcStrokes, lineSegs}=extractArcStrokes(segs);

  const vId=new Map(), vPos=[];
  const vidOf=p=>{const k=Math.round(p[0]/Q)+','+Math.round(p[1]/Q);let id=vId.get(k);
    if(id===undefined){id=vPos.length;vId.set(k,id);vPos.push([p[0],p[1]]);}return id;};

  const E=[];               // super-edges: {a,b,pts}  (pts run a→b)
  for(const pts of arcStrokes){
    const a=vidOf(pts[0]), b=vidOf(pts[pts.length-1]);
    E.push({a,b,pts:pts.map(p=>p.slice())});
  }
  const seen=new Set();
  for(const l of lineSegs){
    const a=vidOf(l.start), b=vidOf(l.end);
    if(a===b)continue;
    const ek=a<b?a+'_'+b:b+'_'+a;
    if(seen.has(ek))continue; seen.add(ek);
    E.push({a,b,pts:[l.start.slice(),l.end.slice()]});
  }
  if(!E.length)return[];

  // Tangent of a super-edge at an endpoint, pointing INTO the edge (continuation dir
  // when entering from that end). Uses the first/last polyline segment.
  const dirInto=(e,fromA)=>{
    const p=e.pts, n=p.length;
    let dx,dy;
    if(fromA){dx=p[1][0]-p[0][0];dy=p[1][1]-p[0][1];}
    else     {dx=p[n-2][0]-p[n-1][0];dy=p[n-2][1]-p[n-1][1];}
    const L=Math.hypot(dx,dy)||1; return[dx/L,dy/L];
  };
  // Direction of travel as the needle ARRIVES at the far end (used as inDir for the next pick).
  const dirArrive=(e,fromA)=>{
    const p=fromA?e.pts:e.pts.slice().reverse(), n=p.length;
    let dx=p[n-1][0]-p[n-2][0], dy=p[n-1][1]-p[n-2][1];
    const L=Math.hypot(dx,dy)||1; return[dx/L,dy/L];
  };
  const polyFrom=(e,fromA)=> fromA ? e.pts.map(p=>p.slice()) : e.pts.slice().reverse().map(p=>p.slice());

  const adj=vPos.map(()=>[]);
  E.forEach((e,ei)=>{
    adj[e.a].push({e:ei,to:e.b,fromA:true, dir:dirInto(e,true)});
    adj[e.b].push({e:ei,to:e.a,fromA:false,dir:dirInto(e,false)});
  });

  function traceAxis(ax,ay){
    const usedE=new Uint8Array(E.length), strokes=[];
    const proj=i=>vPos[i][0]*ax+vPos[i][1]*ay;
    const verts=[...Array(vPos.length).keys()].sort((i,j)=>proj(i)-proj(j));
    const pick=(v,inDir)=>{           // smoothest UNused super-edge that progresses along the axis
      let best=-1,bestTurn=Infinity;
      for(let li=0;li<adj[v].length;li++){
        const h=adj[v][li]; if(usedE[h.e])continue;
        const fwd=h.dir[0]*ax+h.dir[1]*ay; if(fwd<=1e-6)continue;
        let turn;
        if(!inDir)turn=-fwd;            // start a wave on its most-forward arc
        else{let dt=h.dir[0]*inDir[0]+h.dir[1]*inDir[1];dt=Math.max(-1,Math.min(1,dt));turn=Math.acos(dt);if(turn>maxTurn)continue;}
        if(turn<bestTurn){bestTurn=turn;best=li;}
      }
      return best;
    };
    const run=(v0,cl0)=>{              // follow super-edges from v0, appending whole polylines
      let pts=null, v=v0, cl=cl0, inDir=null;
      for(;;){
        const h=adj[v][cl]; if(usedE[h.e])break; usedE[h.e]=1;
        const poly=polyFrom(E[h.e],h.fromA);
        if(!pts)pts=[poly[0]];
        for(let k=1;k<poly.length;k++)pts.push(poly[k]);
        inDir=dirArrive(E[h.e],h.fromA); v=h.to;
        const nl=pick(v,inDir); if(nl<0)break; cl=nl;
      }
      if(pts&&pts.length>=2)strokes.push(pts);
    };
    for(const v0 of verts){
      let li; while((li=pick(v0,null))>=0)run(v0,li);
    }
    // fallback for super-edges ≈perpendicular to the axis (never "forward"): straightest-first
    E.forEach((e,ei)=>{
      if(usedE[ei])return;
      run(e.a, adj[e.a].findIndex(h=>h.e===ei));
    });
    return strokes;
  }

  const axes=[[1,0],[Math.SQRT1_2,Math.SQRT1_2],[0,1],[-Math.SQRT1_2,Math.SQRT1_2]];
  let best=null,bestN=Infinity;
  for(const[ax,ay]of axes){const s=traceAxis(ax,ay); if(s.length<bestN){bestN=s.length;best=s;}}
  return best||[];
}

// ── Stroke ordering within one family: band-snake (reliable for all orientations) ─
function orderStrokesFamily(strokes){
  strokes=strokes.filter(pts=>pts&&pts.length>=2);  // drop degenerate/empty strokes
  if(strokes.length<=1)return strokes.map(pts=>({pts}));

  // Compute dominant orientation from all stroke endpoints
  const S=strokes.map(pts=>{
    const first=pts[0], last=pts[pts.length-1];
    const dx=last[0]-first[0], dy=last[1]-first[1];
    const len=Math.hypot(dx,dy);
    if(len<1e-6)return{pts, ang:0, len:0, first, last};  // closed loop (e.g. full-circle arc)
    let ang=Math.atan2(dy,dx); if(ang<0)ang+=Math.PI;
    return{pts, ang, len, first, last,
      ac0:0, ac1:0}; // filled later
  });

  // Mean orientation via double-angle weighting (handles 0°/90° ambiguity)
  let sc=0,ss=0;
  S.forEach(s=>{const w=s.len||1; sc+=w*Math.cos(2*s.ang); ss+=w*Math.sin(2*s.ang);});
  const axisAng=0.5*Math.atan2(ss,sc);
  const axis=[Math.cos(axisAng),Math.sin(axisAng)];        // along-band direction
  const perp=[-Math.sin(axisAng),Math.cos(axisAng)];       // cross-band (perpendicular)

  // Band coordinate = perpendicular component of first point
  S.forEach(s=>{
    s.bc=s.first[0]*perp[0]+s.first[1]*perp[1];
    s.ac=s.first[0]*axis[0]+s.first[1]*axis[1]; // along-axis = position within band
  });

  // Band assignment: detect pitch from unique band coordinates
  const uniqueBcs=[...new Set(S.map(s=>Math.round(s.bc*1e4)/1e4))].sort((a,b)=>a-b);
  let pitch=Infinity;
  for(let i=1;i<uniqueBcs.length;i++)pitch=Math.min(pitch,uniqueBcs[i]-uniqueBcs[i-1]);
  if(!isFinite(pitch)||pitch<1e-4)pitch=1;
  const minbc=Math.min(...S.map(s=>s.bc));
  S.forEach(s=>s.band=Math.round((s.bc-minbc)/pitch));

  // Sort: primary by band, secondary by along-axis (snake: even fwd, odd rev)
  S.sort((a,b)=>{
    if(a.band!==b.band)return a.band-b.band;
    return a.band%2===0 ? a.ac-b.ac : b.ac-a.ac;
  });

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

// ══════════ Routing v2 (additive modes — the four original modes are untouched) ══════════
// Four NEW selectable routing modes in a separate pipeline (buildExpPath dispatches here
// before touching any v1 code path):
//   rows2   "1b · Straight rows v2 · ordered"   — robust band-snake: gap-CLUSTERED bands
//           with RANK parity (fixes min-gap pitch collapse + parity scramble), CENTROID
//           band coordinate (per ROUTING.md Rule 3), movement-type + 30° orientation bins,
//           NN fallback when banding degenerates. Prefers the most PREDICTABLE candidate
//           ordering within 15% of the cheapest.
//   rows2e  "1c · Straight rows v2 · efficient" — same candidates, always the cheapest by
//           (jumps over the carry cap, then total jump length).
//   zigzag2 "2b · Zigzag v2" — strokes built from the POOLED segment set instead of per
//           family, so ±slope zigzag legs chain through every apex into true edge-to-edge
//           runs (per-family building broke the chain at every apex); the drawn family is
//           kept per SEGMENT for colouring.
//   waves2  "3b · Waves v2" — contour waves exactly as mode 3 builds them, but ordered with
//           the robust band-snake / NN fallback instead of the fragile min-gap pitch.
// Shared v2 rules (user decisions 2026-07-02):
//   • HARD CARRY CAP — a back-carry longer than ~1.5× the family's row advance means
//     "cut the thread" in real sashiko; such jumps are penalised lexicographically BEFORE
//     total jump length when choosing between candidate orderings.
//   • TRADITIONAL FAMILY ORDER when the pattern has no famOrder: all horizontals → all
//     verticals → diagonals → curves/mixed (screen-space orientation, iso-aware).
//   • Closed loops assembled from several OPEN arcs enter at a drawn arc ENDPOINT
//     (fixes the mid-arc entries _rotateClosedEntry produced on e.g. Maru Shippō).
function _isV2Mode(m){return m==='rows2'||m==='rows2e'||m==='zigzag2'||m==='waves2';}

// Vertex key aligned to the router's vertex-merge resolution (Q=1e-4 in
// buildStrokesForFamily): two coordinates the router treats as ONE vertex always
// produce the same key, so arc-endpoint / fam lookups can't miss on float noise.
function _v2VKey(p){return Math.round(p[0]*1e4)+','+Math.round(p[1]*1e4);}

// March-direction class of a segment for zigzag colouring/passes: 0 = horizontal-marching,
// 1 = vertical-marching, by nearest screen axis (iso grids map (u,v)→screen like
// autoAssignFamilies: dx=du−dv, dy=du+dv). Both legs of one zigzag line share a class, so a
// continuous zigzag line gets one colour and a mesh routes into the two traditional passes.
function _zzDirClass(a,b,iso){
  let dx=b[0]-a[0], dy=b[1]-a[1];
  if(iso){const du=dx,dv=dy;dx=du-dv;dy=du+dv;}
  let ang=Math.atan2(dy,dx); if(ang<0)ang+=Math.PI;   // [0,π)
  return Math.min(ang,Math.PI-ang)<Math.PI/4 ? 0 : 1;
}

// Length, length-weighted centroid, net orientation [0,π) and movement type of one stroke
// (ROUTING.md Rule 3: Σ|turn| small ⇒ straight 0; alternating signs ⇒ zigzag 1; else curve 2).
function _v2StrokeInfo(pts){
  let len=0,cx=0,cy=0;
  for(let k=1;k<pts.length;k++){
    const l=Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1]);
    len+=l; cx+=(pts[k][0]+pts[k-1][0])/2*l; cy+=(pts[k][1]+pts[k-1][1])/2*l;
  }
  if(len>1e-9){cx/=len;cy/=len;}else{cx=pts[0][0];cy=pts[0][1];}
  // Net orientation: first→last for open strokes (a zigzag's march direction);
  // segment double-angle mean for closed loops.
  let dx=pts[pts.length-1][0]-pts[0][0], dy=pts[pts.length-1][1]-pts[0][1];
  if(Math.hypot(dx,dy)<1e-6){
    let sc=0,ss=0;
    for(let k=1;k<pts.length;k++){
      const ux=pts[k][0]-pts[k-1][0],uy=pts[k][1]-pts[k-1][1],l=Math.hypot(ux,uy);
      if(l<1e-9)continue; const a=Math.atan2(uy,ux);
      sc+=l*Math.cos(2*a); ss+=l*Math.sin(2*a);
    }
    const a=0.5*Math.atan2(ss,sc); dx=Math.cos(a); dy=Math.sin(a);
  }
  let ang=Math.atan2(dy,dx); if(ang<0)ang+=Math.PI; if(ang>=Math.PI-1e-9)ang=0;
  let sum=0,pos=0,neg=0;
  for(let k=1;k<pts.length-1;k++){
    const ax=pts[k][0]-pts[k-1][0],ay=pts[k][1]-pts[k-1][1];
    const bx=pts[k+1][0]-pts[k][0],by=pts[k+1][1]-pts[k][1];
    if(Math.hypot(ax,ay)<1e-9||Math.hypot(bx,by)<1e-9)continue;
    const t=Math.atan2(ax*by-ay*bx,ax*bx+ay*by);
    sum+=Math.abs(t); if(t>0.03)pos++; else if(t<-0.03)neg++;
  }
  const kind=sum<Math.PI/6?0:(pos&&neg?1:2);
  return{pts,len,cx,cy,ang,kind};
}

// Cluster 1-D band coordinates at their natural break (robust replacement for the v1
// min-gap pitch): if the sorted gap magnitudes contain a clear jump (ratio > 4), gaps
// below it are float noise / same row and get merged; otherwise every distinct value is
// its own band. Returns each value's band RANK (0,1,2,… consecutive), so snake parity
// rank%2 alternates row by row BY CONSTRUCTION — no empty band indices.
function _v2BandRanks(vals){
  const idx=vals.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]);
  const gaps=[];
  for(let k=1;k<idx.length;k++){const g=idx[k][0]-idx[k-1][0];if(g>1e-9)gaps.push(g);}
  let tol=1e-9;
  if(gaps.length>1){
    const sg=[...gaps].sort((a,b)=>a-b);
    const span=idx[idx.length-1][0]-idx[0][0];
    let bestR=0,at=-1;
    for(let k=1;k<sg.length;k++){const r=sg[k]/Math.max(sg[k-1],1e-12);if(r>bestR){bestR=r;at=k;}}
    // Merge only true float noise: a >4× gap-magnitude jump AND the smaller side must be
    // tiny vs the average row advance. Without the second test a genuine cluster gap
    // (e.g. from `spacing`) would collapse whole pitch-1 rows into one band.
    if(bestR>4 && sg[at-1] < 0.25*span/Math.max(1,vals.length-1))
      tol=Math.sqrt(sg[at]*sg[at-1]);   // geometric mean separates noise from rows
  }
  const ranks=new Array(vals.length); let band=0;
  for(let k=0;k<idx.length;k++){
    if(k>0&&idx[k][0]-idx[k-1][0]>tol)band++;
    ranks[idx[k][1]]=band;
  }
  return ranks;
}

// Band-snake one stroke set along one axis: clustered CENTROID perpendicular coordinate,
// bands swept in rank order, alternate bands reversed (snake).
function _v2BandSnake(infos,axisAng){
  const ax=Math.cos(axisAng),ay=Math.sin(axisAng),px=-Math.sin(axisAng),py=Math.cos(axisAng);
  const bc=infos.map(s=>s.cx*px+s.cy*py);
  const band=_v2BandRanks(bc);
  const order=infos.map((s,i)=>({s,band:band[i],ac:s.cx*ax+s.cy*ay}));
  order.sort((a,b)=>a.band!==b.band?a.band-b.band:(a.band%2===0?a.ac-b.ac:b.ac-a.ac));
  return order.map(o=>o.s);
}

// Greedy nearest-neighbour ordering over stroke endpoints (degeneracy fallback and the
// "efficient" candidate). Deterministic start: nearest to the top-left.
function _v2NN(infos,start){
  const rem=infos.slice(),out=[];
  let cur=start||null;
  while(rem.length){
    let bi=0,bd=Infinity;
    for(let i=0;i<rem.length;i++){
      const p=rem[i].pts,s=p[0],e=p[p.length-1];
      const d=cur?Math.min(Math.hypot(s[0]-cur[0],s[1]-cur[1]),Math.hypot(e[0]-cur[0],e[1]-cur[1]))
                 :Math.min(s[0]+s[1],e[0]+e[1]);
      if(d<bd){bd=d;bi=i;}
    }
    const s=rem.splice(bi,1)[0];out.push(s);
    const p=s.pts,ps=p[0],pe=p[p.length-1];
    if(!cur)cur=(ps[0]+ps[1]<=pe[0]+pe[1])?pe:ps;
    else cur=(Math.hypot(ps[0]-cur[0],ps[1]-cur[1])<=Math.hypot(pe[0]-cur[0],pe[1]-cur[1]))?pe:ps;
  }
  return out;
}

// A jump longer than the carry cap means cutting + re-anchoring the thread. That is
// drastically — but finitely — more expensive than carrying: one cut ≈ V2_CUT grid
// units of extra carry. Score = jumpLen + V2_CUT · (jumps over cap).
const V2_CUT=30;
function _v2Score(c){return c.len+V2_CUT*c.over;}
// Simulated emit cost of an ordering (nearest-end entry per stroke): total jump length
// plus the count of jumps longer than the carry cap.
function _v2Cost(infos,cap){
  let over=0,len=0,cur=null;
  for(const s of infos){
    const p=s.pts,ps=p[0],pe=p[p.length-1];
    // Match _v2Emit: a closed loop is entered at its nearest vertex and returns there,
    // so the jump is to that vertex and the needle resumes from it (not from pts[0]).
    const closed=p.length>=3&&Math.hypot(ps[0]-pe[0],ps[1]-pe[1])<1e-3;
    if(cur){
      let d,nx;
      if(closed){
        d=Infinity;
        for(let k=0;k<p.length-1;k++){const dd=Math.hypot(p[k][0]-cur[0],p[k][1]-cur[1]);if(dd<d){d=dd;nx=p[k];}}
      }else{
        const dS=Math.hypot(ps[0]-cur[0],ps[1]-cur[1]),dE=Math.hypot(pe[0]-cur[0],pe[1]-cur[1]);
        d=Math.min(dS,dE); nx=dS<=dE?pe:ps;
      }
      len+=d; if(d>cap)over++;
      cur=nx;
    }else cur=closed?ps:pe;
  }
  return{over,len};
}

// Carry cap for one family ≈ 1.5× the median row advance of its banded layout
// (row-to-row jumps stay free; cross-canvas returns count as thread cuts), floor 2 units.
function _v2Cap(infos,axisAng){
  const px=-Math.sin(axisAng),py=Math.cos(axisAng);
  const bc=infos.map(s=>s.cx*px+s.cy*py);
  const ranks=_v2BandRanks(bc),sum=new Map(),cnt=new Map();
  bc.forEach((v,i)=>{const r=ranks[i];sum.set(r,(sum.get(r)||0)+v);cnt.set(r,(cnt.get(r)||0)+1);});
  const means=[...sum.keys()].sort((a,b)=>a-b).map(r=>sum.get(r)/cnt.get(r));
  const gaps=[];for(let k=1;k<means.length;k++)gaps.push(means[k]-means[k-1]);
  gaps.sort((a,b)=>a-b);
  const med=gaps.length?gaps[gaps.length>>1]:0;
  return Math.max(2,1.5*med);
}

// Length-weighted double-angle mean axis + orientation concentration R (1 = aligned).
function _v2Axis(infos){
  let sc=0,ss=0,w=0;
  infos.forEach(s=>{const wt=s.len||1;sc+=wt*Math.cos(2*s.ang);ss+=wt*Math.sin(2*s.ang);w+=wt;});
  return{ang:0.5*Math.atan2(ss,sc),R:w>0?Math.hypot(sc,ss)/w:0};
}

// Order one family's strokes. Candidates:
//   A  single-axis band-snake with robust clustered bands (most predictable),
//   B  movement-type + 30° orientation bins, band-snake per bin (ROUTING.md Rule 3),
//   D  the v1 orderStrokesFamily ordering (guarantees v2 is never worse than v1),
//   C  nearest-neighbour (most efficient).
// variant 'ordered' → most predictable candidate within 15% of the cheapest score;
// variant 'efficient' → outright cheapest.
function _v2OrderFamily(strokes,variant){
  const infos=strokes.map(p=>_v2StrokeInfo(p)).filter(s=>s.pts.length>=2);
  if(infos.length<=1)return infos;
  const axis=_v2Axis(infos);
  const cap=_v2Cap(infos,axis.ang);
  const cands=[{o:_v2BandSnake(infos,axis.ang),rank:0}];
  const bins=new Map();
  infos.forEach(s=>{
    const key=s.kind*100+Math.floor(s.ang/(Math.PI/6));
    if(!bins.has(key))bins.set(key,[]);
    bins.get(key).push(s);
  });
  if(bins.size>1){
    const o=[];
    [...bins.keys()].sort((a,b)=>a-b).forEach(k=>{
      const g=bins.get(k);
      if(g.length>1)o.push(..._v2BandSnake(g,_v2Axis(g).ang)); else o.push(g[0]);
    });
    cands.push({o,rank:1});
  }
  cands.push({o:orderStrokesFamily(infos.map(s=>s.pts)).map(s=>_v2StrokeInfo(s.pts)),rank:2});
  cands.push({o:_v2NN(infos,null),rank:3});
  cands.forEach(c=>{c.cost=_v2Cost(c.o,cap);c.score=_v2Score(c.cost);});
  cands.sort((x,y)=>x.score!==y.score?x.score-y.score:x.rank-y.rank);
  if(variant==='efficient')return cands[0].o;
  // ordered: the most predictable candidate within 15% of the cheapest score —
  // banding only yields to NN when it is MATERIALLY worse (degenerate banding).
  const best=cands[0];
  for(const c of [...cands].sort((x,y)=>x.rank-y.rank)){
    if(c.score<=best.score*1.15+1e-9)return c.o;
  }
  return best.o;
}

// Traditional pass class of one family: 0 horizontal, 1 vertical, 2 diagonal,
// 3 curves/mixed. Screen-space orientation; iso grids map (u,v)→screen like
// autoAssignFamilies (dx=du−dv, dy=du+dv).
function _v2FamClass(infos,iso,arcFrac){
  let sc=0,ss=0,w=0;
  infos.forEach(s=>{
    let dx=Math.cos(s.ang),dy=Math.sin(s.ang);
    if(iso){const du=dx,dv=dy;dx=du-dv;dy=du+dv;}
    let a=Math.atan2(dy,dx);if(a<0)a+=Math.PI;
    const wt=s.len||1;sc+=wt*Math.cos(2*a);ss+=wt*Math.sin(2*a);w+=wt;
  });
  const R=w>0?Math.hypot(sc,ss)/w:0;
  let a=0.5*Math.atan2(ss,sc);if(a<0)a+=Math.PI;
  if(arcFrac>0.5||R<0.3)return{cls:3,a};
  if(Math.min(a,Math.PI-a)<Math.PI/12)return{cls:0,a};   // horizontal ±15°
  if(Math.abs(a-Math.PI/2)<Math.PI/12)return{cls:1,a};   // vertical ±15°
  return{cls:2,a};
}

// Drawn-arc ENDPOINT keys (open arcs only) — the legal entry vertices for closed loops
// assembled from several open arcs. Drawn full circles (single closed aid) contribute
// nothing: they may legitimately start anywhere.
function _v2ArcEndpoints(segs){
  const K=_v2VKey;
  const first=new Map(),last=new Map();
  for(const s of segs){
    if(s.aid===undefined||s.aid<0)continue;
    if(!first.has(s.aid))first.set(s.aid,s.start);
    last.set(s.aid,s.end);
  }
  const set=new Set();
  for(const[aid,f]of first){
    const kf=K(f),kl=K(last.get(aid));
    if(kf===kl)continue;
    set.add(kf);set.add(kl);
  }
  return set;
}
// Like _rotateClosedEntry, but restricted to drawn arc endpoints when the loop
// contains any; falls back to nearest-anywhere for pure-line loops / drawn circles.
function _rotateClosedEntryV2(pts,needle,allowed){
  const n=pts.length-1;if(n<2)return pts;
  const K=_v2VKey;
  let best=-1,bestD=Infinity;
  if(allowed&&allowed.size){
    for(let r=0;r<n;r++){
      if(!allowed.has(K(pts[r])))continue;
      const d=Math.hypot(pts[r][0]-needle[0],pts[r][1]-needle[1]);
      if(d<bestD){bestD=d;best=r;}
    }
  }
  if(best<0)return _rotateClosedEntry(pts,needle);
  if(best===0)return pts;
  const core=pts.slice(0,n);
  return[...core.slice(best),...core.slice(0,best),core[best].slice()];
}

// Shared v2 emit: family by family, nearest-end entry per stroke, closed loops enter
// at a drawn arc endpoint where one exists.
function _v2Emit(famSeq,allowed){
  const path=[];let cur=null;
  for(const fam of famSeq){
    for(const s of fam.strokes){
      let pts=s.pts;
      const closed=pts.length>=3&&Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1e-3;
      if(closed)pts=_rotateClosedEntryV2(pts,cur||pts[0],allowed);
      else if(cur){
        const dS=Math.hypot(pts[0][0]-cur[0],pts[0][1]-cur[1]);
        const dE=Math.hypot(pts[pts.length-1][0]-cur[0],pts[pts.length-1][1]-cur[1]);
        if(dE<dS)pts=pts.slice().reverse();
      }
      for(let k=0;k<pts.length-1;k++)path.push({start:pts[k],end:pts[k+1],jump:!!cur&&k===0,fam:fam.fi});
      cur=pts[pts.length-1];
    }
  }
  return path;
}

function buildExpPathV2(lines,famOrderOverride,mode,opts){
  const iso=!!(opts&&opts.iso);
  const allowed=_v2ArcEndpoints(lines);
  const famGroups=new Map();
  lines.forEach(l=>{const fi=l.fam||0;if(!famGroups.has(fi))famGroups.set(fi,[]);famGroups.get(fi).push(l);});

  if(mode==='zigzag2'){
    // Pooled stroke building: all families in ONE buildStrokesForFamily call so ±slope
    // legs chain through every apex (Tsuzuki Yamagata: 2 edge-to-edge chains instead of
    // 878 apex-broken ones).
    //
    // COLOURING / PASSES for zigzag are by MARCH DIRECTION, not by drawn leg-family: the two
    // legs of one continuous zigzag line sit in different drawn families, so colouring by
    // drawn family would paint a single line in two alternating colours and split it across
    // two PDF pass windows. Instead each segment is classed by its nearest screen axis
    // (`_zzDirClass`) → both legs of a horizontal-marching zigzag are class 0, both legs of a
    // vertical one are class 1. Result: one colour per continuous line, and exactly the
    // traditional two passes (all horizontal zigzags, then all vertical) — like the built-in
    // Tsuzuki Yamagata engine. Colouring (renderExp) and the PDF passes both read this fam,
    // so they stay consistent. Only zigzag2 does this; every other mode is untouched.
    const ordered=_v2NN(buildStrokesForFamily(lines,Math.PI).map(p=>_v2StrokeInfo(p)).filter(s=>s.pts.length>=2),null);
    const path=[];let cur=null;
    for(const s of ordered){
      let pts=s.pts;
      const closed=pts.length>=3&&Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1e-3;
      if(closed)pts=_rotateClosedEntryV2(pts,cur||pts[0],allowed);
      else if(cur){
        const dS=Math.hypot(pts[0][0]-cur[0],pts[0][1]-cur[1]);
        const dE=Math.hypot(pts[pts.length-1][0]-cur[0],pts[pts.length-1][1]-cur[1]);
        if(dE<dS)pts=pts.slice().reverse();
      }
      for(let k=0;k<pts.length-1;k++)
        path.push({start:pts[k],end:pts[k+1],jump:!!cur&&k===0,fam:_zzDirClass(pts[k],pts[k+1],iso)});
      cur=pts[pts.length-1];
    }
    return path;
  }

  const variant=mode==='rows2e'?'efficient':'ordered';
  const famData=[];
  for(const[fi,segs]of famGroups){
    const strokes=mode==='waves2'?buildContourStrokes(segs,120*Math.PI/180)
                                 :buildStrokesForFamily(segs,90*Math.PI/180);
    const infos=_v2OrderFamily(strokes,variant);
    if(!infos.length)continue;
    let arcLen=0,totLen=0;
    for(const s of segs){
      const l=Math.hypot(s.end[0]-s.start[0],s.end[1]-s.start[1]);
      totLen+=l; if(s.aid!==undefined&&s.aid>=0)arcLen+=l;
    }
    const cl=_v2FamClass(infos,iso,totLen>0?arcLen/totLen:0);
    famData.push({fi,strokes:infos,cls:cl.cls,a:cl.a});
  }
  if(!famData.length)return[];
  if(famOrderOverride&&famOrderOverride.length){
    const pos=new Map();famOrderOverride.forEach((fi,i)=>pos.set(fi,i));
    famData.sort((x,y)=>((pos.has(x.fi)?pos.get(x.fi):1e9)-(pos.has(y.fi)?pos.get(y.fi):1e9))||x.fi-y.fi);
  }else{
    // Traditional pass order: horizontals → verticals → diagonals → curves/mixed.
    famData.sort((x,y)=>x.cls-y.cls||x.a-y.a||x.fi-y.fi);
  }
  return _v2Emit(famData,allowed);
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

// Build (and cache) the gallery stitch list from the current EXP_path (anim-canvas coords).
function _galStitchScene(){
  // Stitch length is anchored to the natural tile count (EXP_szRef): when the user changes
  // the tile count the layout scale (EXP_sz) shrinks, so the effective px stitch length and
  // width shrink with it — the number of stitches on any given line stays constant.
  const r=(EXP_szRef>0?EXP_sz/EXP_szRef:1)||1;
  const len=galStitchLen*r, w=_stitchW(len);
  if(_galStitchCache&&_galStitchCache.ref===EXP_path&&_galStitchCache.len===len&&_galStitchCache.ratio===galStitchRatio)
    return _galStitchCache;
  const strokes=_buildStrokesFromPath(EXP_path,p=>{const a=EXP_g2s(p);return[a.x,a.y];});
  return(_galStitchCache={ref:EXP_path,len,ratio:galStitchRatio,w,stitches:_layStitches(strokes,len,galStitchRatio,w)});
}

// ── Draft mode (drafting help lines) ────────────────────────────────────────
// Circumcircle through 3 points (grid coords); null if (near-)collinear.
function _circumcircle(A,B,C){
  const ax=A[0],ay=A[1],bx=B[0],by=B[1],cx=C[0],cy=C[1];
  const d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
  if(Math.abs(d)<1e-9)return null;
  const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy;
  const ux=(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/d;
  const uy=(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/d;
  return{c:[ux,uy],r:Math.hypot(ax-ux,ay-uy)};
}
// Drafting shapes for the current view (tiled like the stitches): straight lines drawn as
// guides, and arcs recovered as the FULL circle they belong to (so the maker drafts the
// whole circle, then stitches only the arc). Cached by EXP_path so Play stays cheap.
function _galDraftShapes(){
  if(_galDraftCache&&_galDraftCache.ref===EXP_path)return _galDraftCache;
  const out={ref:EXP_path,lines:[],circles:[]};
  if(!curPat){return(_galDraftCache=out);}
  const segs=tiledSegsFor({...curPat,patMacro:_tileCells});
  const byAid=new Map();
  segs.forEach(s=>{
    if(s.aid>=0){if(!byAid.has(s.aid))byAid.set(s.aid,[]);byAid.get(s.aid).push(s);}
    else out.lines.push({a:s.start,b:s.end});
  });
  byAid.forEach(group=>{
    const pts=[group[0].start];group.forEach(s=>pts.push(s.end));
    if(pts.length<3)return;
    const cc=_circumcircle(pts[0],pts[Math.floor(pts.length/3)],pts[Math.floor(2*pts.length/3)]);
    if(cc&&isFinite(cc.r)&&cc.r>0)out.circles.push(cc);
  });
  return(_galDraftCache=out);
}
// Clip the infinite line through (px,py) with direction (dx,dy) to the rect [0,w]×[0,h]
// (Liang–Barsky with t∈(−∞,∞)). Returns [[x,y],[x,y]] or null if it misses the rect.
function _clipInfiniteLine(px,py,dx,dy,w,h){
  let t0=-Infinity,t1=Infinity;
  const p=[-dx,dx,-dy,dy], q=[px,w-px,py,h-py];
  for(let i=0;i<4;i++){
    if(Math.abs(p[i])<1e-9){if(q[i]<0)return null;}
    else{const t=q[i]/p[i];
      if(p[i]<0){if(t>t1)return null;if(t>t0)t0=t;}
      else{if(t<t0)return null;if(t<t1)t1=t;}}
  }
  return[[px+t0*dx,py+t0*dy],[px+t1*dx,py+t1*dy]];
}
function _galDrawDraft(){
  const {lines,circles}=_galDraftShapes();
  const w=SIZE,h=EXP_canvasH||SIZE;
  ctx.save();
  // Dark guides on a light fabric, pale guides on a dark one, so they stay visible.
  ctx.strokeStyle=_fabricById(galFabric).light?'rgba(28,42,72,0.5)':'rgba(255,255,255,0.55)';
  ctx.lineWidth=zlw(0.7);ctx.setLineDash([]);ctx.lineCap='round';
  // Straight guides are drawn ruler-style: extend each line right across the frame, and
  // de-dup collinear copies (every tiled segment on the same infinite line = one ruler line).
  const seen=new Set();
  lines.forEach(l=>{
    const p0=EXP_g2s(l.a),p1=EXP_g2s(l.b);
    let dx=p1.x-p0.x,dy=p1.y-p0.y;const len=Math.hypot(dx,dy);
    if(len<1e-6)return;dx/=len;dy/=len;
    // canonical normal (−dy,dx) + signed offset → key the infinite line
    let nx=-dy,ny=dx;if(nx<-1e-9||(Math.abs(nx)<1e-9&&ny<0)){nx=-nx;ny=-ny;}
    const c=nx*p0.x+ny*p0.y;
    const key=Math.round(nx*100)/100+'|'+Math.round(ny*100)/100+'|'+Math.round(c);
    if(seen.has(key))return;seen.add(key);
    const seg=_clipInfiniteLine(p0.x,p0.y,dx,dy,w,h);
    if(!seg)return;
    ctx.beginPath();ctx.moveTo(seg[0][0],seg[0][1]);ctx.lineTo(seg[1][0],seg[1][1]);ctx.stroke();
  });
  const NS=72;
  circles.forEach(cc=>{
    ctx.beginPath();
    for(let k=0;k<=NS;k++){
      const a=k/NS*2*Math.PI;
      const p=EXP_g2s([cc.c[0]+cc.r*Math.cos(a),cc.c[1]+cc.r*Math.sin(a)]);
      if(k===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
  });
  ctx.restore();
}
// ── Stitch-view options + thread-colour preview (gallery animation view) ─────
function syncGalStitchUI(){
  const l=document.getElementById('galStitchLen');if(l)l.value=galStitchLen;
  const lv=document.getElementById('galStitchLenVal');if(lv)lv.textContent=galStitchLen;
  const r=document.getElementById('galStitchRatio');if(r)r.value=galStitchRatio;
  _galSyncOverlaySeg();
  _galClosePops(null);   // close all popovers + reset their button captions
  galBuildColourUI();
  galBuildFabricUI();
  galBuildColorTabs();
}
function galBuildColourUI(){
  const chips=document.getElementById('galFamChips');if(!chips)return;
  const fams=[...new Set(EXP_path.map(s=>s.fam))].sort((a,b)=>a-b);
  if(!fams.includes(galActiveFam))galActiveFam=fams.length?fams[0]:0;
  chips.innerHTML='';
  fams.forEach(f=>{
    const b=document.createElement('button');
    b.className='gal-fam-chip'+(f===galActiveFam?' sel':'');
    b.innerHTML=`<span class="gal-fam-dot" style="background:${galThreadColors[f]||CAD_YARN}"></span>Colour ${f+1}`;
    b.onclick=()=>{galActiveFam=f;galBuildColourUI();};
    chips.appendChild(b);
  });
  galBuildSwatches();
}
function _galSetSwName(txt){const el=document.getElementById('galSwName');if(el)el.textContent=txt;}
function galBuildSwatches(){
  const sw=document.getElementById('galSwatches');if(!sw)return;
  sw.innerHTML='';
  const cur=galThreadColors[galActiveFam];
  // Name of the colour currently assigned to the active family (shown as the resting caption).
  let selName='Off-white (default)';
  if(cur){const f=_galAllSwatches().find(o=>o.hex.toLowerCase()===cur.toLowerCase());selName=f?f.name:cur;}
  const mk=(hex,name,isWhite)=>{
    const b=document.createElement('button');
    b.className='gal-sw'+((isWhite?!cur:cur===hex)?' cur':'');
    b.style.background=hex;
    b.title=name;                                  // hover tooltip = readable name
    b.onmouseenter=()=>_galSetSwName(name);
    b.onmouseleave=()=>_galSetSwName(selName);
    b.onfocus=()=>_galSetSwName(name);
    b.onclick=()=>window.galApplyColour(isWhite?null:hex);
    return b;
  };
  // Default (off-white) as its own labelled row, then each palette as a titled section —
  // one panel, no tabs (Olympus, Pastel, …extensible).
  const section=(label,btns)=>{
    const h=document.createElement('div');h.className='gal-pal-head';h.textContent=label;sw.appendChild(h);
    const row=document.createElement('div');row.className='gal-sw-row';
    btns.forEach(b=>row.appendChild(b));sw.appendChild(row);
  };
  section('Default',[mk(CAD_YARN,'Off-white (default)',true)]);
  _galPaletteSections().forEach(sec=>section(sec.label,sec.items.map(o=>mk(o.hex,o.name,false))));
  _galSetSwName(selName);
}
window.galApplyColour=function(hex){
  if(hex)galThreadColors[galActiveFam]=hex; else delete galThreadColors[galActiveFam];
  galBuildColourUI(); render(step);
};
window.galResetColours=function(){galThreadColors={}; galBuildColourUI(); render(step);};

// One popover open at a time. `keep` = the id being toggled (others close).
function _galClosePops(keep){
  const pops=[['galColorPop','galColBtn','🎨 Color'],['galAdv','galAdvBtn','⚙ Advanced']];
  pops.forEach(([id,btn,label])=>{
    if(id===keep)return;
    const el=document.getElementById(id);if(el)el.style.display='none';
    const b=document.getElementById(btn);if(b)b.textContent=label+' ▾';
  });
}
// ── Colour popover: Thread + Fabric tabs (each with a little preview image) ──
let galColorMode='thread';
window.galToggleColor=function(){
  const c=document.getElementById('galColorPop');
  const open=c.style.display!=='none';
  _galClosePops(open?null:'galColorPop');
  c.style.display=open?'none':'block';
  document.getElementById('galColBtn').textContent=open?'🎨 Color ▾':'🎨 Color ▴';
  if(!open)galColorTab(galColorMode);
};
window.galColorTab=function(mode){
  galColorMode=mode;
  const fab=document.getElementById('galColorFabric'),thr=document.getElementById('galColorThread');
  if(fab)fab.style.display=mode==='fabric'?'block':'none';
  if(thr)thr.style.display=mode==='thread'?'block':'none';
  document.getElementById('galTabFabric')&&document.getElementById('galTabFabric').classList.toggle('on',mode==='fabric');
  document.getElementById('galTabThread')&&document.getElementById('galTabThread').classList.toggle('on',mode==='thread');
  if(mode==='fabric')galBuildFabricUI(); else galBuildColourUI();
  galBuildColorTabs();
};
// Fabric tab preview icon = the current cloth texture. (The Thread tab uses the 🧵 spool
// emoji, set in the HTML.)
function galBuildColorTabs(){
  const fc=document.getElementById('galTabFabricIco');
  if(fc){const x=fc.getContext('2d');x.clearRect(0,0,20,20);_drawFabric(x,galFabric,20,20);}
}
window.galToggleAdv=function(){
  const a=document.getElementById('galAdv');
  const open=a.style.display!=='none';
  _galClosePops(open?null:'galAdv');
  a.style.display=open?'none':'flex';
  document.getElementById('galAdvBtn').textContent=open?'⚙ Advanced ▾':'⚙ Advanced ▴';
};
// ── Fabric picker (gallery viewer) ──────────────────────────────────────────
function _galSetFabName(txt){const el=document.getElementById('galFabName');if(el)el.textContent=txt;}
function galBuildFabricUI(){
  const wrap=document.getElementById('galFabSwatches');if(!wrap)return;
  wrap.innerHTML='';
  const curFab=_fabricById(galFabric);
  SASHIKO_FABRICS.forEach(f=>{
    const b=document.createElement('button');
    b.className='gal-fab-sw'+(f.id===galFabric?' cur':'');
    b.style.background='linear-gradient(135deg,'+f.g0+','+f.g1+')';
    b.title=f.name;
    b.onmouseenter=()=>_galSetFabName(f.name);
    b.onmouseleave=()=>_galSetFabName(curFab.name);
    b.onfocus=()=>_galSetFabName(f.name);
    b.onclick=()=>window.galSetFabric(f.id);
    wrap.appendChild(b);
  });
  _galSetFabName(curFab.name);
}
window.galSetFabric=function(id){
  galFabric=id;                        // fabric is just the background; stitch geometry unchanged
  galBuildFabricUI(); galBuildColorTabs(); render(step);
};
window.galSetStitchLen=function(v){galStitchLen=parseInt(v)||8;const e=document.getElementById('galStitchLenVal');if(e)e.textContent=galStitchLen;_galStitchCache=null;render(step);};
// +/− stepper (replaces the old slider); clamp 3–40, default 8.
window.galStepStitchLen=function(dir){window.galSetStitchLen(Math.max(3,Math.min(40,galStitchLen+dir)));};
window.galSetStitchRatio=function(v){galStitchRatio=v;_galStitchCache=null;render(step);};
// Overlay: Off | Grid | Draft — one compact segmented control (mutually exclusive).
window.galSetOverlay=function(mode){
  galStitchGrid=(mode==='grid'); galDraft=(mode==='draft');
  _galSyncOverlaySeg();
  render(step);
};
function _galSyncOverlaySeg(){
  const mode=galStitchGrid?'grid':(galDraft?'draft':'none');
  [['galOvNone','none'],['galOvGrid','grid'],['galOvDraft','draft']].forEach(([id,m])=>{
    const b=document.getElementById(id);if(b)b.classList.toggle('on',m===mode);
  });
}
window.galSetHubScale=function(v){
  _starHubScale=parseFloat(v)/100;
  const lbl=s=>s&&(s.textContent=_starHubScale.toFixed(2)+'×');
  lbl(document.getElementById('galHubScaleVal'));
  lbl(document.getElementById('cadHubScaleVal'));
  const cs=document.getElementById('cadHubScale');if(cs)cs.value=v;
  _galStitchCache=null;_cadStitchCache=null;render(step);
};

function renderExp(step){
  const ch=EXP_canvasH||SIZE;
  if(galStitch){
    const fabLight=_fabricById(galFabric).light;
    _drawFabric(ctx,galFabric,SIZE,ch);
    // Draft mode brings the grid along (drafting needs both), so either toggle shows the dot grid.
    const overlay=galStitchGrid||galDraft;
    if(overlay)_cadDrawStitchGrid(ctx,{tf:{g2s:EXP_g2s,ox:0,oy:0,sc:1},ur:EXP_uRange,vr:EXP_vRange},true,fabLight);
    if(!EXP_path.length)return;
    const sc=_galStitchScene(),N=sc.stitches.length;
    const shown=step>=TOTAL?N:Math.round(N*step/Math.max(1,TOTAL));
    // In grid mode the threads are toned down so the white dot grid reads as the foreground.
    // In draft mode the stitches render normally (full opacity) under the drafting guides.
    if(galStitchGrid)ctx.globalAlpha=0.4;
    for(let i=0;i<shown;i++){const s=sc.stitches[i];if(_famToggles[s.fam]===false)continue;_cadDrawStitch(ctx,s,sc.w,galThreadColors[s.fam]||_galDefaultYarn());}
    if(galStitchGrid)ctx.globalAlpha=1;
    if(galDraft)_galDrawDraft();
    return;
  }
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
  _animSource=document.getElementById('myPatsView').classList.contains('open')?'sandbox':'gallery';
  history.replaceState(null,'','#'+pat.id);
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
};

// ── Gallery routing test switcher (view-only — never saved to the pattern) ──
// '' = the pattern's saved routingMode through its pinned engine; any other value
// re-routes the CURRENT view with that mode on the current engine, so every mode
// (including the v2 ones) can be compared per pattern without touching its data.
let _galRouteOverride='';
window.galSetRouting=function(v){
  _galRouteOverride=v||'';
  if(curPat&&curPat.type==='exp')_reloadExpWithTiles();
};
function _galResetRouting(){
  _galRouteOverride='';
  const sel=document.getElementById('galRoutingSel');if(sel)sel.value='';
}
// Stitch path for the gallery viewer: saved mode via the pinned engine, or the
// test-switcher mode on the current engine while the override is active.
function _expPathForView(effPat){
  const segs=tiledSegsFor(effPat);
  if(!_galRouteOverride)return expPathFor(segs,effPat);
  return buildExpPath(segs,effPat.famOrder,_galRouteOverride,{iso:effPat.gridType==='isometric'});
}

// Re-run the router on the current custom pattern (no redraw needed when routing rules change).
window.rerouteExp=function rerouteExp(){
  if(!curPat||curPat.type!=='exp')return;
  setupExpCanvas(curPat);
  EXP_path=_expPathForView(curPat);
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
      <div class="pcard-name">${esc(_displayName(pat.name||'Custom'))}</div>
      <span class="pcard-badge">${pat.traditional?'Traditional · ':''}${pat.gridType==='isometric'?'Iso':'Sq'} · ${new Set((pat.families||[]).filter(f=>f>=0)).size||1} passes</span>
    </div>
    <div class="like-row" data-id="${esc(pat.id)}"></div>
    <button class="exp-pub-btn" title="Publish to gallery (admin)" onclick="event.stopPropagation();publishExpPattern('${esc(pat.id)}')">📌</button>
    <button class="exp-edit-btn" title="Edit" onclick="event.stopPropagation();_cadSource='sandbox';editExpPattern('${esc(pat.id)}')">✎</button>
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
}

function rebuildExpGallery(){rebuildMyPatsView();}

// Admin: promote a sandbox pattern into the public gallery (published:true).
window.publishExpPattern=async function(id){
  if(!await _ensureAdmin())return;
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(!pat)return;
  if(!confirm('Publish "'+(pat.name||'Custom')+'" to the main gallery?'))return;
  pat.published=true;
  // Lock this pattern to the routing engine it was authored under (its stitching never
  // changes when the routing algorithm is updated later).
  if(pat.routingEngine===undefined)pat.routingEngine=ROUTING_ENGINE_CURRENT;
  _saveLocal();
  await _pushToFirestore(pat);
  buildGallery();           // it now appears in the gallery…
  rebuildMyPatsView();      // …and leaves the sandbox list
  alert('Published to the gallery.');
};

window.removeExpPattern=async function removeExpPattern(id){
  if(!confirm('Permanently delete this pattern? This cannot be undone.'))return;
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(!pat)return;
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
window.likePattern=function(id){
  if(!id)return;
  const likes=_getLikes();if(!likes[id])likes[id]={up:0,down:0};
  const uid=_getUserId();const prev=likes[id][uid];
  if(prev===1){delete likes[id][uid];likes[id].up--;}
  else{if(prev===-1)likes[id].down--;likes[id].up++;likes[id][uid]=1;}
  _saveLikes(likes);_updatePatternLikes(id);renderLikeButtons(id);
};
function _updatePatternLikes(id){
  const likes=_getLikes();const l=likes[id]||{up:0,down:0};
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(pat){pat.likes=l.up;pat.dislikes=l.down;_saveLocal();}
}
function renderLikeButtons(id){
  const likes=_getLikes();const l=likes[id]||{up:0,down:0};
  const uid=_getUserId();const myVote=likes[id]?.[uid];
  const hearts=l.up;
  document.querySelectorAll(`.like-row[data-id="${id}"]`).forEach(el=>{
    const isDetail=el.id==='likeRow';
    if(isDetail){
      // Detail view: clickable heart + remix button
      el.innerHTML=
        `<button class="like-btn${myVote===1?' liked':''}" onclick="likePattern('${id}')" title="${myVote===1?'Remove heart':'Give a heart'}">♥ ${hearts||0}</button>`+
        `<button class="like-btn remix" onclick="remixPattern('${id}')" title="Remix">↗ Remix</button>`;
    }else{
      // Gallery card: read-only heart count
      el.innerHTML=hearts>0?`<span class="like-heart-count">♥ ${hearts}</span>`:'';
    }
  });
}
window.remixPattern=function(id){
  _cadSource='sandbox';
  const pat=EXP_PATTERNS.find(p=>p.id===id);
  if(!pat)return;
  if(!confirm('Create a remix of "'+(pat.name||'Custom')+'"?'))return;
  cadLines=pat.lines.map(l=>{
    if(l.arc&&l.center!==undefined){
      return{arc:true,center:[l.center[0],l.center[1]],r:l.r,a1:l.a1,a2:l.a2,start:[l.start[0],l.start[1]],end:[l.end[0],l.end[1]]};
    }
    return{start:[l.start[0],l.start[1]],end:[l.end[0],l.end[1]],...(l.arc?{arc:true}:{})};
  });
  cadHistory=[];cadEditId=null;cadRemixOf=pat.id;
  cadTool='draw';cadArcState=0;cadArcCenter=null;cadArcStart=null;
  document.getElementById('cadGridType').value=pat.gridType||'isometric';
  const maxDim=Math.max(pat.bbox.maxU,pat.bbox.maxV);
  const macroVal=Math.max(2,Math.min(6,Math.ceil(maxDim/CAD_MICRO)));
  document.getElementById('cadGridSize').value=macroVal;
  document.getElementById('cadPatSize').value=pat.patMacro||3;
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
  _cadSource='sandbox';
  document.getElementById('galleryView').style.display='none';
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('animView').classList.remove('open');
  document.getElementById('cadView').classList.add('open');
  cadEditId=null;cadRemixOf=null;cadIsPublished=false;cadLines=[];cadFamilies=[];cadHistory=[];cadManualBBox=null;
  cadBBoxRotated=false;cadFamOrder=[];cadFamSel=-1;cadFamsLocked=false;cadTraditional=false;cadRoutingMode='default';cadThumbCells=0;
  document.getElementById('cadRoutingMode').value='default';
  document.getElementById('cadPatName').value='';   // empty → "Unnamed pattern" placeholder shows
  document.getElementById('cadTraditional').checked=false;
  cadInited=false;
  cadInit();
  window.scrollTo({top:0,behavior:'smooth'});
};
window.showGalleryFromCAD=function(){
  if(_tpOn)_stopTilePlay();   // stop + reset the tile-play animation when leaving the editor
  cadEditId=null;
  document.getElementById('cadView').classList.remove('open');
  if(_cadSource==='gallery'){
    document.getElementById('galleryView').style.display='block';
    buildGallery();
  }else{
    document.getElementById('myPatsView').classList.add('open');
    rebuildMyPatsView();
  }
};
