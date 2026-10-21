import type { Bar, Card, Event, RawNote } from "./patterns.js";

const LBL: Readonly<Record<number, string>> = { 6: "E", 5: "A", 4: "D", 3: "G", 2: "B", 1: "e" };
const DEFAULT_W = 4;

/** 一小节 → 六行文本（1 弦在上） */
export function renderBar(events: readonly Event[], grid: number, w = DEFAULT_W): Record<number, string> {
  const width = grid * w + 1;
  const rows = new Map<number, string[]>();
  for (let s = 1; s <= 6; s++) rows.set(s, new Array<string>(width).fill("-"));

  for (const [slot, notes] of events) {
    for (const raw of notes as readonly RawNote[]) {
      const [s, f, label] = raw;
      const text = label && label.length > 0 ? label : String(f);
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
 */
export function renderBlock(
  bars: readonly Bar[],
  perLine: number,
  grid: number,
  w = DEFAULT_W,
  annos?: Card["anno"],
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
    out.push("");
  }
  return out;
}

/** 一条卡片的完整谱面文本 */
export function cardAscii(card: Card): string {
  return renderBlock(card.bars, 1, card.grid, card.w ?? DEFAULT_W, card.anno).join("\n");
}

export type { Bar };
