// ── Experimental patterns (localStorage) ───────────────────────────────────
let EXP_PATTERNS=[];
function loadExpPatterns(){try{EXP_PATTERNS=JSON.parse(localStorage.getItem('sashiko_exp')||'[]');}catch(e){EXP_PATTERNS=[];}}
function saveExpPatterns(){localStorage.setItem('sashiko_exp',JSON.stringify(EXP_PATTERNS));}

function renderExpPattern(pat){
  if(!pat||!pat.lines)return;
  const x=ctx;
  x.fillStyle='#1a3a5c';x.fillRect(0,0,SIZE,SIZE);
  const COS30=Math.cos(Math.PI/6),SIN30=Math.sin(Math.PI/6);
  const bbox=pat.bbox;
  const dU=Math.max(bbox.maxU-bbox.minU,4),dV=Math.max(bbox.maxV-bbox.minV,4);
  const isIso=pat.gridType==='isometric';
  let tileSize;
  if(isIso){tileSize=Math.min(SIZE/(dU*2*COS30+4),SIZE/(dV*2*SIN30+4))*1.5;}
  else{tileSize=Math.min(SIZE/(dU+4),SIZE/(dV+4))*1.5;}
  const ox=SIZE/2,oy=SIZE/2;
  function g2s(u,v){
    if(isIso)return{x:ox+(u-v)*tileSize*COS30,y:oy+(u+v)*tileSize*SIN30};
    return{x:ox+u*tileSize,y:oy+v*tileSize};
  }
  x.lineWidth=1.5;x.lineCap='round';x.strokeStyle='#9cbcd8';
  const over=Math.ceil(SIZE/Math.max(tileSize*dU,tileSize*dV,1))+2;
  for(let ou=-over;ou<=over;ou++){for(let ov=-over;ov<=over;ov++){
    pat.lines.forEach(l=>{
      const u1=l.start[0]-bbox.minU+ou*dU,v1=l.start[1]-bbox.minV+ov*dV;
      const u2=l.end[0]-bbox.minU+ou*dU,v2=l.end[1]-bbox.minV+ov*dV;
      const p1=g2s(u1,v1),p2=g2s(u2,v2);
      x.beginPath();x.moveTo(p1.x,p1.y);x.lineTo(p2.x,p2.y);x.stroke();
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

// ── My Patterns view ────────────────────────────────────────────────────────
function expCardHTML(pat){
  return`<div class="pcard exp-card" data-id="${pat.id}" onclick="openExpPattern('${pat.id}')">
    <canvas class="pcard-thumb" width="120" height="120" data-expid="${pat.id}"></canvas>
    <div class="pcard-body">
      <div class="pcard-name">${pat.name||'Custom'}</div>
      <span class="pcard-badge">${pat.gridType==='isometric'?'Isometric':'Square'}</span>
    </div>
    <button class="exp-del-btn" title="Delete" onclick="event.stopPropagation();removeExpPattern('${pat.id}')">✕</button>
  </div>`;
}

function rebuildMyPatsView(){
  const grid=document.getElementById('myPatsGrid');
  if(!grid)return;
  grid.innerHTML='';
  if(!EXP_PATTERNS.length){
    grid.innerHTML='<p class="no-results" style="display:block;margin:24px auto">No saved patterns yet — use the CAD Editor to draw one.</p>';
    return;
  }
  EXP_PATTERNS.forEach(pat=>{
    grid.insertAdjacentHTML('beforeend',expCardHTML(pat));
    const thumb=grid.querySelector(`[data-expid="${pat.id}"]`);
    if(thumb&&pat.thumbnail){const img=new Image();img.onload=()=>{const tc=thumb.getContext('2d');tc.drawImage(img,0,0,120,120);};img.src=pat.thumbnail;}
  });
}

function rebuildExpGallery(){rebuildMyPatsView();}  // alias for cadSaveToLibrary

window.removeExpPattern=function removeExpPattern(id){
  EXP_PATTERNS=EXP_PATTERNS.filter(p=>p.id!==id);
  saveExpPatterns();
  rebuildMyPatsView();
};

window.showMyPatterns=function(){
  document.getElementById('galleryView').style.display='none';
  document.getElementById('cadView').classList.remove('open');
  document.getElementById('myPatsView').classList.add('open');
  rebuildMyPatsView();
  window.scrollTo({top:0,behavior:'smooth'});
};
window.showGalleryFromMyPats=function(){
  document.getElementById('myPatsView').classList.remove('open');
  document.getElementById('galleryView').style.display='block';
};

// ── CAD view switching ──────────────────────────────────────────────────────
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
