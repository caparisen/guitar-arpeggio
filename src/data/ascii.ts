import { STR_VEL } from "./build.js";
import type { Tech } from "../engine/types.js";
import type { Bar, Card, Event, RawNote } from "./types.js";

const LBL: Readonly<Record<number, string>> = { 6: "E", 5: "A", 4: "D", 3: "G", 2: "B", 1: "e" };
const DEFAULT_W = 4;

/** 从 Tech 自动生成六线谱标签；手写标签优先 */
export function noteLabel(fret: number, tech: Tech | undefined): string | undefined {
  if (!tech) return undefined;
  const vib = tech.vib ? "~" : "";
  if (tech.pre != null && tech.pre !== 0) {
    return `${fret + tech.pre}${tech.pre < 0 ? "/" : "\\"}${fret}${vib}`;
  }
  if (tech.bend && tech.bend[0] !== 0) {
    return `${fret}b${fret + tech.bend[0]}${vib}`;
  }
  if (tech.steps?.length) {
    let text = String(fret);
    for (const st of tech.steps) {
      const dir = st.glide ? (st.semi > 0 ? "/" : "\\") : st.semi > 0 ? "h" : "p";
      text += `${dir}${fret + st.semi}`;
    }
    return `${text}${vib}`;
  }
  if (tech.harm) return `${fret}*${vib}`;
  if (tech.mute === 2) return "x";
  if (tech.vib) return `${fret}~`;
  return undefined;
}

export interface AsciiOptions {
  /** 在六线谱下面多画一行力度：pp / p / mp / mf / f / ff */
  dynamics?: boolean;
  /** 每小节多少拍，用来算重音；默认 4 */
  units?: number;
  /** 播放指针：bar 从 0 开始，slot 是当前十六分格；每小节多一行 p | ... ^ ... */
  pointer?: { bar: number; slot: number };
  /** 是否在谱面之前输出 # 元数据头（默认 true）；header: false 只出谱面 */
  header?: boolean;
}

const dyn = (v: number): string =>
  v >= 0.95 ? "ff" : v >= 0.85 ? "f" : v >= 0.75 ? "mf" : v >= 0.65 ? "mp" : v >= 0.55 ? "p" : "pp";

/** 没有显式 vel 时，按 buildPattern 的弦序 + 拍位重音估一个 */
function defaultVel(string: number, slot: number, beatSlots: number): number {
  let acc = slot % beatSlots === 0 ? 0.05 : -0.03;
  if (slot === 0) acc += 0.03;
  return Math.min(1, Math.max(0.55, (STR_VEL[string] ?? 0.9) + acc));
}

/** 一小节 → 一行力度符号；同一格多个音（可能来自多个 Event）取最大力度 */
export function renderDynamics(events: readonly Event[], grid: number, w = DEFAULT_W, units = 4): string {
  const width = grid * w + 1;
  const row = new Array<string>(width).fill("-");
  const beatSlots = Math.max(1, Math.floor(grid / units));
  const best = new Map<number, number>();

  for (const [slot, notes] of events) {
    let max = best.get(slot) ?? 0;
    for (const raw of notes as readonly RawNote[]) {
      const v = raw[3]?.vel ?? defaultVel(raw[0], slot, beatSlots);
      if (v > max) max = v;
    }
    best.set(slot, max);
  }

  for (const [slot, max] of best) {
    if (max <= 0) continue;
    const text = dyn(max);
    const base = slot * w + 1;
    for (let k = 0; k < text.length && base + k < width; k++) row[base + k] = text[k];
  }
  return row.join("");
}

/** 一小节 → 六行文本（1 弦在上） */
export function renderBar(events: readonly Event[], grid: number, w = DEFAULT_W): Record<number, string> {
  const width = grid * w + 1;
  const rows = new Map<number, string[]>();
  for (let s = 1; s <= 6; s++) rows.set(s, new Array<string>(width).fill("-"));

  for (const [slot, notes] of events) {
    for (const raw of notes as readonly RawNote[]) {
      const [s, f, label, tech] = raw;
      const text = label && label.length > 0 ? label : (noteLabel(f, tech) ?? String(f));
      const base = slot * w + 1;
      const row = rows.get(s);
      if (!row) continue;
      for (let k = 0; k < text.length; k++) {
        if (base + k < width) row[base + k] = text[k];
      }
    }
  }

  const out: Record<number, string> = {};
  for (let s = 1; s <= 6; s++) out[s] = (rows.get(s) ?? []).join("");
  return out;
}

