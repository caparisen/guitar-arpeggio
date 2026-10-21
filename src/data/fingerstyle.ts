import type { Tech } from "../engine/types.js";
import type { Bar, Card, Event, RawNote } from "./patterns.js";

const E = (slot: number, ...notes: RawNote[]): Event => [slot, notes];

/** 72 BPM、4/4：一个十六分音符多长（秒） */
const SLOT_SEC = 60 / 72 / 4;

/** [槽位, 弦, 品] */
type Bass = readonly [number, number, number];
/** [槽位, 品, 时值(槽), 技巧, 指定弦, 显示标签] */
type Mel = readonly [number, number, number, Tech?, number?, string?];

interface BarSpec {
  chord: string;
  bass: readonly Bass[];
  mel: readonly Mel[];
}

/**
 * 12 小节，A 小调，4/4。
 * 低音走 A–G–F–E–D–A–E–A，旋律在 1 弦。
 */
const PIECE: readonly BarSpec[] = [
  {
    chord: "Am",
    bass: [[0, 5, 0], [4, 4, 2], [8, 5, 0], [12, 4, 2]],
    mel: [[2, 12, 2], [6, 10, 2], [10, 8, 2], [14, 7, 2]],
  },
  {
    chord: "Am/G",
    bass: [[0, 6, 3], [4, 4, 0], [8, 6, 3], [12, 4, 0]],
    mel: [[2, 5, 6], [10, 7, 2], [14, 8, 2]],
  },
  {
    chord: "F",
    bass: [[0, 6, 1], [4, 5, 3], [8, 6, 1], [12, 5, 3]],
    mel: [[2, 8, 6], [10, 7, 2], [14, 5, 2]],
  },
  {
    chord: "C/E",
    bass: [[0, 6, 0], [4, 5, 3], [8, 6, 0], [12, 5, 3]],
    mel: [[2, 3, 6], [10, 5, 2], [14, 7, 2]],
  },
  {
    chord: "Dm",
    bass: [[0, 5, 5], [4, 5, 0], [8, 5, 5], [12, 5, 0]],
    mel: [[2, 10, 4], [8, 8, 2], [12, 5, 2], [14, 3, 2]],
  },
  {
    chord: "Am",
    bass: [[0, 5, 0], [4, 4, 2], [8, 5, 0], [12, 6, 0]],
    mel: [[2, 5, 10], [14, 8, 2]],
  },
  {
    chord: "E7",
    bass: [[0, 6, 0], [4, 5, 2], [8, 6, 0], [12, 5, 2]],
    mel: [[2, 4, 4], [8, 7, 4], [14, 8, 2]],
  },
  {
    chord: "Am",
    bass: [[0, 5, 0], [4, 4, 2], [8, 5, 0], [12, 4, 2]],
    // 结尾的揉弦：长音在 1 弦 5 品
    mel: [[2, 5, 12, { vib: [20, 5.4, 0.5], t60: 3.5 }]],
  },
  {
    chord: "泛音",
    bass: [],
    // 12 品泛音：4/3/2/1 弦 → D4 G4 B4 E5
    mel: [
      [0, 12, 4, { harm: 2, semi: 12 }],
      [4, 12, 4, { harm: 2, semi: 12 }],
      [8, 12, 4, { harm: 2, semi: 12 }],
      [12, 12, 4, { harm: 2, semi: 12 }],
    ],
  },
  {
    chord: "泛音",
    bass: [],
    // 7 品泛音：A5 E5 B4，比 12 品更亮
    // 7 品泛音挑弦：2 弦的 7 品泛音是 F#，A 小调里不能要
    mel: [
      [0, 12, 4, { harm: 2, semi: 12 }, 6],
      [4, 12, 4, { harm: 2, semi: 12 }, 5],
      [8, 7, 4, { harm: 3, semi: 19 }, 4],
      [12, 7, 4, { harm: 3, semi: 19 }, 3],
    ],
  },
  {
    chord: "勾弦滑音",
    bass: [[0, 5, 0], [8, 4, 2]],
    mel: [
      // 5h7h8：两次勾弦，不重新拨弦
      [0, 5, 12, { steps: [{ at: 0.35, semi: 2 }, { at: 0.7, semi: 3 }], t60: 3.5 }, 1, "5h7"],
      // 8/12：从 8 品滑到 12 品
      [10, 8, 6, { bend: [4, 0.05, 0.35], slide: 1, t60: 3.5 }, 1, "8/12"],
    ],
  },
  {
    chord: "推弦揉弦",
    bass: [[0, 5, 0], [4, 4, 2], [8, 6, 0], [12, 5, 2]],
    mel: [
      // 5 品推全音到 7 品，再揉弦
      [0, 5, 10, { bend: [2, 0.25, 0.45], vib: [32, 5.6, 1.1], t60: 4 }, 1, "5b7"],
      // 最后一拍滚和弦
      [12, 5, 2, { off: 0, t60: 2 }],
    ],
  },
];

