// 用假的 AudioContext 跑编译后的引擎，把关键 buffer 导出成 f32 给 tests/test_audio.py。
// 用法：node tests/dump.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CARDS, DEMOS, buildPattern, VoiceBank, encodeWav, KsString } from "../dist/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.join(HERE, "out");
const SR = 44100;

if (!fs.existsSync(path.join(ROOT, "dist", "index.js"))) {
  console.error("没有 dist/，先跑 npm run build");
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

// ---- 假 Web Audio ----
const node = (x = {}) => Object.assign({ connect() {}, disconnect() {} }, x);
const param = () => ({
  value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {},
  setTargetAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {},
});

function fakeCtx() {
  return {
    sampleRate: SR, state: "running", currentTime: 0, destination: node(),
    resume() {},
    createDynamicsCompressor: () => node({ threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 } }),
    createGain: () => node({ gain: param() }),
    createStereoPanner: () => node({ pan: { value: 0 } }),
    createBiquadFilter: () => node({ type: "", frequency: { value: 0 }, gain: { value: 0 }, Q: { value: 0 } }),
    createOscillator: () => node({ frequency: { value: 0 }, type: "", start() {}, stop() {} }),
    createConvolver: () => node({ normalize: false, buffer: null }),
    createBufferSource: () => node({ playbackRate: param(), start() {}, stop() {}, buffer: null }),
    createBuffer: (ch, len, sr) => {
      const a = Array.from({ length: ch }, () => new Float32Array(len));
      return { getChannelData: i => a[i], length: len, numberOfChannels: ch, sampleRate: sr };
    },
  };
}

const ctx = fakeCtx();
const manifest = { sampleRate: SR, buffers: [], patterns: [], wav: null };

function dump(name, buffer) {
  const d = buffer.getChannelData(0);
  const bytes = Buffer.alloc(d.length * 4);
  for (let i = 0; i < d.length; i++) bytes.writeFloatLE(d[i], i * 4);
  fs.writeFileSync(path.join(OUT, `${name}.f32`), bytes);
  manifest.buffers.push({ name, length: d.length });
}

// 单音：两个音色 × 三个音高 × 三个变体
const bank = new VoiceBank();
for (const t of ["steel", "nylon"]) {
  bank.setTimbre(t);
  bank.clear();
  for (const [midi, str] of [[40, 6], [52, 4], [64, 1]]) {
    for (let v = 0; v < 3; v++) dump(`note_${t}_${midi}_${str}_v${v}`, bank.note(ctx, midi, str, v, 1));
  }
}

// 泛音 vs 按弦
bank.setTimbre("steel");
bank.clear();
dump("plain_52", bank.note(ctx, 52, 3, 0, 1));
dump("harm_52", bank.note(ctx, 52, 3, 0, 2));

// 琴体 IR
bank.clear();
dump("ir_steel", bank.body(ctx));
bank.setTimbre("nylon");
dump("ir_nylon", bank.body(ctx));

// 数据侧摘要
manifest.patterns = [...CARDS, ...DEMOS].map(buildPattern).map(p => ({
  id: p.id, title: p.title, bars: p.bars, barSec: p.barSec,
  notes: p.notes.map(n => [n[0], n[1], n[2], n[3], n[5]]),
}));

// 实时 KS 弦（AudioWorklet 的核心，纯 DSP）
function renderKs(freq, seconds, bend) {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const ks = new KsString(SR, freq, { t60: 2.0, damping: 0.45, pluck: 0.2 });
  if (!bend) {
    ks.render(out, 0, n);
  } else {
    const mid = Math.floor(n / 4);
    ks.render(out, 0, mid);
    ks.setFrequency(bend, 0.05);
    ks.render(out, mid, n - mid);
  }
  return out;
}

function dumpSamples(name, data) {
  const bytes = Buffer.alloc(data.length * 4);
  for (let i = 0; i < data.length; i++) bytes.writeFloatLE(data[i], i * 4);
  fs.writeFileSync(path.join(OUT, `${name}.f32`), bytes);
  manifest.buffers.push({ name, length: data.length });
}

dumpSamples("ks_110", renderKs(110, 2));
dumpSamples("ks_220", renderKs(220, 2));
dumpSamples("ks_bend", renderKs(220, 2, 247));

// WAV 编码
const n = 256;
const fake = {
  length: n, numberOfChannels: 2, sampleRate: SR,
  getChannelData: c => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * i) / 32) * (c ? -0.5 : 0.5);
    return a;
  },
};
const ab = await encodeWav(fake).arrayBuffer();
fs.writeFileSync(path.join(OUT, "test.wav"), Buffer.from(ab));
manifest.wav = { bytes: ab.byteLength, length: n, channels: 2, sampleRate: SR };
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log("dumped", manifest.buffers.length, "buffers,", manifest.patterns.length, "patterns");
