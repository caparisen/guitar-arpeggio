import type { TimbreName } from "./types.js";

/** 标准调弦，6 弦到 1 弦的 MIDI 编号 */
export const TUNING: Readonly<Record<number, number>> = { 6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64 };

/** 每个音高×弦号生成几份变体，播放时轮换，避免重复音逐位相同 */
export const VARIANTS = 3;

/** buffer 缓存上限（单声道 2 秒约 0.35 MB） */
export const BUF_LIMIT = 160;

export interface TimbreSpec {
  name: string;
  tauMul: number;
  harm: number;
  floor: number;
  loop: number;
  pluck: number;
  detune: number;
  damp2: number;
  attackDecay: number;
  tauStr: Readonly<Record<number, number>>;
}

export const TIMBRE: Readonly<Record<TimbreName, TimbreSpec>> = {
  steel: {
    name: "钢弦",
    tauMul: 1.0,
    harm: 1.25,
    floor: 0.045,
    loop: 0.5,
    pluck: 0.17,
    detune: 0.002,
    damp2: 0.42,
    attackDecay: 0.0045,
    tauStr: { 6: 1.15, 5: 1.1, 4: 1.05, 3: 1.0, 2: 0.95, 1: 0.9 },
  },
  nylon: {
    name: "尼龙",
    tauMul: 0.78,
    harm: 1.55,
    floor: 0.03,
    loop: 0.62,
    pluck: 0.21,
    detune: 0.0014,
    damp2: 0.55,
    attackDecay: 0.0032,
    tauStr: { 6: 1.05, 5: 1.0, 4: 0.95, 3: 0.74, 2: 0.9, 1: 0.85 },
  },
};

export interface BodySpec {
  /** [频率 Hz, T60 秒, 目标峰值 dB] */
  modes: ReadonlyArray<readonly [number, number, number]>;
  /** [毫秒, 幅度] 早期反射 */
  taps: ReadonlyArray<readonly [number, number]>;
  hp: number;
  lp: number;
  tail: number;
  /** 模态强度缩放（dB 域的乘数） */
  gain: number;
}

export const BODY: Readonly<Record<TimbreName, BodySpec>> = {
  steel: {
    modes: [
      [98, 0.12, 10], [196, 0.11, 8], [255, 0.1, 6], [340, 0.09, 5], [470, 0.08, 3.6],
      [620, 0.07, 2.6], [840, 0.06, 1.8], [1150, 0.05, 1.0], [1620, 0.04, 0],
      [2350, 0.03, -1.5], [3200, 0.025, -3], [4600, 0.02, -5],
    ],
    taps: [[1.7, 0.18], [3.1, -0.14], [4.6, 0.11], [6.9, -0.08], [9.2, 0.06]],
    hp: 70, lp: 5800, tail: 0.01, gain: 0.55,
  },
  nylon: {
    modes: [
      [105, 0.16, 11], [185, 0.15, 9], [250, 0.13, 7], [330, 0.11, 5.5], [430, 0.1, 4],
      [560, 0.085, 2.8], [740, 0.07, 2.0], [1020, 0.06, 1.0], [1450, 0.045, 0],
      [2050, 0.035, -2], [2900, 0.028, -4.5], [3900, 0.022, -7],
    ],
    taps: [[2.1, 0.15], [3.8, -0.12], [5.4, 0.1], [7.6, -0.07], [10.4, 0.05]],
    hp: 65, lp: 4200, tail: 0.012, gain: 0.58,
  },
};

/** 琴体是并联送音，不是替换干声 */
export const BODY_SEND = 0.5;
/** 主音量，给和弦叠加留 2 dB 余量 */
export const MASTER_GAIN = 0.8;
