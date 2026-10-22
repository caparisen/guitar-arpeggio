import type { Bar, Card, Event, RawNote } from "./data/types.js";
import type { Tech } from "./engine/types.js";

/**
 * 把 `cardAscii()` 的输出解析回 `Card`。
 *
 * 支持：
 *   - `cardAscii()` 的 `#` 文件头（id/title/sig/bpm/grid/units/beat/w/star/prog/shapes/how/tip）；
 *   - 一小节一块（cardAscii 默认），也支持 renderBlock 的「一行多小节」；
 *   - 六线谱的弦/品/槽位、手写标签（7/8~、10\7、8b10、3h5p3~、7*、x）；
 *   - 可选的 ano 注记行和 d 力度行；
 *   - `~` / `/` / `\` / `b` / `h` / `p` / `*` / `x` 还原成近似 Tech。
 *
 * 不能从 ASCII 还原的信息（音符级，按设计舍弃）：
 *   - 精确时值（按同一根弦的下一次拨响推断）；
 *   - 精确力度（只有 d 行时按 pp..ff 近似）；
 *   - 揉弦的精确音分/频率、推弦/勾弦的精确时间（用默认值）；
 *   - `off`、`t60`、`rel`、`mute` 的真实品位。
 * opts 里的字段优先于文件头，用于覆盖。
 */
export interface ParseOptions {
  id?: number;
  title?: string;
  en?: string;
  sig?: string;
  bpm?: number;
  grid?: number;
  units?: number;
  beat?: string;
  w?: number;
  star?: string;
  prog?: string;
  shapes?: string;
  how?: string;
  tips?: readonly string[];
}

const STRING_OF: Readonly<Record<string, number>> = { e: 1, B: 2, G: 3, D: 4, A: 5, E: 6 };
const VEL_OF: Readonly<Record<string, number>> = { ff: 1, f: 0.9, mf: 0.8, mp: 0.7, p: 0.6, pp: 0.5 };
const STRING_ROW = /^[eBGDAE] \|/;
const DP_ROW = /^[dp] \|/;

const fail = (msg: string): never => {
  throw new Error(`parseAscii: ${msg}`);
};

const round = (x: number): number => Number(x.toFixed(4));

/** 从 5b7 / 8b10 / (5)b7 / 7/8 / 10\7 / 3h5p3 / 7* / x 里还原一个音 */
function parseNote(string: number, label: string, vel: number | undefined): RawNote {
  const tech: Tech = {};
  if (vel != null) tech.vel = vel;

  if (label === "x" || label === "X") {
    tech.mute = 1;
    return [string, 0, label, tech];
  }

  let fret: number;
  let rest = label;

  // 预推弦 (5)b7
  const preBend = /^\((\d+)\)b(\d+)/.exec(label);
  if (preBend) {
    fret = Number(preBend[1]);
    tech.pre = Number(preBend[2]) - fret;
    tech.relAt = 0.75;
    tech.relDur = 0.4;
    if (label.includes("~")) tech.vib = [18, 5.2, 0.35];
    return [string, fret, label, tech];
  }

  const head = /^(\d+)/.exec(label);
  if (!head) return fail(`无法识别的音符标签「${label}」`);
  fret = Number(head[1]);
  rest = label.slice(head[1].length);

  // 上滑 7/8：7 是起点、8 是目标；RawNote 的音高写目标，pre 记起点偏移
  const slash = /^\/\s*(\d+)/.exec(rest);
  if (slash) {
    const target = Number(slash[1]);
    tech.pre = fret - target;
    fret = target;
    tech.relAt = 0.015;
    tech.relDur = 0.1;
    tech.slide = 1;
  }

  // 下滑 / 先推后放 10\7：10 是起点、7 是目标
  const back = /^\\\s*(\d+)/.exec(rest);
  if (back) {
    const target = Number(back[1]);
    tech.pre = fret - target;
    fret = target;
    tech.relAt = 0.02;
    tech.relDur = 0.12;
    tech.slide = 1;
  }

  // 推弦 8b10
  const bend = /^b\s*(\d+)/.exec(rest);
  if (bend) {
    tech.bend = [Number(bend[1]) - fret, 0.25, 0.15];
    tech.slide = 1;
  }

  // 勾/拉弦 3h5p3：把 h/p 链还原成 steps
  if (/[hp]/.test(rest)) {
    const seq = rest.match(/\d+|[hp]/g) ?? [];
    const steps: Array<{ at: number; semi: number }> = [];
    for (let i = 0; i + 1 < seq.length; i += 2) {
      const dir = seq[i];
      const target = Number(seq[i + 1]);
      if ((dir !== "h" && dir !== "p") || !Number.isFinite(target)) continue;
      steps.push({ at: round(0.28 * (steps.length + 1)), semi: target - fret });
    }
    if (steps.length) tech.steps = steps;
  }

  // 泛音 12* / 7* / 5*
  if (label.includes("*")) {
    tech.harm = fret === 12 ? 2 : fret === 7 ? 3 : fret === 5 ? 4 : 2;
    tech.semi = fret === 12 ? 12 : fret === 7 ? 19 : fret === 5 ? 24 : 12;
  }

  if (label.includes("~")) tech.vib = [18, 5.2, 0.35];
  return [string, fret, label, tech];
}

