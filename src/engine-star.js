// ── Canvas setup ───────────────────────────────────────────────────────────
const N=7, G=50, PAD=36, SIZE=(N-1)*G+2*PAD;
const DPR=Math.min(window.devicePixelRatio||1,2);
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
cv.width=SIZE*DPR; cv.height=SIZE*DPR;
cv.style.width=SIZE+'px'; cv.style.height=SIZE+'px';
ctx.scale(DPR,DPR);
const sx=i=>PAD+i*G, sy=j=>PAD+(N-1-j)*G;

// Hitomezashi grid — dynamic (reassigned by buildHitomezashi)
let HM_N=12, HM_CELL=(SIZE-2*PAD)/(HM_N-1);
const shx=i=>PAD+i*HM_CELL, shy=j=>PAD+j*HM_CELL;

// ── Direction / colour metadata ────────────────────────────────────────────
const DIRS={
  V:{label:'Vertical',  glyph:'↑',col:'--accent-v'},
  H:{label:'Horizontal',glyph:'→',col:'--accent-h'},
  D1:{label:'Diagonal', glyph:'⟋',col:'--accent-d1'},
  D2:{label:'Diagonal', glyph:'⟍',col:'--accent-d2'}
};
const PHASE_COLORS={
  V:['#cde0f4','#9cbcd8'], H:['#c4ebd6','#88c4a4'],
  D1:['#f5e0c8','#e0b890'], D2:['#ddd0f2','#b0a0e0']
};
function getPhase(i,j,dir){
  if(dir==='V')return i%2; if(dir==='H')return j%2;
  if(dir==='D1')return((i-j)%2+2)%2; return(i+j)%2;
}
function segPx(px,py,dir,g,arm){
  const h=0.30*g*arm,dd=h/Math.SQRT2;
  if(dir==='V')return[px,py-h,px,py+h]; if(dir==='H')return[px-h,py,px+h,py];
  if(dir==='D1')return[px-dd,py+dd,px+dd,py-dd]; return[px-dd,py-dd,px+dd,py+dd];
}

// ── Build star-pattern passes (brute-force jump minimisation) ──────────────
function buildPasses(pl,n){
  const raw=[];
  function addDir(dir,orderFn){let o=[];orderFn(o);raw.push({dir,order:o,count:o.length});}
  if(pl.includes('V'))addDir('V',o=>{for(let i=0;i<n;i++){let r=[];for(let j=0;j<n;j++)r.push([i,j]);if(i%2)r.reverse();o.push(...r);}});
  if(pl.includes('H'))addDir('H',o=>{for(let j=0;j<n;j++){let r=[];for(let i=0;i<n;i++)r.push([i,j]);if(j%2)r.reverse();o.push(...r);}});
  if(pl.includes('D1'))addDir('D1',o=>{let p=0;for(let c=-(n-1);c<=n-1;c++){let r=[];for(let i=0;i<n;i++){let j=i-c;if(j>=0&&j<n)r.push([i,j]);}if(!r.length)continue;if(p++%2)r.reverse();o.push(...r);}});
  if(pl.includes('D2'))addDir('D2',o=>{let p=0;for(let s=0;s<=2*(n-1);s++){let r=[];for(let i=0;i<n;i++){let j=s-i;if(j>=0&&j<n)r.push([i,j]);}if(!r.length)continue;if(p++%2)r.reverse();o.push(...r);}});
  // Try all permutations × start-direction combos, pick minimum inter-pass jump
  function perm(a){if(!a.length)return[[]];const r=[];for(let i=0;i<a.length;i++){const c=a[i],rem=[...a.slice(0,i),...a.slice(i+1)];perm(rem).forEach(p=>r.push([c,...p]));}return r;}
  const perms=perm(raw); let best=raw,bestD=Infinity;
  for(const pm of perms){for(let mask=0;mask<(1<<pm.length);mask++){
    let d=0,last=null,cand=pm.map((p,i)=>({...p,order:mask&(1<<i)?[...p.order].reverse():[...p.order]}));
    cand.forEach(p=>{if(last){const[i,j]=p.order[0],[li,lj]=last;d+=(i-li)**2+(j-lj)**2;}last=p.order[p.order.length-1];});
    if(d<bestD){bestD=d;best=cand;}
  }}
  return best;
}

// ══════════════════════════════════════════════════════════════════════════
