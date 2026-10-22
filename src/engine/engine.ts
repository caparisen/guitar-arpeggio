import { BODY_SEND, MASTER_GAIN, TIMBRE, VARIANTS } from "./config.js";
import { encodeWav } from "./dsp.js";
import { createSympatheticNode, loadKsWorklet, loadSympatheticWorklet } from "./worklet/index.js";
import { VoiceBank } from "./voice.js";
import type { EngineHost, Pattern, Tech, TimbreName } from "./types.js";

interface Graph {
  comp: DynamicsCompressorNode;
  master: GainNode;
  busIn: GainNode;
  conv: ConvolverNode;
  wet: GainNode;
  dry: GainNode;
}

interface RingEntry {
  src: AudioBufferSourceNode | null;
  param: AudioParam;
  end: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 共鸣弦的总线电平：单根弦在共振点上约输出输入的 66%，乘这个值约 -22 dB */
const SYM_LEVEL = 0.22;

/**
 * 发声引擎。不碰 DOM：所有状态通过方法设置，方便在 Node 里跑测试。
 */
export class Engine {
  private readonly host: EngineHost;
  private ctx: AudioContext | OfflineAudioContext | null = null;
  private graph: Graph | null = null;
  private readonly bank = new VoiceBank();
  private speed = 1;
  private bodyOn = true;
  /** 所有还在图上的节点。stop() 必须把它们摘掉，否则每次重播都在泄漏 */
  private activeNodes = new Set<AudioNode>();
  private ring = new Map<number, RingEntry>();
  private offline = false;
  /** 实时弦（AudioWorklet）是否可用；不可用时自动退回 buffer */
  private liveReady = false;
  private liveNodes: AudioWorkletNode[] = [];
  /** 排过的播放区间，用于播放指针；stop() 清空 */
  private timeline: Array<{ pattern: Pattern; start: number; duration: number; speed: number }> = [];
  /** 共鸣弦：总线上的并联支路 */
  private symNode: AudioWorkletNode | null = null;
  private symGain: GainNode | null = null;
  private symOn = true;

  constructor(host: EngineHost) {
    this.host = host;
  }

  get context(): AudioContext | OfflineAudioContext | null {
    return this.ctx;
  }

  get timbre(): TimbreName {
    return this.bank.current;
  }

  get liveCount(): number {
    return this.liveNodes.length;
  }

  /** 当前挂在音频图上的节点数；正常应当在 stop() 之后归零 */
  get activeNodeCount(): number {
    return this.activeNodes.size;
  }

  get sympatheticReady(): boolean {
    return this.symNode !== null;
  }

  get bufferCount(): number {
    return this.bank.size;
  }

  setTimbre(name: TimbreName): void {
    this.bank.setTimbre(name);
    if (this.graph && this.ctx) this.graph.conv.buffer = this.bank.body(this.ctx);
  }

  setBody(on: boolean): void {
    this.bodyOn = on;
    this.applyBody();
  }

  setSpeed(x: number): void {
    this.speed = clamp(x, 0.25, 2);
  }

  /** 建（或取）AudioContext 与总线 */
  private ensure(): AudioContext | OfflineAudioContext {
    if (!this.ctx) {
      this.ctx = this.host.createContext();
      this.graph = this.buildGraph(this.ctx);
      this.applyBody();
    }
    if (!this.offline && this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private buildGraph(c: BaseAudioContext): Graph {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 3;

    const master = c.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(comp);
    comp.connect(c.destination);

    // 琴体总线：所有弦先混到这里，再并联干声 / 琴体
    const busIn = c.createGain();
    const conv = c.createConvolver();
    conv.normalize = false;
    const wet = c.createGain();
    const dry = c.createGain();
    busIn.connect(conv);
    conv.connect(wet);
    wet.connect(master);
    busIn.connect(dry);
    dry.connect(master);
    conv.buffer = this.bank.body(c);
    return { comp, master, busIn, conv, wet, dry };
  }

  private applyBody(): void {
    const g = this.graph;
    if (!g) return;
    g.wet.gain.value = this.bodyOn ? BODY_SEND : 0;
    g.dry.gain.value = 1;
  }

  /**
   * 尝试加载 AudioWorklet。失败不影响播放——推弦会退回 buffer 路径
   * （代价是变调同时变快）。
   */
  async prepare(): Promise<boolean> {
    if (this.liveReady) return true;
    const c = this.ensure();
    if (!("audioWorklet" in c)) return false;
    try {
      await loadKsWorklet(c as AudioContext);
      this.liveReady = true;
      // 共鸣弦是可选增强：加载失败就当作没有
      try {
        await loadSympatheticWorklet(c as AudioContext);
        this.attachSympathetic();
      } catch {
        this.symNode = null;
      }
      return true;
    } catch {
      this.liveReady = false;
      return false;
    }
  }

  /** 把共鸣弦挂到总线上（并联，不影响干声与琴体） */
  private attachSympathetic(): void {
    const c = this.ctx;
    const g = this.graph;
    if (!c || !g || this.symNode || !("audioWorklet" in c)) return;
    try {
      const node = createSympatheticNode(c as AudioContext);
      const gain = c.createGain();
      gain.gain.value = this.symOn ? SYM_LEVEL : 0;
      g.busIn.connect(node);
      node.connect(gain);
      gain.connect(g.master);
      this.symNode = node;
      this.symGain = gain;
    } catch {
      this.symNode = null;
    }
  }

  setSympathetic(on: boolean): void {
    this.symOn = on;
    if (this.symGain) this.symGain.gain.value = on ? SYM_LEVEL : 0;
  }

  /** 把一条音的整串节点从图上摘掉 */
  private release(nodes: readonly AudioNode[]): void {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* 已经断开 */
      }
      this.activeNodes.delete(n);
    }
  }

