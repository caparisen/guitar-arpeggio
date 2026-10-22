/**
 * 公开入口。发布的是拆开的 ESM 模块（dist/），不需要打包器。
 *
 * 用法：
 *   import { Engine, browserHost, buildPattern } from "guitar-arpeggio";
 *   const engine = new Engine(browserHost);
 *   engine.play(buildPattern(myCard));
 *
 * 示例/曲目（01–20）是仓库根目录的 examples/*.gtr，不进发布的 dist/。
 */

export { Engine } from "./engine/engine.js";
export { browserHost } from "./engine/host.js";
export { encodeWav, createBodyIR } from "./engine/dsp.js";
export { VoiceBank } from "./engine/voice.js";
export { KsString } from "./engine/ks-string.js";
export { loadKsWorklet, createKsVoice, setVoiceFrequency, stopVoice } from "./engine/worklet/index.js";
export { TIMBRE, BODY, TUNING, VARIANTS } from "./engine/config.js";

export { buildPattern } from "./data/build.js";
export { cardAscii, renderBar, renderBlock, renderDynamics, noteLabel } from "./data/ascii.js";
export { parseAscii } from "./ascii-parse.js";
export { parseScore, cardToScore, ScoreError } from "./score.js";

export { validateCard, validateCards, formatIssue, DEFAULT_LIMITS } from "./validate.js";

export type { AsciiOptions } from "./data/ascii.js";
export type { ParseOptions } from "./ascii-parse.js";
export type { Card, Bar, Event, RawNote } from "./data/types.js";
export type { Pattern, NoteTuple, Tech, TimbreName, EngineHost } from "./engine/types.js";
export type { ValidateOptions, ValidationIssue, ValidationResult, RuleId, NoteRef } from "./validate.js";
