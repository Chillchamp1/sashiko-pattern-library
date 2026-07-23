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
  // Cards credit contributors only in the Community tab ("by …"). Traditional
  // patterns keep their "added by: …" for the DETAIL view (render.js animTitle) —
  // the gallery grid stays focused on the patterns themselves.
  if(pat.community&&pat.communityName){
    const by=document.createElement('div');by.className='pcard-by';by.textContent='by '+pat.communityName;
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
// One card for a built-in (hard-coded) traditional pattern. Carries the same
// read-only engagement badges as custom cards (💬 comments + ⬇ downloads via the
// shared like-row renderer; hearts stay custom-pattern-only — built-ins have no
// heart UI, so their ♥ count is always 0).
function _buildBuiltinCard(pat){
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
  const likeRow=document.createElement('div');
  likeRow.className='like-row';likeRow.dataset.id=pat.id;
  card.appendChild(likeRow);
  setTimeout(()=>renderLikeButtons(pat.id),0);
  setTimeout(()=>{if(window._renderCommentBadge)_renderCommentBadge(pat.id);},0);
  card.onclick=()=>openPattern(pat);
  setTimeout(()=>renderThumb(thumb,pat),0);
  return card;
}
// Traditional tab = built-ins + published traditional customs in ONE
// engagement-ranked list (same _engagement score as the community tab: hearts,
// comments, downloads, view bonus). The sort is STABLE by score only, so every
// all-zero group keeps the classic layout: built-ins in canonical PATTERNS order
// first, then customs in admin drag order (_expTradList pre-sorts those via
// _expGalleryOrder). The Hitomezashi Generator stays hidden (NOT removed; drop the
// guard to re-enable it).
function _tradEntries(deleted){
  const entries=[
    ...PATTERNS.filter(p=>p.id!=='generator'&&!deleted.includes(p.id)).map(pat=>({pat,builtin:true})),
    ..._expTradList(deleted).map(pat=>({pat,builtin:false}))
  ];
  entries.sort((a,b)=>_engagement(b.pat)-_engagement(a.pat));
  return entries;
}
function buildGallery(){
  const grid=document.getElementById('pgrid');if(!grid)return;grid.innerHTML='';
  const deleted=_getDeleted();
  _lastExpOrderKey=_galOrderKey();   // baseline for _resortGalleryIfChanged
  // Register-card counts (all tabs).
  const setCount=(id,n)=>{const e=document.getElementById(id);if(e)e.textContent=String(n);};
  const nBuiltIn=PATTERNS.filter(p=>p.id!=='generator'&&!deleted.includes(p.id)).length;
  setCount('galCountTrad',nBuiltIn+_expTradList(deleted).length);
  setCount('galCountCommunity',_expCommunityList(deleted).length);
  setCount('galCountSandbox',_expSandboxList(deleted).length);
  if(_galTab==='traditional'){
    _tradEntries(deleted).forEach(e=>grid.appendChild(e.builtin?_buildBuiltinCard(e.pat):_buildExpCard(e.pat,false)));
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
// ── Gallery ordering: engagement first, then admin curation ──────────────────
// Engagement score = 3×hearts + 1×comments (counts cached in experimental.js
// _likeCounts/_commentCounts, prefetched by _refreshEngagement): equal hearts →
// comments break the tie, and a commented pattern outranks a silent one even with
// zero hearts, but a heart (3 pts) outweighs up to two comments. Patterns people
// engage with bubble to the top automatically.
// Tiebreak (incl. the all-zero majority): `pat.order`, the admin-set drag key
// (lower = earlier); patterns without one sort last, newest-first.
let _dragId=null;
function _engagement(p){
  const h=(typeof _likeCounts!=='undefined'&&p.id in _likeCounts)?_likeCounts[p.id]:0;
  const c=(typeof _commentCounts!=='undefined'&&_commentCounts[p.id])||0;
  // View bonus from PATTERN_CLICKS (30-day unique pattern opens, refreshed weekly by
  // .github/workflows/weekly.yml → pattern-clicks.json → build inject). Log-scaled and
  // capped so a much-viewed pattern lower in the list catches up with the top cards
  // (whose click advantage saturates), but raw views can never outrank real
  // hearts/comments long-term: 8 views ≈ 1 comment, ~56 views ≈ 1 heart, cap 4 pts.
  const v=(typeof PATTERN_CLICKS!=='undefined'&&PATTERN_CLICKS[p.id])||0;
  const vb=Math.min(4,Math.floor(Math.log2(v/8+1)));
  // New-publication boost (Reddit-style, for exposure): a freshly published pattern
  // starts with 8 bonus points — enough to open near the top — fading LINEARLY to 0
  // over 10 days, so new work gets seen without permanently outranking genuinely
  // loved patterns. Needs pat.publishedAt (stamped since 2026-07-23); older
  // publications have no stamp → no retroactive boost.
  const age=p.publishedAt?(Date.now()-p.publishedAt)/86400000:Infinity;
  const fresh=age<10?8*(1-age/10):0;
  // Download bonus: d = UNIQUE downloaders (patterns/{id}/downloads/*, one doc per
  // auth uid, cached in _dlCounts) — repeat downloads by the same person never
  // inflate it. Worth = 2·√d: the FIRST downloader scores 2 pts, between a comment
  // (1) and a heart (3) — downloading a sheet signals intent to actually stitch the
  // pattern, a stronger signal than a comment but a less deliberate endorsement
  // than a heart. Growth is SUB-linear (4 downloads = 4 pts, 9 = 6, 25 = 10) since
  // downloading is the default action for anyone using a pattern: hearts keep
  // growing 3/each linearly, so a merely much-downloaded pattern can't drown out
  // genuinely loved ones long-term.
  const d=(typeof _dlCounts!=='undefined'&&_dlCounts[p.id])||0;
  const dl=2*Math.sqrt(d);
  return 3*h+c+vb+fresh+dl;
}
function _expGalleryOrder(a,b){
  const ea=_engagement(a), eb=_engagement(b);
  if(ea!==eb)return eb-ea;
  const ao=(typeof a.order==='number')?a.order:1e9, bo=(typeof b.order==='number')?b.order:1e9;
  if(ao!==bo)return ao-bo;
  return (b.createdAt||0)-(a.createdAt||0);
}
// Called when async heart/comment/download counts arrive (or a heart is toggled):
// rebuild the gallery only if the counts actually changed the visible order. The key
// covers BOTH ranked surfaces — the merged traditional tab (built-ins + customs) and
// the published-custom ordering (community tab) — so either re-sorts on change.
let _lastExpOrderKey='';
function _galOrderKey(){
  return _tradEntries(_getDeleted()).map(e=>e.pat.id).join(',')+'|'+_expOrderedIds().join(',');
}
function _resortGalleryIfChanged(){
  const key=_galOrderKey();
  if(key===_lastExpOrderKey)return;
  _lastExpOrderKey=key;
  if(_galTab!=='sandbox'){buildGallery();filterGallery();}
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