  stop(): void {
    for (const n of this.activeNodes) {
      const src = n as AudioScheduledSourceNode;
      if (typeof src.stop === "function") {
        try {
          src.stop();
        } catch {
          /* 已经停了 */
        }
      }
    }
    for (const n of this.activeNodes) {
      try {
        n.disconnect();
      } catch {
        /* 已经断开 */
      }
    }
    this.activeNodes.clear();
    this.liveNodes = [];
    this.ring.clear();
    this.timeline = [];
  }

  /** 排一条谱，返回时长（秒） */
  play(pattern: Pattern, at?: number): number {
    const c = this.ensure();
    const start = at ?? c.currentTime + 0.12;
    this.schedule(pattern, start);
    const dur = (pattern.barSec * pattern.bars) / this.speed;
    const now = c.currentTime;
    this.timeline = this.timeline.filter(s => s.start + s.duration > now - 1);
    this.timeline.push({ pattern, start, duration: dur, speed: this.speed });
    return dur;
  }

  /**
   * 当前播放位置；没在播时返回 null。
   * bar 从 0 开始，slot 是当前十六分格（0..grid-1）。
   */
  get position(): { pattern: Pattern; bar: number; slot: number } | null {
    const c = this.ctx;
    if (!c) return null;
    const now = c.currentTime;
    const span = this.timeline.find(s => now >= s.start && now < s.start + s.duration);
    if (!span) return null;
    const t = Math.max(0, (now - span.start) * span.speed);
    const bar = Math.min(span.pattern.bars - 1, Math.floor(t / span.pattern.barSec));
    const slotSec = span.pattern.barSec / span.pattern.grid;
    const slot = Math.min(span.pattern.grid - 1, Math.floor((t % span.pattern.barSec) / slotSec));
    return { pattern: span.pattern, bar, slot };
  }

