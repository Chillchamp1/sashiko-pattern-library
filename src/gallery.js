// ── Gallery ────────────────────────────────────────────────────────────────
let activeFilter=0;
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
    card.onclick=()=>{window.open('#'+pat.id,'_blank');};
    grid.appendChild(card);
    setTimeout(()=>renderThumb(thumb,pat),0);
  });
  // Published custom patterns
  EXP_PATTERNS.filter(p=>p.published).forEach(pat=>{
    const card=document.createElement('button');
    card.className='pcard exp-card';
    card.dataset.id=pat.id;card.dataset.p='0';card.dataset.type='exp';
    const thumb=document.createElement('canvas');
    thumb.style.cssText='width:100%;aspect-ratio:1;border-radius:7px;display:block';
    card.appendChild(thumb);
    const editBtn=document.createElement('button');
    editBtn.className='exp-edit-btn';editBtn.title='Edit (admin)';editBtn.textContent='✎';
    editBtn.onclick=e=>{e.stopPropagation();editExpPattern(pat);};
    card.appendChild(editBtn);
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
    let mp;
    if(activeFilter===0)mp=true;
    else if(activeFilter==='hm')mp=type==='generator';
    else if(activeFilter==='trad')mp=pat.traditional===true;
    else if(type==='exp')mp=false;
    else mp=parseInt(card.dataset.p)===activeFilter;
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
  document.querySelectorAll('.filt').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const f=btn.dataset.f;
  activeFilter=f==='hm'?'hm':(f==='trad'?'trad':(f==='0'?0:parseInt(f)));
  filterGallery();
};

// ── View switching ─────────────────────────────────────────────────────────
function openPattern(pat){
  history.replaceState(null,'','#'+pat.id);
  document.getElementById('galleryView').style.display='none';
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
}
window.showGallery=function(){
  if(isEXP){
    document.getElementById('animView').classList.remove('open');
    document.getElementById('myPatsView').classList.add('open');
    rebuildMyPatsView();
  }else{
    if(playing)pause();
    document.getElementById('animView').classList.remove('open');
    document.getElementById('galleryView').style.display='block';
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