/**
 * 一组小节 → 文本行。
 *
 * annos 与 bars 等长，每项是 [(槽位, 文字)]，渲染成谱面之上的注记行
 * （扫弦方向 D/U、PM、滚奏 r5…），和品号共用同一套网格。
 * opts.dynamics 打开时，在六线谱下面多一行 `d |pp--mp--f…|`。
 */
export function renderBlock(
  bars: readonly Bar[],
  perLine: number,
  grid: number,
  w = DEFAULT_W,
  annos?: Card["anno"],
  opts: AsciiOptions = {},
): string[] {
  const out: string[] = [];
  for (let i = 0; i < bars.length; i += perLine) {
    const grp = bars.slice(i, i + perLine);
    const grpAnno = annos ? annos.slice(i, i + perLine) : [];

    const lab: string[] = [];
    grp.forEach(([label], j) => {
      const pos = 3 + j * (grid * w + 2);
      while (lab.length < pos) lab.push(" ");
      lab.push(...label);
    });
    out.push(lab.join("").replace(/\s+$/, ""));

    if (grpAnno.some(a => a && a.length > 0)) {
      const row = new Array<string>(3 + grp.length * (grid * w + 2)).fill(" ");
      grpAnno.forEach((a, j) => {
        if (!a) return;
        const base = 3 + j * (grid * w + 2);
        for (const [slot, text] of a) {
          const pos = base + slot * w + 1;
          for (let k = 0; k < text.length; k++) {
            if (pos + k < row.length) row[pos + k] = text[k];
          }
        }
      });
      out.push(row.join("").replace(/\s+$/, ""));
    }

    for (let s = 1; s <= 6; s++) {
      const parts = grp.map(([label, ev]) => {
        const r = renderBar(ev, grid, w);
        return r[s] ?? "";
      });
      out.push(`${LBL[s]} |${parts.join("|")}|`);
    }

    if (opts.dynamics) {
      const parts = grp.map(([label, ev]) => renderDynamics(ev, grid, w, opts.units ?? 4));
      out.push(`d |${parts.join("|")}|`);
    }

    if (opts.pointer) {
      const width = 3 + grp.length * (grid * w + 2);
      const row = new Array<string>(width).fill(" ");
      row[0] = "p";
      row[2] = "|";
      const pbar = opts.pointer.bar;
      if (pbar >= i && pbar < i + grp.length) {
        const j = pbar - i;
        const slot = Math.max(0, Math.min(grid - 1, opts.pointer.slot));
        const at = 3 + j * (grid * w + 2) + 1 + slot * w;
        if (at < width) row[at] = "^";
      }
      out.push(row.join("").replace(/\s+$/, ""));
    }

    out.push("");
  }
  return out;
}

/** 文件头：只放全局字段；音符级参数仍由谱面/标签表达 */
function headerLines(card: Card): string[] {
  const out = [
    "# guitar-arpeggio tab v1",
    `# id ${card.id}`,
    `# title ${card.title}`,
    `# en ${card.en}`,
    `# sig ${card.sig}`,
    `# bpm ${card.bpm}`,
    `# grid ${card.grid}`,
    `# units ${card.units}`,
  ];
  if (card.beat) out.push(`# beat ${card.beat}`);
  if (card.w != null) out.push(`# w ${card.w}`);
  out.push(`# star ${card.star}`);
  out.push(`# prog ${card.prog}`);
  out.push(`# shapes ${card.shapes}`);
  out.push(`# how ${card.how}`);
  for (const t of card.tips) out.push(`# tip ${t}`);
  out.push("");
  return out;
}

/** 一条卡片的完整谱面文本；默认带 # 文件头和力度行 */
export function cardAscii(card: Card, opts: AsciiOptions = {}): string {
  const body = renderBlock(card.bars, 1, card.grid, card.w ?? DEFAULT_W, card.anno, {
    dynamics: opts.dynamics ?? true,
    units: opts.units ?? card.units,
    pointer: opts.pointer,
  }).join("\n");
  if (opts.header === false) return body;
  return [...headerLines(card), body].join("\n");
}

export type { Bar };
