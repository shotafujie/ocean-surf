// ---------------------------------------------------------------------------
// 効果音をオフラインレンダリングして、音量・支配周波数・クリッピングを検査する。
// 耳で確認できない環境でも「笛が鳴っていない」「しぶきが小さすぎる」を検出できる。
//
//   npm i && node tools/audio-test.js
//
// 過去にここで見つけた不具合:
//   - マスターのフェードイン(時定数0.8s)が最初のカウントダウン笛を飲んでいた
//   - linearRamp のあとに setValueAtTime を置くと以降が無音になり笛が50msで切れた
//   - ローパス下降スイープでノイズが-16dB落ち、しぶきがほぼ聞こえなかった
// ---------------------------------------------------------------------------
let OfflineAudioContext;
try {
  ({ OfflineAudioContext } = require("web-audio-engine"));
} catch (e) {
  console.error("web-audio-engine が必要です:  npm install");
  process.exit(1);
}
const { load } = require("./load.js");
const SR = 44100;

let ctx = null;
const AudioCtor = function () { return ctx; };

async function render(fn, dur) {
  ctx = new OfflineAudioContext(1, Math.floor(SR * dur), SR);
  const { game } = load({ audio: AudioCtor });
  game.AU.init();
  if (fn) fn(game.AU);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
        const vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}
function topFreqs(d, offSec, N, n, minF) {
  const off = Math.floor(SR * offSec);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (d[off + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  fft(re, im);
  const a = [];
  for (let i = 1; i < N / 2; i++) {
    const f = i * SR / N;
    if (f > (minF || 0)) a.push({ f, m: Math.hypot(re[i], im[i]) });
  }
  a.sort((x, y) => y.m - x.m);
  const out = [];
  for (const p of a) { if (out.every((q) => Math.abs(q.f - p.f) > 150)) out.push(p); if (out.length >= n) break; }
  return out;
}
const peak = (d) => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (d) => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);

let fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log("   ✗ " + msg); } }

(async () => {
  const bed = await render(null, 2.5);
  const bedRms = rms(bed), bedPeak = peak(bed);
  console.log(`海のベッド(定常)  peak ${bedPeak.toFixed(3)}  rms ${bedRms.toFixed(4)}`);
  check(bedPeak > 0.005 && bedPeak < 0.10, `海の音が想定音量から外れている (peak ${bedPeak.toFixed(3)}, 期待 0.005〜0.10)`);

  // [名前, 発火, 秒, 最低peak, 最高peak]
  const CASES = [
    ["3・2・1の短笛", (A) => A.countPip(), 1.2, 0.15, 0.55],
    ["GOの長笛     ", (A) => A.countGo(), 1.8, 0.20, 0.65],
    ["ゲート通過   ", (A) => A.gate(), 1.0, 0.04, 0.30],
    ["着水(通常)   ", (A) => A.land(false), 1.5, 0.08, 0.40],
    ["ワイプアウト ", (A) => A.land(true), 2.0, 0.12, 0.55],
    ["イルカ着水   ", (A) => A.dolphin(-0.7), 1.5, 0.05, 0.35],
    ["リング取得   ", (A) => A.ring(), 1.0, 0.03, 0.30],
    ["ゴール       ", (A) => A.finish(true), 2.5, 0.15, 0.60]
  ];
  console.log("");
  for (const [name, fn, dur, lo, hi] of CASES) {
    const d = await render(fn, dur);
    const pk = peak(d);
    const net = Math.sqrt(Math.max(0, rms(d) ** 2 - bedRms ** 2));
    const fr = topFreqs(d, 0.05, 4096, 3, 800);
    console.log(`${name}  peak ${pk.toFixed(3)}  実効 ${net.toFixed(4)}  ` +
      `主成分 ${fr.map((p) => Math.round(p.f)).join("/")}Hz`);
    check(pk >= lo, `${name.trim()} が小さすぎる (peak ${pk.toFixed(3)} < ${lo})`);
    check(pk <= hi, `${name.trim()} が大きすぎる (peak ${pk.toFixed(3)} > ${hi})`);
  }

  // 笛が本当に笛の帯域で鳴っているか(過去に完全に無音だった箇所)
  const w = await render((A) => A.countGo(), 1.8);
  const wf = topFreqs(w, 0.30, 8192, 1, 800)[0];
  console.log(`\n笛の支配周波数 ${Math.round(wf.f)}Hz`);
  check(wf.f > 1800 && wf.f < 2900, `笛が笛の帯域で鳴っていない (${Math.round(wf.f)}Hz, 期待 1800〜2900Hz)`);

  // 持続時間: 鳴りっぱなしになるべき区間で音が落ちていないか
  const seg = (x, a, b) => peak(x.slice(Math.floor(SR * a), Math.floor(SR * b)));
  const early = seg(w, 0.05, 0.15), late = seg(w, 0.60, 0.80);
  console.log(`笛の持続  0.05-0.15s ${early.toFixed(3)} → 0.60-0.80s ${late.toFixed(3)}`);
  check(late > early * 0.5, `笛が途中で切れている (${early.toFixed(3)} → ${late.toFixed(3)})`);

  // 音が重なったときにハードクリップしないか
  const many = await render((A) => { for (let i = 0; i < 8; i++) { A.land(true); A.dolphin(0); A.gate(); } }, 2.0);
  let run = 0, worst = 0;
  for (const v of many) { if (Math.abs(v) >= 0.999) { run++; worst = Math.max(worst, run); } else run = 0; }
  console.log(`\n過負荷(24音同時)  peak ${peak(many).toFixed(3)}  フルスケール連続 ${worst}サンプル`);
  check(worst < 3, `ハードクリップしている (${worst}サンプル連続)`);

  console.log(fails === 0 ? "\n✓ 音声チェック 全項目パス" : `\n✗ ${fails}件の問題`);
  process.exitCode = fails ? 1 : 0;
})();
