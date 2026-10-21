/**
 * 公开入口。发布的是拆开的 ESM 模块（dist/），不需要打包器。
 *
 * 用法：
 *   import { Engine, browserHost, CARDS, DEMOS, buildPattern } from "guitar-arpeggio";
 *   const engine = new Engine(browserHost);
 *   engine.play(buildPattern(CARDS[0]));
 */

export { Engine } from "./engine/engine.js";
export { browserHost } from "./engine/host.js";
export { encodeWav, createBodyIR } from "./engine/dsp.js";
export { VoiceBank } from "./engine/voice.js";
export { KsString } from "./engine/ks-string.js";
export { loadKsWorklet, createKsVoice, setVoiceFrequency, stopVoice } from "./engine/worklet/index.js";
export { TIMBRE, BODY, TUNING, VARIANTS } from "./engine/config.js";

export { CARDS } from "./data/patterns.js";
export { DEMOS } from "./data/demos.js";
export { buildPattern } from "./data/build.js";
export { cardAscii, renderBar, renderBlock } from "./data/ascii.js";

export type { Card, Bar, Event, RawNote } from "./data/patterns.js";
export type { Pattern, NoteTuple, Tech, TimbreName, EngineHost } from "./engine/types.js";

