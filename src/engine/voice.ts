import { BUF_LIMIT, TIMBRE, VARIANTS } from "./config.js";
import { createBodyIR, makeRng } from "./dsp.js";
import type { TimbreName } from "./types.js";

/** 一个单音的时值上限（秒），buffer 略长于它 */
const NOTE_SECONDS = 2.0;

/**
 * 单音 buffer 的仓库。
 *
 * 同一个 (音色, 音高, 弦号, 变体, 分音) 只算一次；缓存按插入顺序淘汰，
 * 否则切两次音色会留 50 MB。
 */
export class VoiceBank {
  private cache = new Map<string, AudioBuffer>();
  /** 按「音色 + 采样率」缓存：ConvolverNode 不接受采样率不匹配的 IR */
  private irs = new Map<string, AudioBuffer>();
  private timbre: TimbreName = "steel";

  get current(): TimbreName {
    return this.timbre;
  }

  setTimbre(t: TimbreName): void {
    this.timbre = t;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private put(key: string, buf: AudioBuffer): AudioBuffer {
    this.cache.set(key, buf);
    if (this.cache.size > BUF_LIMIT) {
      for (const k of this.cache.keys()) {
        if (this.cache.size <= BUF_LIMIT) break;
        this.cache.delete(k);
      }
    }
    return buf;
  }

  body(ctx: BaseAudioContext): AudioBuffer {
    const key = `${this.timbre}|${ctx.sampleRate}`;
    const hit = this.irs.get(key);
    if (hit) return hit;
    const ir = createBodyIR(ctx, this.timbre);
    this.irs.set(key, ir);
    return ir;
  }

  /**
   * 单音。harm > 1 时按泛音处理：激励更纯、延音更长、触弦噪声更少。
   * midi 已经是「发声」音高，泛音的高八度由调用方加好。
   */
  note(ctx: BaseAudioContext, midi: number, str: number, variant: number, harm: number): AudioBuffer {
    const key = `${ctx.sampleRate}|${this.timbre}|${midi}|${str}|${variant}|${harm}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const T = TIMBRE[this.timbre];
    const sr = ctx.sampleRate;
    const H = harm;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const N = Math.floor(sr * NOTE_SECONDS);
    const buf = ctx.createBuffer(1, N, sr);
    const d = buf.getChannelData(0);
    const P1 = Math.max(2, Math.round(sr / f));
    const rnd = makeRng(1234 + midi * 7919 + str * 131 + variant * 7717);

    // 1) 激励：1..9 次谐波 × 拨弦位置梳 sin(kπβ)
    const beta = H > 1 ? 0.5 : T.pluck * (0.92 + rnd() * 0.16);
    const harmExp = H > 1 ? 2.7 : T.harm;
    const floorAmt = H > 1 ? T.floor * 0.3 : T.floor;

    // 2) 第二极化：微失谐的延迟线（分数延迟 → 1~4 音分拍频）
    const D2 = P1 / (1 + T.detune);
    const P2 = Math.max(2, Math.floor(D2));
    const fr2 = D2 - P2;
    const N2 = P2 + 2;
    const r1 = new Float32Array(P1);
    const r2 = new Float32Array(N2);
    for (let k = 1; k <= 9; k++) {
      const base = Math.pow(k, -harmExp) * Math.abs(Math.sin(Math.PI * k * beta));
      const ph = rnd() * Math.PI * 2;
      const ph2 = rnd() * Math.PI * 2;
      for (let n = 0; n < P1; n++) r1[n] += base * Math.sin((2 * Math.PI * k * n) / P1 + ph);
      for (let n = 0; n < N2; n++) r2[n] += base * Math.sin((2 * Math.PI * k * n) / P2 + ph2);
    }
    for (let n = 0; n < P1; n++) r1[n] = r1[n] * 0.4 + (rnd() * 2 - 1) * floorAmt;
    for (let n = 0; n < N2; n++) r2[n] = r2[n] * 0.4 + (rnd() * 2 - 1) * floorAmt;

    const tau =
      1.5 *
      Math.pow(2, -(midi - 40) / 24) *
      T.tauMul *
      (T.tauStr[str] ?? 1) *
      (H > 1 ? 1.8 : 1);
    const dec = Math.exp(-1 / (sr * tau));
    const a = T.loop;
    const w1 = 0.62;
    const w2 = 0.52;
    const tau2 = tau * T.damp2;
    const dec2 = Math.exp(-1 / (sr * tau2));

    let i1 = 0;
    let i1n = 1;
    let env = 1;
    let env2 = 1;
    let w2i = 0;
    let p0 = (N2 - (P2 + 1)) % N2;
    let p1 = (p0 + 1) % N2;
    let xp2 = 0;

    for (let i = 0; i < N; i++) {
      const x2 = r2[p0] + (r2[p1] - r2[p0]) * (1 - fr2);
      const y2 = (1 - a) * x2 + a * xp2;
      xp2 = x2;
      r2[w2i] = y2;
      // 两条极化各自衰减：第二条短，造成「先闷一下再延音」
      d[i] = r1[i1] * w1 * env + x2 * w2 * env2;
      env *= dec;
      env2 *= dec2;
      r1[i1] = (1 - a) * r1[i1] + a * r1[i1n];
      i1 = i1n;
      i1n++;
      if (i1n >= P1) i1n = 0;
      w2i++;
      if (w2i >= N2) w2i = 0;
      p0++;
      if (p0 >= N2) p0 = 0;
      p1++;
      if (p1 >= N2) p1 = 0;
    }

    // 3) 归一化 + 尾部淡出（琴体在总线上统一处理）
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(d[i]));
    const g = 0.85 / (peak || 1);
    const fade = Math.floor(sr * 0.06);
    for (let i = 0; i < N; i++) {
      let v = d[i] * g;
      if (i > N - fade) v *= (N - i) / fade;
      d[i] = v;
    }
    return this.put(key, buf);
  }

  /** 拨片瞬态：独立小 buffer，按力度在播放时给音量 */
  pick(ctx: BaseAudioContext, variant: number): AudioBuffer {
    const key = `${ctx.sampleRate}|pick|${this.timbre}|${variant}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const T = TIMBRE[this.timbre];
    const sr = ctx.sampleRate;
    const N = Math.floor(sr * 0.055);
    const buf = ctx.createBuffer(1, N, sr);
    const d = buf.getChannelData(0);
    const rnd = makeRng(99 + variant * 3571);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const nz = rnd() * 2 - 1;
      d[i] = (nz - 0.93 * prev) * Math.exp(-i / (sr * T.attackDecay));
      prev = nz;
    }
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(d[i]));
    const k = 1 / (peak || 1);
    for (let i = 0; i < N; i++) d[i] *= k;
    return this.put(key, buf);
  }

  /** 滑音噪声：弦擦品丝的「吱」声 */
  squeak(ctx: BaseAudioContext): AudioBuffer {
    const key = `${ctx.sampleRate}|squeak`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const N = Math.floor(sr * 0.16);
    const buf = ctx.createBuffer(1, N, sr);
    const d = buf.getChannelData(0);
    const rnd = makeRng(4242);
    let prev = 0;
    let peak = 0;
    for (let i = 0; i < N; i++) {
      const nz = rnd() - 0.5;
      const hp = nz - 0.7 * prev;
      prev = nz;
      const t = i / N;
      const e = Math.sin(Math.PI * t);
      d[i] = hp * e * e;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const k = 1 / (peak || 1);
    for (let i = 0; i < N; i++) d[i] *= k;
    return this.put(key, buf);
  }
}

export { VARIANTS };
