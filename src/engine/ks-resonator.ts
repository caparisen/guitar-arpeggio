/**
 * 被动谐振器：不是拨响的弦，是被别的弦/琴体「带着振」的空弦。
 *
 * 和 KsString 的区别是激励方式——它没有拨弦初始位移，外来的声音直接注入
 * 延迟线，靠环路增益把共振频率上的能量留住。琴桥就是这样驱动空弦的。
 */

export interface ResonatorOptions {
  /** 衰减到 -60 dB 的时间（秒） */
  t60?: number;
  /** 环路阻尼 0..0.95 */
  damping?: number;
  /** 输入注入量 0..1 */
  coupling?: number;
}

export class KsResonator {
  readonly frequency: number;
  private ring: Float32Array;
  private mask: number;
  private w: number;
  private readonly delay: number;
  private readonly damping: number;
  private readonly coupling: number;
  private readonly gain: number;
  private lp = 0;
  /** 环路里的直流阻断：低通的直流增益是 1，不挡的话直流会一直转下去 */
  private dcX = 0;
  private dcY = 0;
  /** 收尾包络：输入停了 0.2 秒之后开始指数衰减，保证一定会静下来 */
  private env = 1;
  private silent = 0;
  private readonly dec: number;
  private readonly sr: number;

  constructor(sampleRate: number, frequency: number, opts: ResonatorOptions = {}) {
    this.frequency = frequency;
    this.damping = Math.min(0.95, Math.max(0, opts.damping ?? 0.35));
    this.coupling = Math.min(1, Math.max(0, opts.coupling ?? 0.02));

    let size = 2048;
    while (size < (sampleRate / 40) * 2) size <<= 1;
    this.ring = new Float32Array(size);
    this.mask = size - 1;

    // 一阶低通有相位延迟，扣掉它音才准
    const filterDelay = this.damping / (1 - this.damping);
    this.delay = Math.max(4, sampleRate / frequency - filterDelay);
    this.w = Math.ceil(this.delay);

    const t60 = opts.t60 ?? 1.2;
    const perRound = Math.pow(0.001, 1 / (t60 * frequency));
    this.gain = Math.pow(perRound, 1 / this.delay);
    this.sr = sampleRate;
    this.dec = Math.exp(-1 / (sampleRate * (t60 / 6.9)));
  }

  /** 把 input（可为空）驱动下的共振，累加进 out */
  process(input: Float32Array | null, out: Float32Array): void {
    const a = this.damping;
    for (let i = 0; i < out.length; i++) {
      const pos = this.w - this.delay;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = this.ring[i0 & this.mask];
      const s1 = this.ring[(i0 + 1) & this.mask];
      const x = s0 + (s1 - s0) * frac;

      this.lp = (1 - a) * x + a * this.lp;
      // 一阶高通（DC blocker），否则直流分量在环里永不停
      const dc = this.lp - this.dcX + 0.995 * this.dcY;
      this.dcX = this.lp;
      this.dcY = dc;
      const y = dc * this.gain;
      const drive = input ? input[i] * this.coupling : 0;
      this.ring[this.w & this.mask] = y + drive;
      this.w++;

      // 输入持续时 env 保持 1；静音 0.2 秒后开始收尾，避免环路的慢尾音拖太久
      if (drive !== 0) {
        this.env = 1;
        this.silent = 0;
      } else if (++this.silent > this.sr * 0.2) {
        this.env *= this.dec;
      }
      out[i] += y * this.env;
    }
  }
}
