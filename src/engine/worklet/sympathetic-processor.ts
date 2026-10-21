/**
 * 共鸣弦：一根总线上的被动谐振器组。
 *
 * 输入是所有音混好的信号（相当于琴桥受到的力），输出是六根空弦被带着
 * 振出来的声音。插在总线上，和干声并联。
 */
import { KsResonator } from "../ks-resonator.js";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** 空弦频率：E2 A2 D3 G3 B3 E4 */
const OPEN = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];

export class SympatheticProcessor extends AudioWorkletProcessor {
  private readonly strings: KsResonator[];

  constructor() {
    super();
    this.strings = OPEN.map(f => new KsResonator(sampleRate, f, { t60: 1.2, damping: 0.4, coupling: 0.02 }));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const first = out[0];
    if (!first) return true;

    const input = inputs[0] && inputs[0].length > 0 ? inputs[0][0] : null;

    // 只输出共鸣：干声已经在总线上，这里再直通就叠了两遍
    first.fill(0);

    for (const s of this.strings) s.process(input, first);

    for (let c = 1; c < out.length; c++) out[c].set(first);
    return true;
  }
}

registerProcessor("sympathetic", SympatheticProcessor);
