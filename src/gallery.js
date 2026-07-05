// ── Gallery ────────────────────────────────────────────────────────────────
// Display a pattern name as "Japanese / English": "Romaji (English)" and
// "Romaji · English" both become "Romaji / English". Names without a Japanese/English
// pairing (e.g. "Cat", "Wave 1") are left untouched. Display-only — the stored name is unchanged.
function _displayName(n){
  if(!n)return n;
  let s=String(n).trim();
  s=s.replace(/\s*\(([^)]+)\)/,' / $1');        // "Romaji (English)" -> "Romaji / English"
  s=s.replace(/\s*[·•]\s*/g,' / ');             // middle-dot separators -> slash
  s=s.replace(/\s{2,}/g,' ').trim();            // tidy whitespace
  return s;
}
window._displayName=_displayName;
let activeFilters=new Set([0]);
let _galleryDirty=false;
function buildGallery(){
  const grid=document.getElementById('pgrid');grid.innerHTML='';
  const deleted=_getDeleted();
  PATTERNS.forEach(pat=>{
    if(deleted.includes(pat.id))return;
    // Hitomezashi Generator hidden for now — NOT removed; the generator engine + preset
    // UI are kept intact and may be re-enabled in a future version (just drop this guard).
    if(pat.id==='generator')return;
    const card=document.createElement('button');
    card.className='pcard'+(pat.type==='generator'?' gen-card':'');
    card.dataset.id=pat.id;card.dataset.p=pat.passes.length;
    const thumb=document.createElement('canvas');
    thumb.style.cssText='width:100%;aspect-ratio:1;border-radius:7px;display:block';
    card.appendChild(thumb);
    const name=document.createElement('div');name.className='pcard-name';name.textContent=pat.name;
    const jp=document.createElement('div');jp.className='pcard-jp';jp.textContent=pat.jp;
    card.append(name,jp);
    // Delete button for all cards
    const delBtn=document.createElement('button');
    delBtn.className='exp-del-btn';delBtn.title='Delete (admin)';delBtn.textContent='✕';
    delBtn.onclick=e=>{e.stopPropagation();deletePattern(pat.id);};
    card.appendChild(delBtn);
    card.onclick=()=>openPattern(pat);
    grid.appendChild(card);
    setTimeout(()=>renderThumb(thumb,pat),0);
  });
  // Published custom patterns — gallery order = admin-curated `order` (drag-to-reorder),
  // falling back to newest-first for any pattern without an explicit order yet.
  EXP_PATTERNS.filter(p=>p.published&&!deleted.includes(p.id)).slice().sort(_expGalleryOrder).forEach(pat=>{
    const card=document.createElement('button');
    card.className='pcard exp-card';
    // data-p = number of stitch families (passes), derived automatically.
    card.dataset.id=pat.id;card.dataset.p=String(expFamilyCount(pat));card.dataset.type='exp';
    // Admin drag-to-reorder (draggable only while signed in as admin; drop persists the order).
    card.draggable=document.body.classList.contains('is-admin');
    card.addEventListener('dragstart',e=>{if(!document.body.classList.contains('is-admin')){e.preventDefault();return;}_dragId=pat.id;e.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    card.addEventListener('dragover',e=>{if(document.body.classList.contains('is-admin')&&_dragId&&_dragId!==pat.id){e.preventDefault();card.classList.add('drag-over');}});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('drag-over');_onExpDrop(pat.id);_dragId=null;});
    const thumb=document.createElement('canvas');
    thumb.style.cssText='width:100%;aspect-ratio:1;border-radius:7px;display:block';
    card.appendChild(thumb);
    const editBtn=document.createElement('button');
    editBtn.className='exp-edit-btn';editBtn.title='Edit (admin)';editBtn.textContent='✎';
    editBtn.onclick=e=>{e.stopPropagation();_cadSource='gallery';editExpPattern(pat);};
    card.appendChild(editBtn);
    const delBtn2=document.createElement('button');
    delBtn2.className='exp-del-btn';delBtn2.title='Delete (admin)';delBtn2.textContent='✕';
    delBtn2.onclick=e=>{e.stopPropagation();deletePattern(pat.id);};
    card.appendChild(delBtn2);
    const name=document.createElement('div');name.className='pcard-name';name.textContent=_displayName(pat.name||'Custom');
    card.append(name);
    if(pat.community&&pat.communityName){
      const by=document.createElement('div');by.className='pcard-by';by.textContent='by '+pat.communityName;
      card.append(by);
    }
    // Like row for exp cards
    const likeRow=document.createElement('div');
    likeRow.className='like-row';likeRow.dataset.id=pat.id;
    card.appendChild(likeRow);
    setTimeout(()=>renderLikeButtons(pat.id),0);
    card.onclick=()=>openExpPattern(pat);
    grid.appendChild(card);
    setTimeout(()=>renderThumb(thumb,pat),0);
  });
}
// ── Admin gallery ordering ───────────────────────────────────────────────────
// `pat.order` is an admin-set sort key (lower = earlier). Patterns without one sort
// last, newest-first (the previous default). Drag-to-reorder (admin) renumbers the
// published set and persists each changed pattern to Firestore.
let _dragId=null;
function _expGalleryOrder(a,b){
  const ao=(typeof a.order==='number')?a.order:1e9, bo=(typeof b.order==='number')?b.order:1e9;
  if(ao!==bo)return ao-bo;
  return (b.createdAt||0)-(a.createdAt||0);
}
function _expOrderedIds(){
  const del=_getDeleted();
  return EXP_PATTERNS.filter(p=>p.published&&!del.includes(p.id)).slice().sort(_expGalleryOrder).map(p=>p.id);
}
function _onExpDrop(targetId){
  if(!document.body.classList.contains('is-admin')||!_dragId||_dragId===targetId)return;
  const ids=_expOrderedIds();
  const from=ids.indexOf(_dragId);
  if(from<0)return;
  ids.splice(from,1);
  const to=ids.indexOf(targetId);
  ids.splice(to<0?ids.length:to,0,_dragId);   // insert dragged just before the drop target
  let changed=false;
  ids.forEach((id,i)=>{
    const pat=EXP_PATTERNS.find(p=>p.id===id);
    if(pat&&pat.order!==i){pat.order=i;changed=true;if(_firebaseReady)_pushToFirestore(pat);}
  });
  if(changed){_saveLocal();buildGallery();filterGallery();}
}
window.filterGallery=function(){
  const q=document.getElementById('searchInput').value.toLowerCase().trim();
  let vis=0;
  document.querySelectorAll('#pgrid .pcard').forEach(card=>{
    const id=card.dataset.id, type=card.dataset.type||'';
    let pat=PATTERNS.find(p=>p.id===id);
    if(!pat)pat=EXP_PATTERNS.find(p=>p.id===id);
    if(!pat)return;
    let mp=true;
    if(!activeFilters.has(0)){
      mp=false;
      if(activeFilters.has('hm') && type==='generator') mp=true;
      if(activeFilters.has('trad') && pat.traditional===true) mp=true;
      if(activeFilters.has('community') && pat.community===true) mp=true;
      if(activeFilters.has('curved') && window.patIsCurved(pat)) mp=true;
      if(activeFilters.has('angular') && type==='exp' && !window.patIsCurved(pat)) mp=true;
    }
    let mq=!q;
    if(q){
      if(type==='exp'){
        mq=(pat.name||'').toLowerCase().includes(q)||pat.id.includes(q)||(pat.communityName||'').toLowerCase().includes(q)||
          (window.patIsCurved(pat)?'curved round':'angular geometric straight').includes(q);
      }else{
        mq=pat.name.toLowerCase().includes(q)||pat.jp.includes(q)||pat.en.toLowerCase().includes(q)||pat.id.includes(q)||
          (type==='generator'&&'koshi kaki persimmon snowflake hitomezashi lattice'.includes(q))||
          (type==='polyline'&&'yamagata mountain continuous'.includes(q));
      }
    }
    const show=mp&&mq;card.classList.toggle('hidden',!show);if(show)vis++;
  });
  let nr=document.getElementById('noResults');
  if(!nr){nr=document.createElement('div');nr.id='noResults';nr.className='no-results';nr.textContent='No patterns found.';document.getElementById('pgrid').appendChild(nr);}
  nr.style.display=vis===0?'block':'none';
};
const _filtKey=v=>(v==='hm'||v==='trad'||v==='community'||v==='curved'||v==='angular')?v:(v==='0'?0:parseInt(v));
window.setFilter=function(btn){
  const f=btn.dataset.f;
  const fv=_filtKey(f);
  if(fv===0){
    activeFilters=new Set([0]);
  }else{
    activeFilters.delete(0);
    if(activeFilters.has(fv))activeFilters.delete(fv);
    else activeFilters.add(fv);
    if(activeFilters.size===0)activeFilters.add(0);
  }
  document.querySelectorAll('.filt').forEach(b=>{
    const v=_filtKey(b.dataset.f);
    b.classList.toggle('on',activeFilters.has(v));
  });
  filterGallery();
};
window.setFilterSelect=function(v){
  const fv=_filtKey(v);
  activeFilters=fv===0?new Set([0]):new Set([fv]);
  filterGallery();
};

