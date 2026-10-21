import { TUNING } from "../engine/config.js";
import type { NoteTuple, Pattern, Tech } from "../engine/types.js";
import { barSec, type Card, type Event, type RawNote } from "./patterns.js";

/** 弦序基准音量：低音更响 */
const STR_VEL: Readonly<Record<number, number>> = { 6: 1.0, 5: 0.96, 4: 0.92, 3: 0.89, 2: 0.86, 1: 0.83 };

const round = (v: number, d: number): number => Number(v.toFixed(d));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

interface Cell {
  onset: number;
  s: number;
  f: number;
  tech: Tech | null;
  dur: number | null;
  slot: number;
}

/**
 * Card（记谱）→ Pattern（可播放的音符列表）。
 *
 * 三件事在这里定：起音时间（含扫弦偏移）、时值（同弦下一个音）、力度
 * （弦序 + 拍位重音 + 固定种子的抖动）。
 */
export function buildPattern(card: Card): Pattern {
  const bs = barSec(card);
  const g = card.grid;
  const beatSlots = Math.max(1, Math.floor(g / card.units));
  const notes: NoteTuple[] = [];

  card.bars.forEach(([, events], bi) => {
    const t0 = bi * bs;
    const cells: Cell[] = [];

    for (const [slot, ns] of events as readonly Event[]) {
      for (const raw of ns as readonly RawNote[]) {
        const [s, f, , tech, dur] = raw;
        const off = tech?.off ?? 0;
        cells.push({
          onset: round(t0 + (slot * bs) / g + off, 4),
          s,
          f,
          tech: tech ?? null,
          dur: dur ?? null,
          slot,
        });
      }
    }

    for (const c of cells) {
      let dur = c.dur;
      if (dur == null) {
        const next = cells.filter(o => o.s === c.s && o.onset > c.onset).map(o => o.onset);
        dur = next.length ? Math.min(1.8, Math.min(...next) - c.onset) : 1.8;
        dur = clamp(dur, 0.09, 1.8);
      }

      let acc = c.slot % beatSlots === 0 ? 0.05 : -0.03;
      if (c.slot === 0) acc += 0.03;
      const h = (card.id * 7919 + bi * 131 + c.slot * 17 + c.s * 7) % 1000;
      let vel = (STR_VEL[c.s] ?? 0.9) + acc + (h / 1000 - 0.5) * 0.05;
      if (c.tech?.vel != null) vel = c.tech.vel;
      vel = round(clamp(vel, 0.55, 1.0), 3);

      const semi = c.tech?.semi ?? 0;
      // 泛音的「品」只是节点位置：发声 = 空弦 + 半音偏移
      const isHarm = Boolean(c.tech?.harm);
      const midi = TUNING[c.s] + (isHarm ? semi : c.f + semi);

      notes.push([c.onset, midi, c.s, round(dur, 3), c.tech, vel]);
    }
  });

  return {
    id: card.id,
    title: card.title,
    en: card.en,
    sig: card.sig,
    bpm: card.bpm,
    barSec: bs,
    bars: card.bars.length,
    prog: card.prog,
    how: card.how,
    notes,
  };
}
