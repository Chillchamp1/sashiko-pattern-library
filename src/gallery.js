// ── Gallery ────────────────────────────────────────────────────────────────
let activeFilters=new Set([0]);
let _galleryCells=0;
let _galleryDirty=false;
window.galleryZoomStep=function(dir){
  _galleryCells=Math.max(0,_galleryCells+dir);
  const lbl=document.getElementById('galleryZoomVal');
  if(lbl)lbl.textContent=_galleryCells>0?_galleryCells+'\u2009cells':'auto';
  const av=document.getElementById('animView');
  if(av.classList.contains('open')){
    _zoom=_galleryCells>0?3/_galleryCells:1;
    _setupCanvasSize(SIZE,SIZE); render(step);
    _galleryDirty=true;
  }else{
    buildGallery();
  }
};
function buildGallery(){
  const grid=document.getElementById('pgrid');grid.innerHTML='';
  const deleted=_getDeleted();
  PATTERNS.forEach(pat=>{
    if(deleted.includes(pat.id))return;
    const card=document.createElement('button');
    card.className='pcard'+(pat.type==='generator'?' gen-card':'');
    card.dataset.id=pat.id;card.dataset.p=pat.passes.length;
    const thumb=document.createElement('canvas');
    thumb.style.cssText='width:100%;aspect-ratio:1;border-radius:7px;display:block';
    card.appendChild(thumb);
    const name=document.createElement('div');name.className='pcard-name';name.textContent=pat.name;
    const jp=document.createElement('div');jp.className='pcard-jp';jp.textContent=pat.jp;
    const badge=document.createElement('div');
    if(pat.type==='generator'){badge.className='pcard-badge gen';badge.textContent='Kōshi · Kaki no Hana · Snowflake';}
    else if(pat.type==='polyline'){badge.className='pcard-badge';badge.textContent='Continuous';}
    else{badge.className='pcard-badge';badge.textContent=pat.passes.length+' passes';}
    card.append(name,jp,badge);
    // Delete button for all cards
    const delBtn=document.createElement('button');
    delBtn.className='exp-del-btn';delBtn.title='Delete (admin)';delBtn.textContent='✕';
    delBtn.onclick=e=>{e.stopPropagation();deletePattern(pat.id);};
    card.appendChild(delBtn);
    card.onclick=()=>openPattern(pat);
    grid.appendChild(card);
    setTimeout(()=>renderThumb(thumb,pat),0);
  });
  // Published custom patterns
  EXP_PATTERNS.filter(p=>p.published&&!deleted.includes(p.id)).forEach(pat=>{
    const card=document.createElement('button');
    card.className='pcard exp-card';
    card.dataset.id=pat.id;card.dataset.p='0';card.dataset.type='exp';
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
    const name=document.createElement('div');name.className='pcard-name';name.textContent=pat.name||'Custom';
    const badge=document.createElement('div');badge.className='pcard-badge';
    const usedFams=new Set((pat.families||[]).filter(f=>f>=0));
    const nPasses=usedFams.size||1;
    const tLabel=pat.traditional?'Traditional · ':'';
    badge.textContent=tLabel+(pat.gridType==='isometric'?'Isometric':'Square')+' · '+nPasses+' pass'+(nPasses!==1?'es':'');
    card.append(name,badge);
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
      if(activeFilters.has(2) && parseInt(card.dataset.p)===2) mp=true;
      if(activeFilters.has(4) && parseInt(card.dataset.p)===4) mp=true;
    }
    let mq=!q;
    if(q){
      if(type==='exp'){
        mq=(pat.name||'').toLowerCase().includes(q)||pat.id.includes(q);
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
window.setFilter=function(btn){
  const f=btn.dataset.f;
  const fv=f==='hm'?'hm':(f==='trad'?'trad':(f==='0'?0:parseInt(f)));
  if(fv===0){
    activeFilters=new Set([0]);
  }else{
    activeFilters.delete(0);
    if(activeFilters.has(fv))activeFilters.delete(fv);
    else activeFilters.add(fv);
    if(activeFilters.size===0)activeFilters.add(0);
  }
  document.querySelectorAll('.filt').forEach(b=>{
    const v=b.dataset.f==='hm'?'hm':(b.dataset.f==='trad'?'trad':(b.dataset.f==='0'?0:parseInt(b.dataset.f)));
    b.classList.toggle('on',activeFilters.has(v));
  });
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
window.deletePattern=function(id){
  const pw=prompt('Admin password:');
  if(pw!=='111'){alert('Wrong password');return;}
  if(!confirm('Delete "'+id+'"?'))return;
  const pat=PATTERNS.find(p=>p.id===id);
  if(pat){
    const del=_getDeleted();if(!del.includes(id))del.push(id);
    localStorage.setItem('sashiko_deleted',JSON.stringify(del));
  }else{
    removeExpPattern(id);
  }
  buildGallery();
};