function buildBar(spec: BarSpec): Bar {
  const events: Event[] = [];
  for (const [slot, s, f] of spec.bass) events.push(E(slot, [s, f]));

  // 泛音依次落在 4/3/2/1 弦，普通旋律都在 1 弦
  const harmStrings = [4, 3, 2, 1];
  let h = 0;
  for (const [slot, fret, dur, tech, forced, label] of spec.mel) {
    const s = forced ?? (tech?.harm ? harmStrings[Math.min(3, h++)] : 1);
    // dur 是槽数，这里换成秒；单音 buffer 只有 2 秒，长音封顶 1.9
    const durSec = Math.min(1.9, dur * SLOT_SEC);
    events.push(E(slot, [s, fret, label, tech ?? {}, durSec]));
  }

  // 最后一小节补一个滚和弦收尾
  if (spec.chord === "推弦揉弦") {
    const chord: Array<[number, number]> = [[5, 0], [4, 2], [3, 2], [2, 1], [1, 0]];
    chord.forEach(([s, f], i) => {
      const tech: Tech = { off: i * 0.05, vel: 0.8 - i * 0.02 };
      events.push(E(12, [s, f, undefined, tech, 2]));
    });
  }
  return [spec.chord, events];
}

export const FINGERSTYLE_CARD: Card = {
  id: 15,
  title: "指弹小品：A 小调",
  en: "fingerstyle étude in A minor",
  sig: "4/4",
  bpm: 72,
  grid: 16,
  units: 4,
  star: "★★★",
  prog: "Am – Am/G – F – C/E ｜ Dm – Am – E7 – Am ｜ 泛音 ｜ 勾弦滑音 ｜ 推弦揉弦",
  shapes: "低音走 A–G–F–E–D–A–E–A ｜ 旋律在 1 弦 5–13 品",
  how: "低音部是拇指的交替低音（根音↔五度），高音部旋律用手指，两条线各走各的。第 9、10 小节换成泛音，第 11 小节勾弦加滑音，最后推全音再揉。",
  tips: [
    "先只弹低音：A–G–F–E–D–A–E–A，把这条线弹成一条能唱的旋律。",
    "旋律进来后，拇指不要跟着旋律走——它的落点永远在 1、3 拍。",
    "第 8 小节的揉弦是整首唯一「不弹新音」的地方，让它响完再进泛音。",
    "第 9、10 小节泛音换弦时左手整体抬起再落下，别蹭到弦。",
    "第 11 小节 5h7h8 是两次勾弦，中间绝对不能松开左手；紧接着 8/12 是一个滑音。",
    "最后推弦推到顶之后揉两下，再让滚和弦收尾。",
  ],
  anno: [
    [], [], [], [], [], [], [], [],
    [[0, "Harm"]],
    [[0, "Harm"]],
    [[0, "h"], [10, "/"]],
    [[0, "bend"], [12, "roll"]],
  ],
  bars: PIECE.map(buildBar),
};

export const ALL_CARDS = FINGERSTYLE_CARD;
