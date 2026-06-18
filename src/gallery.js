// ── Gallery ────────────────────────────────────────────────────────────────
let activeFilter=0;
function buildGallery(){
  const grid=document.getElementById('pgrid');grid.innerHTML='';
  const newBtn=document.createElement('button');
  newBtn.className='pcard new-pattern-card';
  newBtn.innerHTML='<div class="pcard-new-icon">＋</div><div class="pcard-name">New Pattern</div><div class="pcard-badge gen">CAD Editor</div>';
  newBtn.onclick=()=>showCAD();
  grid.appendChild(newBtn);
  PATTERNS.forEach(pat=>{
    const card=document.createElement('button');
    card.className='pcard'+(pat.type==='generator'?' gen-card':'');
    card.dataset.id=pat.id;card.dataset.p=pat.passes.length;
    const thumb=document.createElement('canvas');
    thumb.style.cssText='width:64px;height:64px;border-radius:7px';
    card.appendChild(thumb);
    const name=document.createElement('div');name.className='pcard-name';name.textContent=pat.name;
    const jp=document.createElement('div');jp.className='pcard-jp';jp.textContent=pat.jp;
    const badge=document.createElement('div');
    if(pat.type==='generator'){badge.className='pcard-badge gen';badge.textContent='Kōshi · Kaki no Hana · Snowflake';}
    else if(pat.type==='polyline'){badge.className='pcard-badge';badge.textContent='Continuous';}
    else{badge.className='pcard-badge';badge.textContent=pat.passes.length+' passes';}
    card.append(name,jp,badge);
    card.onclick=()=>openPattern(pat);
    grid.appendChild(card);
    requestAnimationFrame(()=>renderThumb(thumb,pat));
  });
}
window.filterGallery=function(){
  const q=document.getElementById('searchInput').value.toLowerCase().trim();
  let vis=0;
  document.querySelectorAll('.pcard').forEach(card=>{
    if(card.classList.contains('new-pattern-card')){
      card.classList.toggle('hidden',activeFilter==='exp');
      return;
    }
    const pat=PATTERNS.find(p=>p.id===card.dataset.id);
    let mp;
    if(activeFilter===0)mp=true;
    else if(activeFilter==='hm')mp=pat&&pat.type==='generator';
    else if(activeFilter==='exp')mp=card.dataset.exp==='1';
    else mp=pat&&parseInt(card.dataset.p)===activeFilter;
    const mq=!q||(pat&&(pat.name.toLowerCase().includes(q)||pat.jp.includes(q)||pat.en.toLowerCase().includes(q)||pat.id.includes(q)||
      (pat.type==='generator'&&('koshi kaki persimmon snowflake hitomezashi lattice'.includes(q)))||
      (pat.type==='polyline'&&('yamagata mountain continuous'.includes(q)))))||
      (card.dataset.exp==='1'&&('experimental custom draw'.includes(q)));
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
  activeFilter=f==='hm'?'hm':f==='exp'?'exp':(f==='0'?0:parseInt(f));
  filterGallery();
};

// ── View switching ─────────────────────────────────────────────────────────
function openPattern(pat){
  document.getElementById('galleryView').style.display='none';
  document.getElementById('animView').classList.add('open');
  loadPattern(pat);
  window.scrollTo({top:0,behavior:'smooth'});
}
window.showGallery=function(){
  if(playing)pause();
  document.getElementById('animView').classList.remove('open');
  document.getElementById('galleryView').style.display='block';
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getCss(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function hexA(hex,a){hex=hex.replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');const n=parseInt(hex,16);return`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}

