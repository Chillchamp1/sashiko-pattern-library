// ── Generator ──────────────────────────────────────────────────────────────
const HM_GUT=30;   // px gutter holding the line toggles (matches CSS .hm-frame.hm-on)

function applyGeneratorInternal(){
  buildHMcore(GEN_rowBits, GEN_colBits);
  TOTAL=HM_fronts.length; PASSES=[];
}

// Fill the explicit bit arrays from a preset (or the snowflake order).
function loadPreset(key){
  GEN_preset=key;
  let seq,N;
  if(key==='snowflake'){ seq=snowSeq(2); N=GEN_snowGrid; }
  else { const p=GEN_PRESETS[key]; seq=p.seq; N=p.n; }
  GEN_n=N;
  const b=seqToBits(seq,N);
  GEN_rowBits=[...b]; GEN_colBits=[...b];
}

function resizeBits(a,N){ const o=a.slice(0,N); while(o.length<N) o.push(0); return o; }
// Keep first ceil(N/2) bits, mirror the rest so the pattern stays symmetric.
function resizeBitsSymmetric(a,N){
  const half=Math.ceil(N/2);
  const src=Array.from({length:half},(_,i)=>i<a.length?a[i]:0);
  return Array.from({length:N},(_,i)=>i<half?src[i]:src[N-1-i]);
}

// Change grid size: re-tile if a preset is active, else preserve existing bits.
function setGridN(N){
  GEN_n=N;
  if(GEN_preset && GEN_preset!=='snowflake'){
    const b=seqToBits(GEN_PRESETS[GEN_preset].seq,N);
    GEN_rowBits=[...b]; GEN_colBits=[...b];
  } else {
    GEN_rowBits=resizeBitsSymmetric(GEN_rowBits,N);
    GEN_colBits=resizeBitsSymmetric(GEN_colBits,N);
  }
}

// Single entry point: rebuild engine + UI after any state change.
function refreshGen(showFull){
  if(!curPat||curPat.type!=='generator') return;
  applyGeneratorInternal();        // sets HM_CELL + TOTAL
  highlightPreset(GEN_preset);
  updateGenUI();                   // panels, hm-on, snowflake submenu (reads TOTAL)
  buildLineToggles();              // uses HM_CELL + the bit arrays
  syncGrid();
  setGenTitle();
  buildJumpBar();
  if(playing)pause();
  if(showFull) step=TOTAL;
  if(step>TOTAL) step=TOTAL;
  render(step);
}
function applyGenerator(){ refreshGen(true); }   // legacy alias

function setGenTitle(){
  const sub=GEN_preset?GEN_PRESETS[GEN_preset].label:'Custom';
  document.getElementById('animTitle').innerHTML=`Hitomezashi<span class="jp">一目刺し · ${sub}</span>`;
  let tip;
  if(GEN_preset) tip=GEN_PRESETS[GEN_preset].tip;
  else tip=`Custom — each green toggle (left) flips a row's horizontal stitches, each blue toggle (top) flips a column's vertical stitches. ${effectiveN()}×${effectiveN()} grid.`;
  document.getElementById('animTip').textContent=tip;
}

