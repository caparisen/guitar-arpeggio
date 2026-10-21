// 共鸣弦：被动谐振器要能在自己的频率上被激起，别的频率上不灵。
import assert from "node:assert";

const reg = new Map();
globalThis.sampleRate = 44100;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};
globalThis.registerProcessor = (n, c) => reg.set(n, c);

const { KsResonator } = await import("../dist/engine/ks-resonator.js");
await import("../dist/engine/worklet/sympathetic-processor.js");

const SR = 44100;

/** 用一段 50 ms 的正弦「敲」一下，之后静音 1 秒，返回后续能量 */
function ringEnergy(freq, probeFreq) {
  const r = new KsResonator(SR, freq, { t60: 3, damping: 0.4, coupling: 0.02 });
  const n = SR;
  const drive = new Float32Array(n);
  for (let i = 0; i < SR * 0.05; i++) drive[i] = Math.sin((2 * Math.PI * probeFreq * i) / SR) * 0.5;
  const out = new Float32Array(n);
  r.process(drive, out);
  let e = 0;
  for (let i = SR * 0.2; i < SR * 0.8; i++) e += out[i] * out[i];
  return Math.sqrt(e / (SR * 0.6));
}

const onTune = ringEnergy(220, 220);
const offTune = ringEnergy(220, 300);
assert.ok(onTune > 0.01, `共振点上应当被激起，实测 ${onTune.toFixed(4)}`);
assert.ok(onTune > offTune * 4, `共振点应明显强于非共振点（${onTune.toFixed(4)} vs ${offTune.toFixed(4)}）`);

// 处理器：六根空弦，输入一段和弦，输出应当有共鸣能量
const Ctor = reg.get("sympathetic");
assert.ok(Ctor, "sympathetic 应当注册");
const proc = new Ctor();
const block = new Float32Array(128);
const out = new Float32Array(128);
let peak = 0;
for (let i = 0; i < 400; i++) {
  // 喂一段 A2（110 Hz），正好是第 2 根空弦
  for (let k = 0; k < 128; k++) block[k] = Math.sin((2 * Math.PI * 110 * (i * 128 + k)) / SR) * 0.3;
  out.fill(0);
  proc.process([[block]], [[out, new Float32Array(128)]]);
  for (const v of out) peak = Math.max(peak, Math.abs(v));
}
assert.ok(peak > 0.001, `共鸣输出应当有能量，实测峰值 ${peak.toFixed(5)}`);

// 收尾：输入停下之后必须真的静下来，否则播完了还在响
{
  const r = new KsResonator(SR, 110, { t60: 1.2, damping: 0.4, coupling: 0.02 });
  const n = SR * 5;
  const drive = new Float32Array(n);
  const out = new Float32Array(n);
  for (let i = 0; i < SR * 2; i++) drive[i] = Math.sin((2 * Math.PI * 110 * i) / SR) * 0.3;
  r.process(drive, out);
  const peak = t => {
    let m = 0;
    for (let i = Math.floor(t * SR); i < Math.floor((t + 0.1) * SR); i++) m = Math.max(m, Math.abs(out[i]));
    return m;
  };
  const atStop = peak(1.9);
  const after1s = peak(3.0);
  assert.ok(atStop > 1e-3, `停声前应当有能量，实测 ${atStop.toExponential(2)}`);
  assert.ok(after1s < atStop / 100, `停声 1 秒后应当衰减 40 dB 以上（${atStop.toExponential(2)} → ${after1s.toExponential(2)}）`);
}

console.log("sympathetic ok: 共振点被激起、非共振点衰、处理器有输出、停声后收敛");
