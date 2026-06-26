// Loads the REAL routing code from src/ into Node — no copy-paste, so it can never
// drift from what actually ships. Runs the relevant src files inside a tiny sandbox
// with DOM stubs (the routing pipeline is pure geometry; the only top-level DOM call
// is engine-star.js grabbing the <canvas>, which the stub satisfies).
//
// Returns the routing functions used by the animation/thumbnail pipeline.
//
// Plain Node, no deps — works under Claude Code, opencode/deepseek, or a human shell.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');

// Files needed for the exp (custom-pattern) routing pipeline, in dependency order.
// engine-star.js defines SIZE/PAD; experimental.js holds the whole router.
const FILES = ['engine-star.js', 'experimental.js'];

function makeSandbox() {
  // A fake canvas context / DOM node: every property is a no-op function or chains.
  const noop = () => {};
  const fakeCtx = new Proxy({}, { get: () => noop });
  const fakeEl = {
    getContext: () => fakeCtx,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    addEventListener: noop, removeEventListener: noop,
    appendChild: noop, removeChild: noop, setAttribute: noop,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
    width: 372, height: 372, value: '', textContent: '',
  };
  const documentStub = {
    getElementById: () => fakeEl,
    querySelector: () => fakeEl,
    querySelectorAll: () => [],
    createElement: () => fakeEl,
    addEventListener: noop,
  };
  const sandbox = {
    document: documentStub,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop,
    setTimeout: () => 0,
    clearTimeout: noop,
    console, Math, Date, JSON,
    Uint8Array, Int8Array, Int32Array, Uint32Array, Float64Array, Float32Array,
    isFinite, isNaN, parseInt, parseFloat, Number, Array, Object, String, Map, Set, Symbol,
    __captured: null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

let _cache = null;

function loadRouting() {
  if (_cache) return _cache;
  const sandbox = makeSandbox();
  vm.createContext(sandbox);

  let code = '';
  for (const f of FILES) code += '\n;// ===== ' + f + ' =====\n' + fs.readFileSync(path.join(SRC, f), 'utf8');

  // Hand the const/function-declared routing symbols back out (they're in lexical scope here).
  code += `
;__captured = {
  buildExpPath, genTiledSegs, computeExpLayout, detectSymmetryFamilies,
  buildContourStrokes, buildStrokesForFamily, orderStrokesFamily,
  extractArcStrokes, filterVisiblePath, matchVertex,
  SIZE: (typeof SIZE !== 'undefined' ? SIZE : null),
};`;

  vm.runInContext(code, sandbox, { filename: 'src-routing-bundle.js' });
  if (!sandbox.__captured) throw new Error('Routing capture failed — did a src/ function get renamed?');
  _cache = sandbox.__captured;
  return _cache;
}

module.exports = { loadRouting };

// Self-test: `node tools/routing/load-routing.js`
if (require.main === module) {
  const R = loadRouting();
  const present = Object.entries(R).filter(([, v]) => typeof v === 'function').map(([k]) => k);
  console.log('Loaded routing functions:', present.join(', '));
  console.log('SIZE =', R.SIZE);
}
