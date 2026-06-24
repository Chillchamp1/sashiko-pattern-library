// ── Pattern registry ───────────────────────────────────────────────────────
// Kōshi and Kaki no Hana are Hitomezashi — they live in the generator as named presets.
// Yarai/Yoko-Yarai/Mittsu-zashi removed: not findable as traditional named patterns.
const PATTERNS = [
  {
    id:'generator', name:'Hitomezashi', jp:'一目刺し', en:'Generator',
    type:'generator', passes:['H','V'], armScale:1.0,
  },
];

// ── Generator presets ──────────────────────────────────────────────────────
// Kōshi and Kaki no Hana are the classic named Hitomezashi patterns. A preset
// just FILLS the per-row / per-column phase bits — once applied the bits are
// explicit and the user can toggle any of them (see buildLineToggles).
const GEN_PRESETS = {
  koshi:{
    seq:[0], n:12, label:'Kōshi',
    tip:'Kōshi (格子) — the simplest Hitomezashi pattern. Same start-phase in every row and column produces a regular square lattice. Classic named pattern.',
  },
  kaki:{
    seq:[0,0,1,0,1], n:12, label:'Kaki no Hana',
    tip:'Kaki no Hana (柿の花) — Persimmon Blossom. Phase sequence [0,0,1,0,1] (period 5) generates concentric stepped diamonds. Classic named pattern extracted from book diagrams.',
  },
  snowflake:{
    label:'Snowflake',  // seq + n are computed from the order (see snowSeq)
    tip:'Fibonacci Snowflake — the phase sequence is a binary-Fibonacci string mirrored into a palindrome with 4-fold rotational symmetry. Use the Order buttons to change depth. (Monnerot-Dumaine, 2009)',
  },
};

// Fibonacci-snowflake phase sequence. Half = binary Fibonacci word of length
// {1:2, 2:8, 3:34}; full sequence = half + reverse(half) (palindrome → symmetry).
const SNOW_LEN={1:2, 2:8, 3:34};
function snowHalf(ord){
  const L=SNOW_LEN[ord]||8; let prev='0',cur='01';
  while(cur.length<L){ const next=cur+prev; prev=cur; cur=next; }
  return cur.slice(0,L).split('').map(Number);
}
function snowSeq(ord){ const h=snowHalf(ord); return [...h, ...[...h].reverse()]; }

// Mutable generator state — explicit per-row and per-column start-phase bits.
// rowBits[j] sets the phase of the horizontal stitches in row j (green).
// colBits[i] sets the phase of the vertical stitches in column i (blue).
let GEN_rowBits=[], GEN_colBits=[], GEN_n=12, GEN_preset='kaki', GEN_snowGrid=16;
function effectiveN(){ return GEN_rowBits.length; }

