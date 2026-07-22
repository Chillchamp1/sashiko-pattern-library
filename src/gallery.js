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
let activeFilters=new Set([0]);   // legacy (kept for setFilter compat); tabs now drive category
let _galTab='traditional';         // active register-card tab: 'traditional' | 'community' | 'sandbox'
// Checkbox filters within a tab, all on by default (= show everything). Shape (angled/curved)
// applies on every tab; technique (sashiko/embroidery) only on the Community tab, where the
// checkboxes are visible — traditional patterns are all sashiko by definition.
let _galFilters={sashiko:true,embroidery:true,angular:true,curved:true};
let _galleryDirty=false;
// A published custom pattern belongs to "Community" only when explicitly flagged; everything else
// published (traditional-flagged or unflagged) lives under the standard "Traditional" tab.
function _expTradList(deleted){return EXP_PATTERNS.filter(p=>p.published&&!p.community&&!deleted.includes(p.id)).slice().sort(_expGalleryOrder);}
function _expCommunityList(deleted){return EXP_PATTERNS.filter(p=>p.published&&p.community&&!deleted.includes(p.id)).slice().sort(_expGalleryOrder);}
function _expSandboxList(deleted){return EXP_PATTERNS.filter(p=>!p.published&&!deleted.includes(p.id)).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));}
// Build one custom-pattern card. `sandbox` cards get a Publish button and aren't drag-reorderable;
// published cards are admin-drag-reorderable within the gallery.
function _buildExpCard(pat,sandbox){
  const card=document.createElement('button');
  card.className='pcard exp-card';
  card.dataset.id=pat.id;card.dataset.p=String(expFamilyCount(pat));card.dataset.type='exp';
  if(!sandbox){
    // Admin drag-to-reorder (draggable only while signed in as admin; drop persists the order).
    card.draggable=document.body.classList.contains('is-admin');
    card.addEventListener('dragstart',e=>{if(!document.body.classList.contains('is-admin')){e.preventDefault();return;}_dragId=pat.id;e.dataTransfer.effectAllowed='move';card.classList.add('dragging');});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    card.addEventListener('dragover',e=>{if(document.body.classList.contains('is-admin')&&_dragId&&_dragId!==pat.id){e.preventDefault();card.classList.add('drag-over');}});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('drag-over');_onExpDrop(pat.id);_dragId=null;});
  }
  const thumb=document.createElement('canvas');
  thumb.style.cssText='width:100%;aspect-ratio:1;border-radius:7px;display:block';
  card.appendChild(thumb);
  if(sandbox){
    const pubBtn=document.createElement('button');
    pubBtn.className='exp-pub-btn';pubBtn.title='Publish to gallery (admin)';pubBtn.textContent='📌';
    pubBtn.onclick=e=>{e.stopPropagation();publishExpPattern(pat.id);};
    card.appendChild(pubBtn);
  }
  const editBtn=document.createElement('button');
  editBtn.className='exp-edit-btn';editBtn.title='Edit';editBtn.textContent='✎';
  editBtn.onclick=e=>{e.stopPropagation();_cadSource=sandbox?'sandbox':'gallery';editExpPattern(pat);};
  card.appendChild(editBtn);
  const delBtn=document.createElement('button');
  delBtn.className='exp-del-btn';delBtn.title='Delete';delBtn.textContent='✕';
  delBtn.onclick=e=>{e.stopPropagation();sandbox?removeExpPattern(pat.id):deletePattern(pat.id);};
  card.appendChild(delBtn);
  const name=document.createElement('div');name.className='pcard-name';name.textContent=_displayName(pat.name||'Custom');
  card.append(name);
  if((pat.community||pat.traditional)&&pat.communityName){
    // Community drawings credit the author ("by …"); traditional patterns credit the
    // person who added them to the library ("added by: …").
    const by=document.createElement('div');by.className='pcard-by';
    by.textContent=(pat.community?'by ':'added by: ')+pat.communityName;
    card.append(by);
  }
  const likeRow=document.createElement('div');
  likeRow.className='like-row';likeRow.dataset.id=pat.id;
  card.appendChild(likeRow);
  setTimeout(()=>renderLikeButtons(pat.id),0);
  setTimeout(()=>{if(window._renderCommentBadge)_renderCommentBadge(pat.id);},0);
  card.onclick=()=>openExpPattern(pat);
  setTimeout(()=>renderThumb(thumb,pat),0);
  return card;
}
function buildGallery(){
  const grid=document.getElementById('pgrid');if(!grid)return;grid.innerHTML='';
  const deleted=_getDeleted();
  // Register-card counts (all tabs).
  const setCount=(id,n)=>{const e=document.getElementById(id);if(e)e.textContent=String(n);};
  const nBuiltIn=PATTERNS.filter(p=>p.id!=='generator'&&!deleted.includes(p.id)).length;
  setCount('galCountTrad',nBuiltIn+_expTradList(deleted).length);
  setCount('galCountCommunity',_expCommunityList(deleted).length);
  setCount('galCountSandbox',_expSandboxList(deleted).length);
  if(_galTab==='traditional'){
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
      const delBtn=document.createElement('button');
      delBtn.className='exp-del-btn';delBtn.title='Delete (admin)';delBtn.textContent='✕';
      delBtn.onclick=e=>{e.stopPropagation();deletePattern(pat.id);};
      card.appendChild(delBtn);
      card.onclick=()=>openPattern(pat);
      grid.appendChild(card);
      setTimeout(()=>renderThumb(thumb,pat),0);
    });
    _expTradList(deleted).forEach(pat=>grid.appendChild(_buildExpCard(pat,false)));
  }else if(_galTab==='community'){
    _expCommunityList(deleted).forEach(pat=>grid.appendChild(_buildExpCard(pat,false)));
  }else{ // sandbox
    _expSandboxList(deleted).forEach(pat=>grid.appendChild(_buildExpCard(pat,true)));
  }
  const empty=grid.children.length===0;
  if(empty&&_galTab==='sandbox'){
    grid.innerHTML='<p class="no-results" style="display:block;margin:24px auto">No saved patterns yet — hit <b>+ New Pattern</b> to draw one in the CAD editor.</p>';
  }
}
// Switch register-card tab. Traditional is the standard/default.
window.galSetTab=function(tab){
  _galTab=(tab==='community'||tab==='sandbox')?tab:'traditional';
  ['traditional','community','sandbox'].forEach(t=>{
    const b=document.getElementById(t==='traditional'?'galTabTrad':(t==='community'?'galTabCommunity':'galTabSandbox'));
    if(b)b.classList.toggle('on',t===_galTab);
  });
  const nb=document.getElementById('galNewBtn');if(nb)nb.style.display=_galTab==='sandbox'?'':'none';
  // Technique filters (Sashiko/Embroidery) only exist on the Community tab; shape is on every tab.
  const tech=_galTab==='community';
  ['fcSashiko','fcEmbroidery'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display=tech?'':'none';});
  buildGallery();filterGallery();
};
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
// Search + shape filter, applied within the active register-card tab (category is handled by the
// tab / buildGallery, so this only narrows the already-rendered cards).
window.filterGallery=function(){
  const si=document.getElementById('searchInput');
  const q=si?si.value.toLowerCase().trim():'';
  let vis=0;
  document.querySelectorAll('#pgrid .pcard').forEach(card=>{
    const id=card.dataset.id, type=card.dataset.type||'';
    let pat=PATTERNS.find(p=>p.id===id);
    if(!pat)pat=EXP_PATTERNS.find(p=>p.id===id);
    if(!pat)return;
    const curved=window.patIsCurved(pat);
    let ms=curved?_galFilters.curved:_galFilters.angular;
    // Technique filter only narrows the Community tab (its checkboxes are hidden elsewhere).
    if(_galTab==='community')ms=ms&&(pat.embroidery?_galFilters.embroidery:_galFilters.sashiko);
    let mq=!q;
    if(q){
      if(type==='exp'){
        mq=(pat.name||'').toLowerCase().includes(q)||pat.id.includes(q)||(pat.communityName||'').toLowerCase().includes(q)||
          (curved?'curved round':'angular geometric straight').includes(q)||
          (!!pat.embroidery&&'embroidery'.includes(q));
      }else{
        mq=pat.name.toLowerCase().includes(q)||pat.jp.includes(q)||pat.en.toLowerCase().includes(q)||pat.id.includes(q)||
          (type==='generator'&&'koshi kaki persimmon snowflake hitomezashi lattice'.includes(q))||
          (type==='polyline'&&'yamagata mountain continuous'.includes(q));
      }
    }
    const show=ms&&mq;card.classList.toggle('hidden',!show);if(show)vis++;
  });
  const grid=document.getElementById('pgrid');
  let nr=document.getElementById('noResults');
  if(!nr&&grid){nr=document.createElement('div');nr.id='noResults';nr.className='no-results';nr.textContent='No patterns found.';grid.appendChild(nr);}
  // Don't show the "no results" line over the sandbox empty-state message.
  if(nr)nr.style.display=(vis===0&&grid&&!grid.querySelector('.no-results:not(#noResults)'))?'block':'none';
};
// Read the toolbar filter checkboxes into state (multiple can be on at once; all on = default).
window.setGalFilters=function(){
  const rd=id=>{const e=document.getElementById(id);return e?e.checked:true;};
  _galFilters={sashiko:rd('filtSashiko'),embroidery:rd('filtEmbroidery'),angular:rd('filtAngular'),curved:rd('filtCurved')};
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
  if(playing)pause();
  document.getElementById('animView').classList.remove('open');
  // Sandbox is now a register-card tab in the main gallery — a pattern opened from it returns to
  // the gallery on that tab (galSetTab rebuilds), everything else to whatever tab was active.
  if(_animSource==='sandbox')_galTab='sandbox';
  document.getElementById('galleryView').style.display='block';
  galSetTab(_galTab);
  _galleryDirty=false;
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
