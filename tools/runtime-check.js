// ---------------------------------------------------------------------------
// index.html を実際に数分ぶん走らせて、実行時例外・NaN・状態破綻がないか見る。
// ブラウザを開かずに「起動して遊べる状態か」を確認するための最終関門。
//
//   node tools/runtime-check.js
// ---------------------------------------------------------------------------
const { load } = require("./load.js");
let OfflineAudioContext = null;
try { ({ OfflineAudioContext } = require("web-audio-engine")); } catch (e) {}

let fails = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fails++;
};
const clean = (s) => !/NaN|undefined|Infinity/.test(s);

// 音声ありで起動できるなら本番に近い構成で検査する
let nodeCount = 0;
const AudioCtor = OfflineAudioContext
  ? function () {
      const c = new OfflineAudioContext(1, 44100 * 2, 44100);
      return new Proxy(c, {
        get(t, k) {
          const v = t[k];
          if (typeof v === "function" && /^create/.test(k)) {
            return (...a) => { nodeCount++; return v.apply(t, a); };
          }
          return typeof v === "function" ? v.bind(t) : v;
        }
      });
    }
  : undefined;

console.log(OfflineAudioContext ? "音声あり構成で検査\n" : "音声なし構成で検査 (npm i すると音声も検査します)\n");

const H = load({ audio: AudioCtor });
const { el, key, frames } = H;

console.log("起動");
frames(5);
ok(true, "スタート画面で5フレーム: 例外なし");
ok(nodeCount === 0 || !AudioCtor, "ユーザー操作前は AudioContext を作らない");
ok(el("time").textContent === "0:00.00", "タイマー初期表示 = " + el("time").textContent);

console.log("\nレース");
key("KeyW");
ok(!AudioCtor || nodeCount > 0, "最初のキー入力で音声を初期化");
frames(60 * 4);
ok(el("time").textContent !== "0:00.00", "カウントダウン後にタイマーが進む: " + el("time").textContent);
ok(/GATE 1 \/ 7/.test(el("gateTxt").textContent), "ゲート表示: " + el("gateTxt").textContent);

key("Space");
frames(60 * 30);
ok(clean(el("spd").textContent + el("time").textContent), "30秒走行(ジャンプ含む)で NaN なし");
ok(Number(el("spd").textContent) > 0, "速度が出ている: " + el("spd").textContent + " km/h");

console.log("\n各機能");
key("KeyM");
const n0 = nodeCount;
frames(60 * 10);
ok(!AudioCtor || nodeCount === n0, "M でミュート後は音を生成しない (新規ノード " + (nodeCount - n0) + ")");
key("KeyM");
ok(el("snd").textContent === "♪ ON", "サウンド表示が戻る: " + el("snd").textContent);

key("KeyC"); key("KeyC"); key("KeyC");
frames(30);
ok(true, "カメラ3モード切替: 例外なし");

key("KeyF");
frames(60 * 10);
ok(clean(el("time").textContent), "フリーサーフ切替: スコア = " + el("time").textContent);
key("KeyF");
frames(60 * 5);
ok(/GATE/.test(el("gateTxt").textContent), "レース復帰: " + el("gateTxt").textContent);

key("KeyR");
frames(60 * 2);
ok(el("time").textContent !== "", "R でリスタート");

console.log("\n長時間");
let bad = 0;
for (let i = 0; i < 24; i++) {
  frames(60 * 5);
  if (!clean(el("spd").textContent + el("time").textContent + el("rank").innerHTML)) bad++;
}
ok(bad === 0, "追加120秒: NaN/undefined なし");
if (AudioCtor) ok(nodeCount < 20000, "音声ノード総数 " + nodeCount + " (リークなし)");

console.log(fails === 0 ? "\n✓ 実行時チェック 全項目パス" : `\n✗ ${fails}件の問題`);
process.exitCode = fails ? 1 : 0;
