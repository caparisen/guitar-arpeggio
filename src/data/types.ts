import type { Tech } from "../engine/types.js";

/** [弦号, 品] + 可选的显示标签 / 技巧 / 显式时值 */
export type RawNote = readonly [number, number, string?, Tech?, number?];
/** [网格槽位, 该槽上的音] */
export type Event = readonly [number, RawNote[]];
/** [小节标签, 事件] */
export type Bar = readonly [string, Event[]];

export interface Card {
  id: number;
  title: string;
  en: string;
  sig: string;
  bpm: number;
  grid: number;
  /** 每小节多少个「拍」，用来算小节时长与重音位置 */
  units: number;
  star: string;
  /** 拍号单位记号，6/8 用附点四分 */
  beat?: string;
  prog: string;
  shapes: string;
  how: string;
  tips: readonly string[];
  bars: readonly Bar[];
  /** 注记行（扫弦方向等）：每小节 [(槽位, 文字)] */
  anno?: ReadonlyArray<ReadonlyArray<readonly [number, string]>>;
  /** 每格多少字符，默认 4 */
  w?: number;
}

export const barSec = (c: Card): number => (c.units * 60) / c.bpm;