// ── View switching ─────────────────────────────────────────────────────────
function openPattern(pat){
  _animSource='gallery';
  history.replaceState(null,'','#'+pat.id);
  document.getElementById('galleryView').style.display='none';
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
}
window.showGallery=function(){
  if(_animSource==='sandbox'){
    document.getElementById('animView').classList.remove('open');
    document.getElementById('myPatsView').classList.add('open');
    rebuildMyPatsView();
  }else{
    if(playing)pause();
    document.getElementById('animView').classList.remove('open');
    document.getElementById('galleryView').style.display='block';
    if(_galleryDirty){_galleryDirty=false;buildGallery();}
  }
  history.replaceState(null,'',location.pathname);
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getCss(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function hexA(hex,a){hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');const n=parseInt(hex,16);return`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}
// ── Delete pattern (admin) ──────────────────────────────────────────────────
function _getDeleted(){try{return JSON.parse(localStorage.getItem('sashiko_deleted')||'[]');}catch(e){return[];}}
window.deletePattern=async function(id){
  // Gallery deletions are admin-only (Google sign-in, enforced by Firestore rules).
  if(!await _ensureAdmin())return;
  if(!confirm('Permanently delete "'+id+'"? This cannot be undone.'))return;
  const pat=PATTERNS.find(p=>p.id===id);
  if(pat){
    const del=_getDeleted();if(!del.includes(id))del.push(id);
    localStorage.setItem('sashiko_deleted',JSON.stringify(del));
  }else{
    removeExpPattern(id);
  }
  buildGallery();
};
