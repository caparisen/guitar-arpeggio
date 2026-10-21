import { BODY } from "./config.js";
import type { TimbreName } from "./types.js";

/** 线性同余随机数，种子固定则输出固定（测试可复现） */
export function makeRng(seed0: number): () => number {
  let seed = seed0 >>> 0;
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
}

/**
 * 程序合成的琴体脉冲响应：模态 + 早期反射 + 噪声尾。
 *
 * 归一化用「直流增益」（冲激响应的和），不是峰值——按峰值归一会把整体
 * 放大 7 dB（一阶低通把能量摊到后面几个采样上，ir[0] 只有 0.45）。
 */
export function createBodyIR(ctx: BaseAudioContext, name: TimbreName): AudioBuffer {
  const sr = ctx.sampleRate;
  const T = BODY[name];
  const N = Math.floor(sr * 0.6);
  const buf = ctx.createBuffer(2, N, sr);

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    d[0] = 1;
    const jit = ch ? 1.043 : 1.0; // 左右轻微不同 → 有宽度但不糊

    for (const [f, t60, db] of T.modes) {
      const tau = t60 / 6.9;
      const amp = (Math.pow(10, (db * T.gain) / 20) * 2) / (tau * sr);
      const dec = Math.exp(-1 / (sr * tau));
      const w = (2 * Math.PI * f * jit) / sr;
      const sw = Math.sin(w);
      const cw = Math.cos(w);
      let s = Math.sin(ch ? 1.7 : 0);
      let co = Math.cos(ch ? 1.7 : 0);
      let env = amp;
      for (let i = 0; i < N; i++) {
        d[i] += env * s;
        const s2 = s * cw + co * sw;
        co = co * cw - s * sw;
        s = s2;
        env *= dec;
      }
    }

    for (const [ms, a] of T.taps) {
      const k = Math.floor((ms * sr) / 1000);
      if (k < N) d[k] += a * (ch ? 0.9 : 1);
    }

    const rnd = makeRng(77 + ch * 13);
    let nz = 0;
    for (let i = 0; i < N; i++) {
      nz = 0.88 * nz + 0.12 * (rnd() - 0.5);
      d[i] += T.tail * nz * Math.exp(-i / (sr * 0.05));
    }

    let sum = 0;
    for (let i = 0; i < N; i++) sum += d[i];
    const g0 = 1 / (sum || 1);
    for (let i = 0; i < N; i++) d[i] *= g0;

    const ah = Math.exp((-2 * Math.PI * T.hp) / sr);
    const al = Math.exp((-2 * Math.PI * T.lp) / sr);
    let xp = 0;
    let yp = 0;
    let lp = 0;
    for (let i = 0; i < N; i++) {
      const x = d[i];
      yp = ah * (yp + x - xp);
      xp = x;
      lp = (1 - al) * yp + al * lp;
      d[i] = lp;
    }
  }
  return buf;
}

/** AudioBuffer → 16-bit PCM WAV */
export function encodeWav(buf: AudioBuffer): Blob {
  const n = buf.length;
  const ch = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };

  str(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * ch * 2, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}
