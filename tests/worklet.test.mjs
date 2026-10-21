// Worklet 外壳的冒烟测试：在 Node 里模拟 AudioWorkletGlobalScope，
// 确认 processor 能注册、能出声、能实时改音高。
import assert from "node:assert";

const registered = new Map();

globalThis.sampleRate = 44100;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};
globalThis.registerProcessor = (name, ctor) => registered.set(name, ctor);

await import("../dist/engine/worklet/ks-processor.js");

assert.ok(registered.has("ks-voice"), "processor 应该注册为 ks-voice");
const Ctor = registered.get("ks-voice");

const proc = new Ctor();
const block = new Float32Array(128);
const outputs = () => [[block, new Float32Array(128)]];

// 没收到 note 之前应该静音
proc.process([], outputs());
assert.ok(block.every(v => v === 0), "空载不应该出声");

proc.handle({ type: "note", freq: 220, t60: 2 });
const chunks = [];
for (let i = 0; i < 200; i++) {
  const out = new Float32Array(128);
  proc.process([], [[out, new Float32Array(128)]]);
  chunks.push(out);
}
const peak = Math.max(...chunks.map(c => Math.max(...c.map(Math.abs))));
assert.ok(peak > 0.02 && peak < 1.5, `应该有声音，实测峰值 ${peak.toFixed(3)}`);

// 声像两路应当时刻一致
const [l, r] = [new Float32Array(128), new Float32Array(128)];
proc.process([], [[l, r]]);
assert.deepStrictEqual(Array.from(l), Array.from(r), "左右声道应当相同");

// 实时改音高后应当还在出声（时长没被压缩）
proc.handle({ type: "freq", freq: 330, glide: 0.02 });
for (let i = 0; i < 100; i++) proc.process([], [[new Float32Array(128), new Float32Array(128)]]);
const after = new Float32Array(128);
const alive = proc.process([], [[after, new Float32Array(128)]]);
assert.ok(alive, "改音高之后不应该被判定为结束");
assert.ok(after.some(v => v !== 0), "改音高之后仍然应该有能量");

// 起音时刻：还没到点之前必须是静音
globalThis.currentFrame = 0;
const p2 = new Ctor();
p2.handle({ type: "note", freq: 220, at: 0.01 });
const early = new Float32Array(128);
p2.process([], [[early, new Float32Array(128)]]);
assert.ok(early.every(v => v === 0), "起音时刻之前应当静音");

globalThis.currentFrame = Math.ceil(0.01 * 44100);
const onTime = new Float32Array(128);
p2.process([], [[onTime, new Float32Array(128)]]);
assert.ok(onTime.some(v => v !== 0), "到点之后应当出声");

// 推弦：不崩、不断音
const p3 = new Ctor();
p3.handle({ type: "note", freq: 220, bend: { from: 0, to: 2, delay: 0.02, dur: 0.1 } });
globalThis.currentFrame = 0;
for (let i = 0; i < 80; i++) {
  globalThis.currentFrame = i * 128;
  const b = new Float32Array(128);
  const alive = p3.process([], [[b, new Float32Array(128)]]);
  assert.ok(alive, `推弦过程中第 ${i} 块不应结束`);
}
const tail = new Float32Array(128);
globalThis.currentFrame = 80 * 128;
assert.ok(p3.process([], [[tail, new Float32Array(128)]]), "推弦结束后仍应在发声");

// 勾弦：指定时刻音高应当跳 2 个半音（用零交叉率估，约 ×1.122）
const p4 = new Ctor();
globalThis.currentFrame = 0; // 必须先归零：handle 用 currentFrame 算起音帧
p4.handle({ type: "note", freq: 220, steps: [{ at: 0.5, semi: 2 }] });
const blocks = [];
for (let i = 0; i < 700; i++) {
  globalThis.currentFrame = i * 128;
  const b = new Float32Array(128);
  p4.process([], [[b, new Float32Array(128)]]);
  blocks.push(b);
}
// 用自相关估基频（零交叉率会被音色变化带偏）
const seg = (fromSec, toSec) => {
  const from = Math.floor((fromSec * 44100) / 128);
  const to = Math.floor((toSec * 44100) / 128);
  const x = new Float32Array((to - from) * 128);
  for (let i = from; i < to; i++) x.set(blocks[i], (i - from) * 128);
  return x;
};
const acfF0 = (x) => {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  const lo = 80, hi = 400;
  let best = 0, bestLag = lo;
  for (let lag = lo; lag <= hi; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < x.length; i++) sum += (x[i] - mean) * (x[i + lag] - mean);
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return 44100 / bestLag;
};
const f0Before = acfF0(seg(0.2, 0.45));
const f0After = acfF0(seg(0.6, 0.85));
const ratio = f0After / f0Before;
assert.ok(
  Math.abs(ratio - Math.pow(2, 2 / 12)) < 0.03,
  `勾弦后音高应升 2 个半音（${f0Before.toFixed(1)} → ${f0After.toFixed(1)} Hz，比值 ${ratio.toFixed(3)}）`,
);

console.log("worklet shell ok: 注册 / 出声 / 双声道 / 实时改音高 / 起音时刻 / 推弦 / 勾弦");