/** 解析一段 ASCII 谱。文件头里的全局字段会被读取，opts 优先。 */
export function parseAscii(text: string, opts: ParseOptions = {}): Card {
  const lines = text.replace(/\r/g, "").split("\n");

  // # 文件头：`# key value`；tip 可重复
  const header: Record<string, string> = {};
  const headerTips: string[] = [];
  for (const raw of lines) {
    const m = /^#\s+([A-Za-z][\w-]*)(?:\s+(.*))?$/.exec(raw.trimEnd());
    if (!m) continue;
    const value = (m[2] ?? "").trim();
    if (m[1] === "tip") headerTips.push(value);
    else header[m[1]] = value;
  }
  const headerNum = (key: string, fallback: number): number => {
    const raw = header[key];
    if (raw == null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (cur.length > 0) {
        blocks.push(cur);
        cur = [];
      }
    } else {
      cur.push(line);
    }
  }
  if (cur.length > 0) blocks.push(cur);

  const sig = opts.sig ?? header.sig ?? "4/4";
  const bpm = opts.bpm ?? headerNum("bpm", 90);
  const units = opts.units ?? headerNum("units", sig.startsWith("3/") ? 3 : 4);
  const barSec = (units * 60) / bpm;
  const cardW = opts.w ?? (header.w != null ? headerNum("w", 4) : undefined);
  const wOpt = cardW ?? 4;

  const bars: Bar[] = [];
  const anno: Array<Array<readonly [number, string]>> = [];
  let grid = opts.grid ?? headerNum("grid", 0);
  let w = wOpt;

  for (const block of blocks) {
    const stringLines = block.filter(l => STRING_ROW.test(l));
    if (stringLines.length !== 6) continue; // 不是谱面块（标题/说明）

    const firstParts = stringLines[0].split("|");
    const segments = firstParts.slice(1, -1);
    if (segments.length === 0) fail("找不到用 | 包围的小节");
    const segLen = segments[0].length;
    if (grid > 0 && segLen !== grid * w + 1) {
      fail(`小节宽度 ${segLen} 与 grid=${grid} / w=${w} 不匹配`);
    }
    if (grid === 0) {
      if ((segLen - 1) % w !== 0) fail(`小节宽度 ${segLen} 不能被每格 ${w} 字符整除`);
      grid = (segLen - 1) / w;
    }

    // 标签行 / 注记行：排除六线谱行、d/p 行和文件头
    const others = block.filter(l => !STRING_ROW.test(l) && !DP_ROW.test(l) && !l.startsWith("#"));
    const labelLine = others[0] ?? "";
    const annoLine = others[1];
    const dLine = block.find(l => l.startsWith("d |"));

    const rowSegs = new Map<number, string[]>();
    for (const line of stringLines) {
      const string = STRING_OF[line[0]];
      if (!string) continue;
      const segs = line.split("|").slice(1, -1);
      if (segs.length !== segments.length) fail("六根弦的小节数不一致");
      rowSegs.set(string, segs);
    }

    for (let j = 0; j < segments.length; j++) {
      const label = segments.length === 1
        ? labelLine.trim()
        : labelLine.slice(3 + j * (grid * w + 2), 3 + (j + 1) * (grid * w + 2)).trim();

      const barAnno: Array<readonly [number, string]> = [];
      if (annoLine) {
        for (const m of annoLine.matchAll(/\S+/g)) {
          const start = m.index ?? 0;
          const barIdx = Math.floor((start - 3) / (grid * w + 2));
          if (barIdx !== j) continue;
          const within = start - (3 + barIdx * (grid * w + 2));
          const slot = Math.max(0, Math.min(grid - 1, Math.floor((within - 1) / w)));
          barAnno.push([slot, m[0]]);
        }
      }
      anno.push(barAnno);

      // d 行：同一格取最大力度（这里每个 symbol 就是一个格）
      const dSeg = dLine ? dLine.split("|").slice(1, -1)[j] : undefined;
      const velAt = new Map<number, number>();
      if (dSeg) {
        for (let slot = 0; slot < grid; slot++) {
          const pos = 1 + slot * w;
          const two = dSeg.slice(pos, pos + 2);
          const one = dSeg.slice(pos, pos + 1);
          const sym = VEL_OF[two] != null ? two : one;
          const vel = VEL_OF[sym];
          if (vel != null) velAt.set(slot, vel);
        }
      }

      const bySlot = new Map<number, RawNote[]>();
      for (const [string, segs] of rowSegs) {
        const seg = segs[j] ?? "";
        let covered = 0;
        for (let slot = 0; slot < grid; slot++) {
          const pos = 1 + slot * w;
          if (pos < covered || pos >= seg.length) continue;
          const ch = seg[pos];
          if (ch === "-" || ch === " " || ch === undefined) continue;
          let end = pos;
          while (end < seg.length && seg[end] !== "-" && seg[end] !== " ") end++;
          const labelText = seg.slice(pos, end);
          if (!labelText) continue;
          covered = Math.max(pos + w, end);
          const note = parseNote(string, labelText, velAt.get(slot));
          const list = bySlot.get(slot);
          if (list) list.push(note);
          else bySlot.set(slot, [note]);
        }
      }

      const slots = [...bySlot.keys()].sort((a, b) => a - b);
      const events: Event[] = [];
      const slotSec = barSec / grid;
      for (const slot of slots) {
        const notes = (bySlot.get(slot) ?? []).map(note => {
          const string = note[0];
          let next = grid;
          for (const s2 of slots) {
            if (s2 <= slot) continue;
            if ((bySlot.get(s2) ?? []).some(n => n[0] === string)) {
              next = s2;
              break;
            }
          }
          const dur = round((next - slot) * slotSec);
          return [note[0], note[1], note[2], note[3], dur] as RawNote;
        });
        events.push([slot, notes]);
      }

      bars.push([label, events]);
    }
  }

  if (bars.length === 0) fail("没有找到任何六线谱块");

  const hasAnno = anno.some(a => a.length > 0);
  const beat = opts.beat ?? header.beat;
  return {
    id: opts.id ?? headerNum("id", 0),
    title: opts.title ?? header.title ?? "解析的 ASCII 谱",
    en: opts.en ?? header.en ?? "parsed ascii",
    sig,
    bpm,
    grid,
    units,
    ...(beat ? { beat } : {}),
    ...(cardW != null ? { w: cardW } : {}),
    star: opts.star ?? header.star ?? "★",
    prog: opts.prog ?? header.prog ?? "",
    shapes: opts.shapes ?? header.shapes ?? "",
    how: opts.how ?? header.how ?? "",
    tips: opts.tips ?? headerTips,
    ...(hasAnno ? { anno } : {}),
    bars,
  };
}
