/**
 * AudioWorklet 壳。真正的 DSP 在 ../ks-string.ts，这里只负责消息与时间。
 *
 * 音高自动化放在音频线程里做：主线程按毫秒排，这里按采样精确走，
 * 而且不管怎么推弦，弦的时长都不变。
 */
import { KsString } from "../ks-string.js";

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export interface BendSpec {
  /** 起音时的音分偏移（预推弦用） */
  from: number;
  /** 目标偏移，普通推弦是 0 → n */
  to: number;
  /** 起音后多少秒开始移动 */
  delay: number;
  /** 移动用多少秒 */
  dur: number;
}

export interface PitchStep {
  at: number;
  semi: number;
  glide?: number;
}

export interface VibSpec {
  cents: number;
  hz: number;
  delay: number;
}

export interface VoiceMessage {
  type: "note" | "stop";
  freq?: number;
  /** 相对当前时刻延后多少秒起音 */
  at?: number;
  t60?: number;
  damping?: number;
  pluck?: number;
  bend?: BendSpec;
  vib?: VibSpec;
  /** 发声中途的音高跳变（勾弦 / 拉弦） */
  steps?: PitchStep[];
}

const BLOCK = 128;

export class KsVoiceProcessor extends AudioWorkletProcessor {
  private string: KsString | null = null;
  private startFrame = 0;
  private baseFreq = 0;
  private bend: BendSpec | null = null;
  private steps: PitchStep[] = [];
  private stepIdx = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<VoiceMessage>): void => this.handle(e.data);
  }

  /** 拆出来是为了测试可以直接调用，不必走 MessagePort */
  handle(m: VoiceMessage): void {
    if (m.type === "stop") {
      this.string = null;
      return;
    }
    if (m.type !== "note" || !m.freq) return;

    this.baseFreq = m.freq;
    this.bend = m.bend ?? null;
    this.startFrame = currentFrame + Math.round((m.at ?? 0) * sampleRate);

    if (m.bend) {
      // 预推弦：起音就在高处
      this.baseFreq = m.freq;
    }
    this.string = new KsString(sampleRate, m.freq * Math.pow(2, (m.bend?.from ?? 0) / 12), {
      t60: m.t60 ?? 2,
      damping: m.damping ?? 0.45,
      pluck: m.pluck ?? 0.2,
    });
    this.steps = m.steps ?? [];
    this.stepIdx = 0;
    if (m.vib) this.string.setVibrato(m.vib.cents, m.vib.hz, m.vib.delay);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const first = out[0];
    if (!first || !this.string) return true;

    // 还没到起音时刻：静音但不结束，否则节点会被回收
    if (currentFrame < this.startFrame) {
      first.fill(0);
      for (let c = 1; c < out.length; c++) out[c].fill(0);
      return true;
    }

    // 勾弦 / 拉弦：到点就跳，不是渐变
    const elapsedNow = (currentFrame - this.startFrame) / sampleRate;
    while (this.stepIdx < this.steps.length && elapsedNow >= this.steps[this.stepIdx].at) {
      const s = this.steps[this.stepIdx++];
      this.string.setFrequency(this.baseFreq * Math.pow(2, s.semi / 12), s.glide ?? 0.004);
    }

    // 推弦：按块推进目标频率（一块 2.9 ms，听不出台阶）
    if (this.bend) {
      const elapsed = (currentFrame - this.startFrame) / sampleRate;
      const k = Math.min(1, Math.max(0, (elapsed - this.bend.delay) / this.bend.dur));
      const semi = this.bend.from + (this.bend.to - this.bend.from) * k;
      const target = this.baseFreq * Math.pow(2, semi / 12);
      this.string.setFrequency(target, BLOCK / sampleRate);
    }

    const alive = this.string.render(first, 0, first.length);
    for (let c = 1; c < out.length; c++) out[c].set(first);
    return alive;
  }
}

registerProcessor("ks-voice", KsVoiceProcessor);
