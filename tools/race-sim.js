// ---------------------------------------------------------------------------
// NPC だけでコースを走らせ、完走タイム・順位・技量差を出す。
// 本体の stepSurfer / npcInput / tryPassGate をそのまま呼ぶので、
// 物理や AI を触ったらここを走らせれば影響が即わかる。
//
//   node tools/race-sim.js            通常
//   node tools/race-sim.js --detail   区間タイムと加速度内訳つき
// ---------------------------------------------------------------------------
const { load } = require("./load.js");

const DT = 1 / 60;
const MAX_S = 500;
const detail = process.argv.includes("--detail");

const { game } = load();
const { gates, GATE_N, COURSE_LEN, stepSurfer, npcInput, tryPassGate,
        racers, resetRace, setTime } = game;

resetRace();
const npcs = racers.filter((r) => !r.isPlayer);

let t = 0;
const trace = npcs.map(() => ({ dist: 0, sumSpeed: 0, n: 0, slope: 0, pump: 0, drag: 0, turn: 0 }));

for (let i = 0; i < 60 * MAX_S; i++) {
  t += DT;
  setTime(t);
  npcs.forEach((o, k) => {
    if (o.finished) return;
    const inp = npcInput(o, DT);
    if (detail) {
      const wi = game.waveInfo(o.x, o.z, t);
      const hx = Math.sin(o.yaw), hz = Math.cos(o.yaw);
      const tr = trace[k];
      tr.slope += -(wi.gx * hx + wi.gz * hz) * 34;
      tr.pump += inp.pump ? 11 * o.thrust : 0;
      tr.drag += -(0.055 * o.speed * o.speed + 0.9);
      tr.turn += -Math.abs(inp.turn) * o.speed * 0.16;
    }
    const px = o.x, pz = o.z;
    stepSurfer(o, inp, DT);
    tryPassGate(o, t);
    const tr = trace[k];
    tr.dist += Math.hypot(o.x - px, o.z - pz);
    tr.sumSpeed += o.speed; tr.n++;
  });
  if (npcs.every((o) => o.finished)) break;
}

const order = npcs.slice().sort((a, b) => (a.finished ? a.tFin : 1e9) - (b.finished ? b.tFin : 1e9));
const times = npcs.filter((o) => o.finished).map((o) => o.tFin);

console.log(`コース: ${GATE_N}ゲート / 全長 ${COURSE_LEN.toFixed(0)}m\n`);
order.forEach((o, i) => {
  const k = npcs.indexOf(o), tr = trace[k];
  const line = o.finished
    ? `${o.tFin.toFixed(2)}s  平均${(tr.dist / o.tFin).toFixed(1)}m/s ` +
      `(${(tr.dist / o.tFin * 3.6).toFixed(0)}km/h) 走行${tr.dist.toFixed(0)}m ` +
      `遠回り${(tr.dist / COURSE_LEN).toFixed(2)}倍`
    : `DNF (gate ${o.gate}/${GATE_N})`;
  console.log(`  ${i + 1}位 ${o.name.padEnd(4)} skill${o.skill.toFixed(2)} thrust${o.thrust.toFixed(2)}  ${line}`);
  if (detail && o.finished) {
    console.log(`        区間: ${o.splits.map((s, j, a) => (s - (j ? a[j - 1] : 0)).toFixed(1)).join(" / ")}`);
    console.log(`        平均加速度 斜面${(tr.slope / tr.n).toFixed(2)} ` +
      `パンプ${(tr.pump / tr.n).toFixed(2)} 抗力${(tr.drag / tr.n).toFixed(2)} ` +
      `旋回${(tr.turn / tr.n).toFixed(2)} m/s²`);
  }
});

if (times.length === npcs.length) {
  const spread = Math.max(...times) - Math.min(...times);
  console.log(`\n最速 ${Math.min(...times).toFixed(1)}s / 最遅 ${Math.max(...times).toFixed(1)}s  技量差 ${spread.toFixed(1)}s`);
  // 技量順にタイムが縮んでいるか(AI調整で最も壊れやすい性質)
  const bySkill = npcs.slice().sort((a, b) => a.skill - b.skill).map((o) => o.tFin);
  const mono = bySkill.every((x, i) => i === 0 || x < bySkill[i - 1]);
  console.log(mono
    ? "✓ 技量が高いほど速い (単調性OK)"
    : `✗ 技量とタイムが逆転している: ${bySkill.map((x) => x.toFixed(1)).join(" → ")}`);
  process.exitCode = mono ? 0 : 1;
} else {
  console.log("\n✗ DNF あり — AI がゲートを取りこぼしている");
  process.exitCode = 1;
}

console.log("\n期待値の目安: KAI≒108s NOA≒103s RIO≒98s ZEN≒89s (誤差数秒)");
