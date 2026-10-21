// 引擎调度层的接线测试：确认推弦走实时弦、其余仍走 buffer，且失败能退回。
import assert from "node:assert";

import { Engine, CARDS, DEMOS, buildPattern } from "../dist/index.js";

let workletNodes = 0;
let bufferSources = 0;
let moduleLoads = 0;
let failAddModule = false;

const node = (x = {}) => Object.assign({ connect() {}, disconnect() {} }, x);
const param = () => ({
  value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {},
  setTargetAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {},
});

function fakeContext() {
  return {
    sampleRate: 44100, state: "running", currentTime: 0, destination: node(),
    resume() {},
    audioWorklet: {
      addModule: async () => {
        if (failAddModule) throw new Error("no worklet");
        moduleLoads++;
      },
    },
    createDynamicsCompressor: () => node({ threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 } }),
    createGain: () => node({ gain: param() }),
    createStereoPanner: () => node({ pan: { value: 0 } }),
    createBiquadFilter: () => node({ type: "", frequency: { value: 0 }, gain: { value: 0 }, Q: { value: 0 } }),
    createOscillator: () => node({ frequency: { value: 0 }, type: "", start() {}, stop() {} }),
    createConvolver: () => node({ normalize: false, buffer: null }),
    createBufferSource: () => {
      bufferSources++;
      return node({ playbackRate: param(), start() {}, stop() {}, buffer: null });
    },
    createBuffer: (ch, len, sr) => {
      const a = Array.from({ length: ch }, () => new Float32Array(len));
      return { getChannelData: i => a[i], length: len, numberOfChannels: ch, sampleRate: sr };
    },
    createOffline: () => {
      throw new Error("本测试不覆盖离线渲染");
    },
  };
}

globalThis.AudioWorkletNode = class {
  constructor() {
    workletNodes++;
    this.port = { postMessage() {} };
  }
  connect() {}
  disconnect() {}
};

const bendPattern = buildPattern(DEMOS[0]); // 第 9 条：推弦 / 揉弦
const liveCount = bendPattern.notes.filter(n => n[4]?.bend ?? n[4]?.pre ?? n[4]?.vib).length;
const plainPattern = buildPattern(CARDS[0]); // 第 1 条：普通分解

const host = { createContext: () => fakeContext(), createOffline: () => fakeContext() };

// 1) worklet 可用：带音高自动化的音走实时弦
const e1 = new Engine(host);
const ok = await e1.prepare();
assert.strictEqual(ok, true, "prepare 应当成功");
assert.strictEqual(moduleLoads, 2, "两个模块各加载一次：实时弦 + 共鸣弦");

// 第 9 条每小节一个低音 + 一个带技巧的旋律音：只有后者该走实时弦
workletNodes = 0;
bufferSources = 0;
e1.play(bendPattern);
assert.strictEqual(workletNodes, liveCount, `带音高自动化的音应走实时弦（${liveCount}），实际 ${workletNodes}`);
// 每个音无论走哪条路都会有一个拨片噪声源，所以 buffer 源数 = 音数 + 走 buffer 的音数
assert.strictEqual(bufferSources, bendPattern.notes.length + (bendPattern.notes.length - liveCount), "其余音仍走 buffer");

workletNodes = 0;
e1.play(plainPattern);
assert.strictEqual(workletNodes, 0, "普通分解不应创建实时弦");
assert.ok(bufferSources > 0, "普通分解应走 buffer");
e1.stop();

// 2) worklet 不可用：推弦退回 buffer，不抛错
failAddModule = true;
const e2 = new Engine(host);
assert.strictEqual(await e2.prepare(), false, "addModule 失败时 prepare 应返回 false");
workletNodes = 0;
bufferSources = 0;
e2.play(bendPattern);
assert.strictEqual(workletNodes, 0, "退回后不应再创建实时弦");
assert.strictEqual(bufferSources, bendPattern.notes.length * 2, "应当全部走 buffer（含拨片噪声）");

// 3) 断开的定时器必须按「起音延迟」算，否则排在后面的音还没响就被切断
const timers = [];
const messages = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => {
  timers.push(ms);
  return 0;
};
globalThis.AudioWorkletNode = class {
  constructor() {
    workletNodes++;
    this.port = { postMessage: m => messages.push(m) };
  }
  connect() {}
  disconnect() {}
};
failAddModule = false;
const e3 = new Engine(host);
await e3.prepare();
e3.play(bendPattern);
globalThis.setTimeout = realSetTimeout;

const noteMsgs = messages.filter(m => m.type === "note");
assert.ok(noteMsgs.length > 0, "应当发出 note 消息");
const lastStart = Math.max(...noteMsgs.map(m => m.at ?? 0));
assert.ok(
  Math.max(...timers) > lastStart * 1000,
  `最后一个音的断开定时器（${Math.max(...timers)} ms）必须晚于它的起音（${Math.round(lastStart * 1000)} ms）`,
);

// 4) 反复播放后 stop() 必须把节点从图上清干净（否则连点几次就卡死）
const e4 = new Engine(host);
failAddModule = false;
await e4.prepare();
for (let i = 0; i < 3; i++) {
  e4.play(plainPattern);
  assert.ok(e4.activeNodeCount > 0, "播放期间应当有节点在图里");
}
const peakNodes = e4.activeNodeCount;
e4.stop();
assert.strictEqual(e4.activeNodeCount, 0, `stop 之后不应残留节点（之前 ${peakNodes} 个）`);

console.log(
  `engine wiring ok: 推弦卡 ${liveCount}/${bendPattern.notes.length} 音走实时弦，普通分解 ${plainPattern.notes.length} 音走 buffer，失败可退回，断开定时器按起音延迟算，stop 后节点清零`,
);
