/** 引擎对外的数据契约。内容（谱子）和渲染（页面）都只依赖这里。 */

export type TimbreName = "steel" | "nylon";

/** 单个音上的演奏技巧。全部可选，缺省就是普通拨弦。 */
export interface Tech {
  /** 起音偏移（秒），扫弦/滚奏用来错开弦 */
  off?: number;
  /** 力度 0..1，覆盖默认的按弦序推算 */
  vel?: number;
  /** 1 = 闷音，2 = 切音 */
  mute?: number;
  /** >1 表示泛音，值是第几分音 */
  harm?: number;
  /** 相对空弦的半音偏移（泛音用） */
  semi?: number;
  /** 推弦：[半音数, 开始秒, 时长秒] */
  bend?: readonly [number, number, number];
  /** 预推弦：起音就在 +n 半音 */
  pre?: number;
  /** 释放开始的秒数（配合 pre） */
  relAt?: number;
  relDur?: number;
  /** 揉弦：[音分, 频率 Hz, 延迟秒] */
  vib?: readonly [number, number, number];
  /** 发声中途的音高跳变（勾弦 / 拉弦），相对音高的半音数 */
  steps?: ReadonlyArray<{ at: number; semi: number; glide?: number }>;
  /** 实时弦的衰减时间（秒），只对 worklet 路径有效 */
  t60?: number;
  /** 触发滑音噪声 */
  slide?: number;
}

/** [起音秒, MIDI, 弦号 1..6, 时值秒, 技巧, 力度] */
export type NoteTuple = [number, number, number, number, Tech | null, number];

export interface Pattern {
  id: number;
  title: string;
  en: string;
  sig: string;
  bpm: number;
  barSec: number;
  grid: number;
  units: number;
  bars: number;
  prog: string;
  how: string;
  notes: NoteTuple[];
}

/** 抽象掉 AudioContext 的创建，测试里可以换成假的。 */
export interface EngineHost {
  createContext(): AudioContext;
  createOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext;
}