  private schedule(p: Pattern, at: number): void {
    const c = this.ctx;
    const g = this.graph;
    if (!c || !g) return;
    const sp = this.speed;

    for (const n of p.notes) {
      const [on, midi, str, rawDur, techRaw, rawVel] = n;
      const tech: Tech = techRaw ?? {};
      const dur = rawDur / sp;
      const vel = clamp((rawVel || 0.85) * (0.97 + Math.random() * 0.06), 0.4, 1);
      const jit = (Math.random() - 0.5) * 0.01;
      const t = at + on / sp + jit;
      const variant = (Math.random() * VARIANTS) | 0;
      const harm = tech.harm ?? 1;
      const mute = tech.mute ?? 0;
      const hold = mute ? (mute === 2 ? 0.06 : 0.1) : Math.max(0.08, dur);

      // 同一根弦被重新拨响：前一个音先止住，否则连扫会糊
      const prev = this.ring.get(str);
      if (prev && prev.end > t + 0.02) {
        try {
          const cut = Math.max(0, t - 0.02);
          prev.param.cancelScheduledValues(cut);
          prev.param.setTargetAtTime(0.0001, cut, 0.008);
          prev.src?.stop(t + 0.05);
        } catch {
          /* 已经停了 */
        }
      }

      // 这一条音用到的所有节点，结束时统一摘掉
      const chain: AudioNode[] = [];

      // 带音高自动化的音走实时弦：推弦只改音高、不改时长
      const wantsLive = Boolean(tech.bend ?? tech.pre ?? tech.vib ?? tech.steps);
      const useLive = wantsLive && this.liveReady && !this.offline && "audioWorklet" in c;
      let src: AudioBufferSourceNode | null = null;
      let live: AudioWorkletNode | null = null;

      if (useLive) {
        live = new AudioWorkletNode(c as AudioContext, "ks-voice", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        const bend = tech.pre != null
          ? { from: tech.pre, to: 0, delay: tech.relAt ?? 0, dur: tech.relDur ?? 0.3 }
          : tech.bend
            ? { from: 0, to: tech.bend[0], delay: tech.bend[1], dur: tech.bend[2] }
            : { from: 0, to: 0, delay: 0, dur: 0.001 };
        // 起音相对当前时刻的延迟：定时器必须用它做基准，否则排在后面的音
        // 会在还没开始的时候就被断开
        const at = Math.max(0, t - c.currentTime);
        live.port.postMessage({
          type: "note",
          freq: 440 * Math.pow(2, (midi - 69) / 12),
          at,
          t60: tech.t60 ?? 2,
          damping: 0.45,
          pluck: TIMBRE[this.bank.current].pluck,
          bend,
          vib: tech.vib ? { cents: tech.vib[0], hz: tech.vib[1], delay: tech.vib[2] } : undefined,
          steps: tech.steps,
        });
        this.liveNodes.push(live);
        this.activeNodes.add(live);
        chain.push(live);
        setTimeout(() => {
          this.release(chain);
          const i = this.liveNodes.indexOf(live!);
          if (i >= 0) this.liveNodes.splice(i, 1);
        }, (at + hold + 2) * 1000);
      } else {
        const bs = c.createBufferSource();
        bs.buffer = this.bank.note(c, midi, str, variant, harm);
        this.applyTech(c, bs, tech, t, dur);
        src = bs;
      }

      const gn = c.createGain();
      chain.push(gn);
      const amp = (0.28 + 0.42 * vel) * (mute === 2 ? 0.8 : 1) * (harm > 1 ? 0.72 : 1);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(amp, t + 0.006);
      gn.gain.setTargetAtTime(0.0001, t + hold, mute ? 0.015 : 0.035);

      // 力度 → 亮度
      const hs = c.createBiquadFilter();
      hs.type = "highshelf";
      hs.frequency.value = 2200;
      hs.gain.value = (vel - 0.85) * 22;
      chain.push(hs);

      const pan = c.createStereoPanner();
      pan.pan.value = (3.5 - str) * 0.04;
      chain.push(pan);

      if (live) live.connect(hs);
      if (src) src.connect(hs);
      if (mute) {
        // 掌根压琴桥：先砍高频，再砍延音
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = mute === 2 ? 700 : 1100;
        lp.Q.value = 0.7;
        chain.push(lp);
        hs.connect(lp);
        lp.connect(gn);
      } else {
        hs.connect(gn);
      }
      gn.connect(pan);
      pan.connect(g.busIn);
      if (src) {
        src.start(t);
        src.stop(t + Math.max(0.12, hold) + 0.45);
        this.activeNodes.add(src);
        chain.push(src);
        // 音源一停就把整串节点摘掉，不然播完了还挂在图上
        src.onended = () => this.release(chain);
        this.ring.set(str, { src, param: gn.gain, end: t + hold + 0.15 });
      } else {
        // 实时弦：靠增益包络收尾，节点由上面的定时器断开
        this.ring.set(str, { src: null, param: gn.gain, end: t + hold + 0.15 });
      }

      // 拨片噪声：力度就是这个音的「手指力度」
      const pn = c.createBufferSource();
      pn.buffer = this.bank.pick(c, variant);
      const pg = c.createGain();
      pg.gain.value = (0.02 + 0.16 * vel * vel) * (mute ? 1.5 : 1) * (harm > 1 ? 0.25 : 1);
      pn.connect(pg);
      pg.connect(pan);
      pn.start(t);
      pn.stop(t + 0.07);
      this.activeNodes.add(pn);
      chain.push(pn, pg);

      // 勾弦的撞击声：手指砸到品丝上，很短很轻（实时弦和 buffer 路径都要）
      if (tech.steps) {
        for (const st of tech.steps) {
          const hn = c.createBufferSource();
          hn.buffer = this.bank.pick(c, variant);
          const hg = c.createGain();
          hg.gain.value = 0.02 + 0.05 * vel;
          hn.connect(hg);
          hg.connect(pan);
          hn.start(t + st.at);
          hn.stop(t + st.at + 0.05);
          this.activeNodes.add(hn);
          chain.push(hn, hg);
        }
      }

      // 滑音噪声
      if (tech.slide) {
        const sq = c.createBufferSource();
        sq.buffer = this.bank.squeak(c);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1500 + Math.random() * 700;
        bp.Q.value = 1.1;
        const sg = c.createGain();
        sg.gain.value = 0.035 + Math.random() * 0.02;
        sq.connect(bp);
        bp.connect(sg);
        sg.connect(pan);
        const len = tech.bend ? tech.bend[2] : 0.3;
        sq.start(t + 0.02);
        sq.stop(t + 0.02 + Math.min(0.5, len + 0.12));
        this.activeNodes.add(sq);
        chain.push(sq, bp, sg);
      }
    }
  }

  /** 推弦 / 揉弦：都是 playbackRate 的自动化 */
  private applyTech(
    c: BaseAudioContext,
    src: AudioBufferSourceNode,
    tech: Tech,
    t: number,
    dur: number,
  ): void {
    const pr = src.playbackRate;

    if (tech.pre != null) {
      const up = Math.pow(2, tech.pre / 12);
      pr.setValueAtTime(up, t);
      if (tech.relAt != null) {
        pr.setValueAtTime(up, t + tech.relAt);
        pr.linearRampToValueAtTime(1, t + tech.relAt + (tech.relDur ?? 0.3));
      }
    } else if (tech.bend) {
      const [semis, at, len] = tech.bend;
      pr.setValueAtTime(1, t);
      pr.setValueAtTime(1, t + at);
      pr.linearRampToValueAtTime(Math.pow(2, semis / 12), t + at + len);
    }

    // 勾弦/拉弦：buffer 路径没有 AudioWorklet，用 playbackRate 的跳变模拟。
    // steps 里的 semi 是相对原音的绝对半音数（和实时弦一致），不是累加。
    if (tech.steps?.length) {
      for (const st of tech.steps) {
        const rate = Math.pow(2, st.semi / 12);
        const at = t + st.at;
        if (st.glide && st.glide > 0) pr.linearRampToValueAtTime(rate, at + st.glide);
        else pr.setValueAtTime(rate, at);
      }
    }

    if (tech.vib) {
      const [cents, hz, at] = tech.vib;
      const lfo = c.createOscillator();
      const g = c.createGain();
      lfo.type = "sine";
      lfo.frequency.value = hz;
      const depth = Math.pow(2, cents / 1200) - 1;
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(depth, t + at + 0.25);
      lfo.connect(g);
      g.connect(pr);
      lfo.start(t);
      lfo.stop(t + dur + 0.4);
      this.activeNodes.add(lfo);
    }
  }

  /** 后台分片预热，避免第一次播放卡顿 */
  warm(patterns: readonly Pattern[]): void {
    this.ensure();
    const want = this.bank.current;
    const seen = new Set<string>();
    const jobs: Array<[number, number, number]> = [];
    for (const p of patterns) {
      for (const n of p.notes) {
        const harm = n[4]?.harm ?? 1;
        const key = `${n[1]}|${n[2]}|${harm}`;
        if (!seen.has(key)) {
          seen.add(key);
          jobs.push([n[1], n[2], harm]);
        }
      }
    }
    let i = 0;
    let v = 0;
    const step = (): void => {
      if (this.bank.current !== want) return;
      const c = this.ctx;
      if (!c) return;
      const t0 = performance.now();
      while (i < jobs.length && performance.now() - t0 < 10) {
        const j = jobs[i];
        this.bank.note(c, j[0], j[1], v, j[2]);
        v++;
        if (v >= VARIANTS) {
          v = 0;
          i++;
        }
      }
      if (i < jobs.length) setTimeout(step, 16);
    };
    step();
  }

  /** 离线渲染一条谱，给导出 WAV 用 */
  async render(pattern: Pattern): Promise<AudioBuffer> {
    this.ensure();
    const sr = 44100;
    const dur = (pattern.barSec * pattern.bars) / this.speed + 2;
    const oc = this.host.createOffline(2, Math.ceil(dur * sr), sr);

    const savedCtx = this.ctx;
    const savedGraph = this.graph;
    const savedRing = new Map(this.ring);
    const savedActive = this.activeNodes;

    try {
      this.ctx = oc;
      this.graph = null;
      this.activeNodes = new Set();
      this.ring = new Map();
      this.offline = true;

      this.graph = this.buildGraph(oc);
      this.applyBody();
      this.schedule(pattern, 0.05);
      return await oc.startRendering();
    } finally {
      this.offline = false;
      this.ctx = savedCtx;
      this.graph = savedGraph;
      this.ring = savedRing;
      this.activeNodes = savedActive;
    }
  }

  static encodeWav(buf: AudioBuffer): Blob {
    return encodeWav(buf);
  }
}
