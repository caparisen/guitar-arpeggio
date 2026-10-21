/**
 * 加载并创建实时 KS 弦节点。
 *
 * 用不用它由调用方决定：现有 buffer 引擎仍是默认路径，这一层是给
 * 推弦 / 滑音 / 勾弦这类需要实时改音高的场景准备的。
 */

// 本文件编译后就在 dist/engine/worklet/，processor 是同目录的兄弟文件
const MODULE_URL = new URL("./ks-processor.js", import.meta.url);

const loaded = new WeakSet<AudioContext>();

export interface KsVoiceOptions {
  freq: number;
  t60?: number;
  damping?: number;
  pluck?: number;
}

const SYM_URL = new URL("./sympathetic-processor.js", import.meta.url);
const symLoaded = new WeakSet<AudioContext>();

export async function loadKsWorklet(ctx: AudioContext): Promise<void> {
  if (loaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(MODULE_URL.href);
  loaded.add(ctx);
}

/** 共鸣弦模块，和实时弦分开加载：任何一个失败都不影响另一个 */
export async function loadSympatheticWorklet(ctx: AudioContext): Promise<void> {
  if (symLoaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(SYM_URL.href);
  symLoaded.add(ctx);
}

export function createSympatheticNode(ctx: AudioContext): AudioWorkletNode {
  return new AudioWorkletNode(ctx, "sympathetic", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
}

export async function createKsVoice(ctx: AudioContext, opts: KsVoiceOptions): Promise<AudioWorkletNode> {
  await loadKsWorklet(ctx);
  const node = new AudioWorkletNode(ctx, "ks-voice", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.port.postMessage({ type: "note", ...opts });
  return node;
}

/** 实时改音高：滑音 / 推弦，时长不受影响 */
export function setVoiceFrequency(node: AudioWorkletNode, freq: number, glideSeconds = 0.03): void {
  node.port.postMessage({ type: "freq", freq, glide: glideSeconds });
}

export function stopVoice(node: AudioWorkletNode): void {
  node.port.postMessage({ type: "stop" });
}