// Build the per-row / per-column toggle buttons around the live preview.
function buildLineToggles(){
  const colC=document.getElementById('hmColToggles');
  const rowC=document.getElementById('hmRowToggles');
  colC.innerHTML=''; rowC.innerHTML='';
  if(GEN_preset==='snowflake') return;   // fractal — hand-toggling N=68 lines is not useful
  const N=GEN_rowBits.length;
  const half=Math.ceil(N/2);                        // show only first half; click mirrors the other half
  const bs=Math.max(11,Math.min(22,HM_CELL-3));    // toggle size, shrinks as grid grows
  const showDigit=bs>=14, fs=Math.round(bs*0.55);
  for(let i=0;i<half;i++){           // top gutter: column phases → vertical (blue) stitches
    const b=document.createElement('button');
    b.className='hm-tog v'+(GEN_colBits[i]?' on':'');
    b.style.width=b.style.height=bs+'px';
    b.style.left=(shx(i)-bs/2)+'px';
    b.style.top=((HM_GUT-bs)/2)+'px';
    if(showDigit){b.textContent=GEN_colBits[i];b.style.fontSize=fs+'px';}
    const mi=N-1-i;
    b.title='Column '+(i+1)+(i!==mi?' (mirrors col '+(mi+1)+')':'');
    b.onclick=()=>{GEN_colBits[i]^=1;if(i!==mi)GEN_colBits[mi]=GEN_colBits[i];GEN_preset=null;refreshGen(true);};
    colC.appendChild(b);
  }
  for(let j=0;j<half;j++){           // left gutter: row phases → horizontal (green) stitches
    const b=document.createElement('button');
    b.className='hm-tog h'+(GEN_rowBits[j]?' on':'');
    b.style.width=b.style.height=bs+'px';
    b.style.top=(shy(j)-bs/2)+'px';
    b.style.left=((HM_GUT-bs)/2)+'px';
    if(showDigit){b.textContent=GEN_rowBits[j];b.style.fontSize=fs+'px';}
    const mj=N-1-j;
    b.title='Row '+(j+1)+(j!==mj?' (mirrors row '+(mj+1)+')':'');
    b.onclick=()=>{GEN_rowBits[j]^=1;if(j!==mj)GEN_rowBits[mj]=GEN_rowBits[j];GEN_preset=null;refreshGen(true);};
    rowC.appendChild(b);
  }
}

function highlightPreset(key){
  document.querySelectorAll('#genPresets [data-preset]').forEach(b=>b.classList.toggle('on',b.dataset.preset===key));
}

// Show hint vs snowflake info; hm-on shows the line toggles; update slider label/range.
function updateGenUI(){
  const isSnow=GEN_preset==='snowflake';
  document.getElementById('genHint').style.display=isSnow?'none':'block';
  document.getElementById('genSnowInfo').style.display=isSnow?'block':'none';
  document.getElementById('hmFrame').classList.toggle('hm-on',!isSnow);
  if(isSnow) syncSnowUI();
}

function syncSnowUI(){
  const N=GEN_rowBits.length;
  document.getElementById('snowDesc').textContent=
    `${N}×${N} grid · ${TOTAL} stitches · Binary-Fibonacci palindrome → 4-fold symmetry.`;
}

function syncGrid(){
  const slider=document.getElementById('genGrid');
  const isSnow=GEN_preset==='snowflake';
  if(isSnow){
    slider.min=8; slider.max=32; slider.value=GEN_snowGrid;
    document.getElementById('genGridVal').textContent=GEN_snowGrid;
    document.getElementById('genSliderLabel').textContent='Size';
  } else {
    slider.min=6; slider.max=20; slider.value=GEN_n;
    document.getElementById('genGridVal').textContent=GEN_n;
    document.getElementById('genSliderLabel').textContent='Grid';
  }
}

function showGenUI(show){
  document.getElementById('genUI').style.display=show?'flex':'none';
  document.getElementById('genSlider').style.display=show?'block':'none';
  if(!show){
    document.getElementById('hmFrame').classList.remove('hm-on');
    document.getElementById('hmColToggles').innerHTML='';
    document.getElementById('hmRowToggles').innerHTML='';
  }
}

function initGenUI(){
  loadPreset(GEN_preset);   // initialise the bit arrays from the default preset (Kaki)
  // Named preset buttons
  document.querySelectorAll('#genPresets [data-preset]').forEach(btn=>{
    btn.onclick=()=>{ loadPreset(btn.dataset.preset); refreshGen(true); };
  });
  // Universal size slider — grid size for regular presets, snowflake size for snowflake
  document.getElementById('genGrid').oninput=e=>{
    const v=parseInt(e.target.value);
    document.getElementById('genGridVal').textContent=v;
    if(GEN_preset==='snowflake'){ GEN_snowGrid=v; loadPreset('snowflake'); }
    else setGridN(v);
    refreshGen(true);
  };
}

