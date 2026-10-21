/**
 * 实时 Karplus-Strong 弦（纯 DSP，不依赖 Web Audio）。
 *
 * 和 buffer 版的关键区别：延迟线长度可以在发声过程中改，所以推弦 / 滑音
 * 只改音高、不改时长。这一层独立于 AudioWorklet，可以直接在 Node 里测。
 */

export interface KsOptions {
  /** 衰减到 -60 dB 的时间（秒） */
  t60?: number;
  /** 环路阻尼 0（最亮）..1（最闷） */
  damping?: number;
  /** 拨弦位置 0..1，影响泛音结构 */
  pluck?: number;
  /** 激励的谐波滚降指数 */
  rolloff?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class KsString {
  readonly sampleRate: number;
  private ring: Float32Array;
  private mask: number;
  private w = 0;

  /** 当前环路的延迟长度（采样，含小数） */
  private delay: number;
  /** 目标延迟长度，用于滑音 */
  private target: number;
  /** 每次采样向目标靠近的比例（1 = 立即到位） */
  private glide = 1;

  private readonly damping: number;
  private readonly pluck: number;
  private readonly rolloff: number;
  private lp = 0;
  private gain: number;
  /** 揉弦：深度（比率）、每采样相位增量、起始延迟（采样） */
  private vibDepth = 0;
  private vibInc = 0;
  private vibAt = 0;
  private vibPhase = 0;
  private elapsed = 0;
  /** 环路的直流增益，用来算每周期的衰减 */
  private energy = 1;
  private running = true;

  constructor(sampleRate: number, frequency: number, opts: KsOptions = {}) {
    this.sampleRate = sampleRate;
    const t60 = opts.t60 ?? 2.0;
    this.damping = clamp(opts.damping ?? 0.5, 0, 0.95);
    this.pluck = clamp(opts.pluck ?? 0.2, 0.02, 0.98);
    this.rolloff = opts.rolloff ?? 1.25;

    // 环长得能装下最低音（40 Hz 周期约 1100 采样）
    const minPeriod = Math.ceil(sampleRate / 40) + 8;
    let size = 2048;
    while (size < minPeriod * 2) size <<= 1;
    this.ring = new Float32Array(size);
    this.mask = size - 1;

    this.delay = this.lengthFor(frequency);
    this.target = this.delay;

    // 每采样的环路增益：绕一圈（delay 个采样）后衰减到 -60 dB
    const perRound = Math.pow(0.001, 1 / (t60 * frequency));
    this.gain = Math.pow(perRound, 1 / this.delay);
    this.excite();
    // 写指针放到激励之后，读位置才会落在刚填好的那几个采样上
    this.w = Math.ceil(this.delay);
  }

  /** 滤波器本身有相位延迟，扣掉它，音高才准 */
  private get filterDelay(): number {
    const a = this.damping;
    return a < 0.99 ? a / (1 - a) : 0;
  }

  private lengthFor(frequency: number): number {
    return Math.max(4, this.sampleRate / frequency - this.filterDelay);
  }

  /** 用一次拨弦的初始位移填满环路，并归一化到和 buffer 路径同样的峰值 */
  private excite(): void {
    const n = Math.floor(this.delay);
    let seed = 20240521;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let k = 1; k <= 9; k++) {
        const amp = Math.pow(k, -this.rolloff) * Math.abs(Math.sin(Math.PI * k * this.pluck));
        v += amp * Math.sin((2 * Math.PI * k * i) / n + k * 0.7);
      }
      this.ring[i & this.mask] = v * 0.4 + rnd() * 0.02;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(this.ring[i & this.mask]));
    const g = 0.85 / (peak || 1);
    for (let i = 0; i < n; i++) this.ring[i & this.mask] *= g;
  }

  /** 立即或在 glide 秒内改音高 */
  setFrequency(frequency: number, glideSeconds = 0): void {
    this.target = this.lengthFor(clamp(frequency, 40, 4000));
    if (glideSeconds <= 0) {
      this.delay = this.target;
      this.glide = 1;
    } else {
      this.glide = 1 - Math.exp(-1 / (this.sampleRate * glideSeconds));
    }
  }

  /** 揉弦：音分、频率、延迟多少秒之后开始 */
  setVibrato(cents: number, hz: number, delaySec: number): void {
    this.vibDepth = Math.pow(2, cents / 1200) - 1;
    this.vibInc = (2 * Math.PI * hz) / this.sampleRate;
    this.vibAt = delaySec * this.sampleRate;
  }

  get finished(): boolean {
    return !this.running;
  }

  stop(): void {
    this.running = false;
  }

  /** 往 out 里写 len 个采样，返回是否已经静音 */
  render(out: Float32Array, offset: number, len: number): boolean {
    const a = this.damping;
    for (let i = 0; i < len; i++) {
      if (this.glide < 1) this.delay += (this.target - this.delay) * this.glide;

      // 揉弦按比例调制延迟长度（延迟越短音越高）
      let d = this.delay;
      if (this.vibDepth > 0) {
        this.elapsed++;
        if (this.elapsed > this.vibAt) {
          this.vibPhase += this.vibInc;
          d *= 1 + this.vibDepth * Math.sin(this.vibPhase);
        }
      }

      // 分数延迟：线性插值读取
      const pos = this.w - d;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = this.ring[i0 & this.mask];
      const s1 = this.ring[(i0 + 1) & this.mask];
      const x = s0 + (s1 - s0) * frac;

      this.lp = (1 - a) * x + a * this.lp;
      const y = this.lp * this.gain;
      this.ring[this.w & this.mask] = y;
      this.w++;

      out[offset + i] = y;
      this.energy = this.energy * 0.999 + Math.abs(y) * 0.001;
    }
    if (this.energy < 1e-5) {
      this.running = false;
      return false;
    }
    return true;
  }
}
