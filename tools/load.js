// ---------------------------------------------------------------------------
// index.html の <script> を取り出し、THREE と DOM をスタブした環境で評価して
// 内部関数を返す。テスト側にロジックを書き写さないための土台。
//
//   const game = require("./load.js").load();          // 音声なし
//   const game = require("./load.js").load({ audio });  // 音声あり
// ---------------------------------------------------------------------------
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = path.join(__dirname, "..", "index.html");

// ---- THREE スタブ ---------------------------------------------------------
class V2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  lerp(v, a) { return this.set(this.x + (v.x - this.x) * a, this.y + (v.y - this.y) * a, this.z + (v.z - this.z) * a); }
}
class Eul {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.order = "XYZ"; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Obj {
  constructor() {
    this.position = new V3(); this.rotation = new Eul(); this.scale = new V3(1, 1, 1);
    this.visible = true; this.children = []; this.userData = {}; this.frustumCulled = true;
  }
  add(o) { this.children.push(o); return this; }
  rotateY() {} rotateX() {} rotateZ() {} lookAt() {} updateProjectionMatrix() {}
}
class Mat {
  constructor(o = {}) { Object.assign(this, o); this.color = { setHex() {} }; this.emissive = { setHex() {} }; }
}
class Geo {
  constructor() { this.attributes = {}; }
  rotateX() { return this; } translate() { return this; }
}
function makeTHREE(fixedDelta) {
  return {
    Vector2: V2, Vector3: V3,
    Color: class { constructor(h) { this.h = h; } getHex() { return this.h || 0; } },
    Group: Obj, Object3D: Obj,
    Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    Points: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    Sprite: class extends Obj { constructor(m) { super(); this.material = m; } },
    WebGLRenderer: class { constructor() { this.domElement = {}; } setPixelRatio() {} setSize() {} render() {} },
    Scene: class extends Obj {}, PerspectiveCamera: class extends Obj {},
    HemisphereLight: Obj, DirectionalLight: class extends Obj {},
    FogExp2: class { constructor(c) { this.color = c; } },
    PlaneGeometry: Geo, SphereGeometry: Geo, BoxGeometry: Geo, ConeGeometry: Geo,
    CylinderGeometry: Geo, TorusGeometry: Geo, ExtrudeGeometry: Geo,
    Shape: class { moveTo() {} bezierCurveTo() {} },
    BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } },
    BufferAttribute: class { constructor(a) { this.array = a; this.needsUpdate = false; } },
    MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, ShaderMaterial: Mat, SpriteMaterial: Mat,
    CanvasTexture: class {},
    Clock: class { getDelta() { return fixedDelta; } },
    MathUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) },
    BackSide: 2, sRGBEncoding: 3001, ACESFilmicToneMapping: 4
  };
}

function load(opts = {}) {
  const fixedDelta = opts.delta || 1 / 60;
  const src = fs.readFileSync(HTML, "utf8");
  const code = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

  const els = {};
  const ctx2d = new Proxy({}, { get: (o, k) => (k === "canvas" ? {} : () => {}) });
  const el = (id) => {
    if (!els[id]) els[id] = { id, style: {}, textContent: "", innerHTML: "", addEventListener() {}, getContext: () => ctx2d };
    return els[id];
  };
  const rafQ = [];
  const handlers = {};
  const store = {};
  // Node と同じく初期値は {}。null にすると本体側の
  // `module.exports &&` ガードが偽になってエクスポートが走らない
  const exportsBox = { exports: {} };

  const sandbox = {
    THREE: makeTHREE(fixedDelta), console, Math, Date, JSON,
    parseInt, parseFloat, isNaN, Float32Array,
    module: { set exports(v) { exportsBox.exports = v; }, get exports() { return exportsBox.exports; } },
    requestAnimationFrame: (f) => { rafQ.push(f); },
    document: {
      body: { appendChild() {} },
      getElementById: el,
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
      addEventListener() {}
    },
    window: {
      innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
      AudioContext: opts.audio || undefined,
      matchMedia: () => ({ matches: true }),
      addEventListener: (k, f) => { (handlers[k] = handlers[k] || []).push(f); }
    },
    localStorage: {
      setItem(k, v) { store[k] = String(v); },
      getItem(k) { return k in store ? store[k] : null; },
      removeItem(k) { delete store[k]; }
    },
    setTimeout: () => {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "index.html" });

  return {
    game: exportsBox.exports,
    el,
    key(code) { (handlers.keydown || []).forEach((f) => f({ code, preventDefault() {} })); },
    keyUp(code) { (handlers.keyup || []).forEach((f) => f({ code })); },
    frames(n) { for (let i = 0; i < n; i++) { const q = rafQ.splice(0); q.forEach((f) => f(0)); } },
    handlers
  };
}

module.exports = { load, HTML };