// ── Playback ───────────────────────────────────────────────────────────────
const bPlay=document.getElementById('bPlay');
function setPlayIcon(pl){
  bPlay.querySelector('span').textContent=pl?'Pause':'Play';
  bPlay.querySelector('svg').innerHTML=pl?'<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>':'<path d="M8 5v14l11-7z"/>';
}
function play(){if(step>=TOTAL)step=0;playing=true;setPlayIcon(true);last=0;raf=requestAnimationFrame(tick);}
function pause(){playing=false;setPlayIcon(false);cancelAnimationFrame(raf);}
function tick(t){
  if(!last)last=t;
  if(t-last>=TICK_MS){if(step>=TOTAL){pause();return;}step++;render(step);last=t;}
  raf=requestAnimationFrame(tick);
}
bPlay.onclick=()=>playing?pause():play();
document.getElementById('bReset').onclick=()=>{pause();step=0;render(step);};
document.getElementById('bBack').onclick=()=>{pause();step=Math.max(0,step-1);render(step);};
document.getElementById('bFwd').onclick=()=>{pause();step=Math.min(TOTAL,step+1);render(step);};
document.getElementById('bAll').onclick=()=>{pause();step=TOTAL;render(step);};
document.getElementById('bSpeed').onclick=()=>{
  TICK_MS=TICK_MS===80?40:80;
  const b=document.getElementById('bSpeed');
  b.textContent=TICK_MS===80?'🐢 Slow':'⚡ Fast';
};
window.addEventListener('keydown',e=>{
  if(!document.getElementById('animView').classList.contains('open'))return;
  if(e.code==='Space'){e.preventDefault();playing?pause():play();}
  else if(e.code==='ArrowRight'){pause();step=Math.min(TOTAL,step+1);render(step);}
  else if(e.code==='ArrowLeft'){pause();step=Math.max(0,step-1);render(step);}
});

// ── Thumbnail ──────────────────────────────────────────────────────────────
function renderThumb(canvas,pat){
  if(pat.type==='generator'){renderHMThumb(canvas,[0,0,1,0,1],11);return;}
  if(pat.type==='hitomezashi'){renderHMThumb(canvas,pat.seq,pat.thumbN||11);return;}
  if(pat.type==='polyline'){renderPLThumb(canvas,pat);return;}
  const TDPR=Math.min(window.devicePixelRatio||1,2);
  const TN=7,TPAD=4,TS=64,TG=(TS-2*TPAD)/(TN-1);
  canvas.width=TS*TDPR;canvas.height=TS*TDPR;
  canvas.style.width='64px';canvas.style.height='64px';
  const tc=canvas.getContext('2d');tc.scale(TDPR,TDPR);
  tc.fillStyle='#1a3a5c';tc.fillRect(0,0,TS,TS);
  tc.strokeStyle='rgba(220,235,255,0.07)';tc.lineWidth=0.5;
  for(let i=0;i<TN;i++){tc.beginPath();tc.moveTo(TPAD+i*TG,TPAD);tc.lineTo(TPAD+i*TG,TPAD+(TN-1)*TG);tc.stroke();}
  for(let j=0;j<TN;j++){tc.beginPath();tc.moveTo(TPAD,TPAD+j*TG);tc.lineTo(TPAD+(TN-1)*TG,TPAD+j*TG);tc.stroke();}
  const TP=buildPasses(pat.passes,TN);
  for(const p of TP){if(!p.order)continue;for(const[i,j]of p.order){
    const px=TPAD+i*TG,py=TPAD+(TN-1-j)*TG,s=segPx(px,py,p.dir,TG,pat.armScale);
    tc.strokeStyle=PHASE_COLORS[p.dir][getPhase(i,j,p.dir)];tc.lineWidth=1.3;tc.lineCap='round';
    tc.beginPath();tc.moveTo(s[0],s[1]);tc.lineTo(s[2],s[3]);tc.stroke();
  }}
}

