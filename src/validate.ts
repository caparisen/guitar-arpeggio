import { barSec, type Card, type RawNote } from "./data/types.js";
import type { Tech } from "./engine/types.js";

/**
 * 谱面可弹性校验。
 *
 * 只检查「手能不能按出来」，不检查音频。规则：
 * 1. `fret-span`：同一个和弦/滚奏窗口内，按弦的品位跨度不能超过 `maxFretSpan`。
 *    空弦不算（不用按），泛音不算（只轻触节点）。
 * 2. `open-string-vibrato`：0 品空弦不能加 `vib`——左手没有按弦点。
 * 3. `open-string-bend`：0 品空弦不能加 `bend` / `pre`（弦长不能变）。
 *    `steps` 不算：从空弦锤到品格是能弹的。
 *
 * 注意：跨度只按「同时按」算，长音可以提前松开，所以不按 MIDI 的持续发声算。
 */

export const DEFAULT_LIMITS = {
  maxFretSpan: 5,
  groupWindow: 0.3,
  allowOpenStringVibrato: false,
} as const;

export type RuleId = "fret-span" | "open-string-vibrato" | "open-string-bend";

const ALL_RULES: readonly RuleId[] = ["fret-span", "open-string-vibrato", "open-string-bend"];

export interface ValidateOptions {
  /** 同时按弦的品位跨度上限，默认 5 */
  maxFretSpan?: number;
  /** 把多近的音算成同一个和弦/滚奏（秒），默认 0.3 */
  groupWindow?: number;
  /** 允许空弦揉弦（默认 false；只对纯合成、不给人弹的卡片用） */
  allowOpenStringVibrato?: boolean;
  /** 只跑这些规则；默认全跑 */
  rules?: readonly RuleId[];
}

export interface NoteRef {
  /** 1-based 小节号 */
  bar: number;
  slot: number;
  /** 秒 */
  onset: number;
  string: number;
  fret: number;
  label?: string;
}

export interface ValidationIssue {
  rule: RuleId;
  severity: "error";
  cardId: number;
  cardTitle: string;
  bar: number;
  onset: number;
  message: string;
  notes: NoteRef[];
  /** 仅 fret-span */
  span?: number;
  /** 仅 fret-span */
  limit?: number;
}

export interface ValidationResult {
  cardId: number;
  cardTitle: string;
  ok: boolean;
  issues: ValidationIssue[];
  counts: Record<RuleId, number>;
}

interface FlatNote extends NoteRef {
  tech: Tech | null;
}

const toRef = (n: FlatNote): NoteRef => ({
  bar: n.bar,
  slot: n.slot,
  onset: n.onset,
  string: n.string,
  fret: n.fret,
  label: n.label,
});

function flatten(card: Card): FlatNote[] {
  const bs = barSec(card);
  const out: FlatNote[] = [];
  card.bars.forEach(([, events], bi) => {
    for (const [slot, notes] of events) {
      for (const raw of notes as readonly RawNote[]) {
        const [string, fret, label, tech] = raw;
        const onset = bi * bs + (slot * bs) / card.grid + (tech?.off ?? 0);
        out.push({
          bar: bi + 1,
          slot,
          onset: Number(onset.toFixed(4)),
          string,
          fret,
          label,
          tech: tech ?? null,
        });
      }
    }
  });
  return out.sort((a, b) => a.onset - b.onset || a.string - b.string);
}

export function validateCard(card: Card, options: ValidateOptions = {}): ValidationResult {
  const maxFretSpan = options.maxFretSpan ?? DEFAULT_LIMITS.maxFretSpan;
  const groupWindow = options.groupWindow ?? DEFAULT_LIMITS.groupWindow;
  const allowVib = options.allowOpenStringVibrato ?? DEFAULT_LIMITS.allowOpenStringVibrato;
  const rules = new Set<RuleId>(options.rules ?? ALL_RULES);
  const counts: Record<RuleId, number> = {
    "fret-span": 0,
    "open-string-vibrato": 0,
    "open-string-bend": 0,
  };
  const issues: ValidationIssue[] = [];
  const notes = flatten(card);

  // 1) 品位跨度：按窗口分组，只数按弦音
  if (rules.has("fret-span")) {
    const groups: FlatNote[][] = [];
    for (const n of notes) {
      const last = groups[groups.length - 1];
      if (last && n.onset - last[0].onset <= groupWindow) last.push(n);
      else groups.push([n]);
    }

    for (const group of groups) {
      const fretted = group.filter(n => n.fret > 0 && !n.tech?.harm);
      if (fretted.length < 2) continue;
      const span = Math.max(...fretted.map(n => n.fret)) - Math.min(...fretted.map(n => n.fret));
      if (span <= maxFretSpan) continue;
      counts["fret-span"]++;
      issues.push({
        rule: "fret-span",
        severity: "error",
        cardId: card.id,
        cardTitle: card.title,
        bar: group[0].bar,
        onset: group[0].onset,
        span,
        limit: maxFretSpan,
        notes: fretted.map(toRef),
        message: `同时按 ${fretted.map(n => `${n.string} 弦 ${n.fret} 品`).join("、")}，跨度 ${span} 品 > ${maxFretSpan}`,
      });
    }
  }

  // 2) 0 品空弦不能揉弦
  if (rules.has("open-string-vibrato") && !allowVib) {
    for (const n of notes) {
      const vib = n.tech?.vib;
      if (n.fret !== 0 || !vib || vib[0] === 0) continue;
      counts["open-string-vibrato"]++;
      issues.push({
        rule: "open-string-vibrato",
        severity: "error",
        cardId: card.id,
        cardTitle: card.title,
        bar: n.bar,
        onset: n.onset,
        notes: [toRef(n)],
        message: "0 品空弦不能揉弦（vib）；换到按弦位置，或删掉揉弦",
      });
    }
  }

  // 3) 0 品空弦不能推弦/预推弦
  if (rules.has("open-string-bend")) {
    for (const n of notes) {
      if (n.fret !== 0) continue;
      const used: string[] = [];
      const bend = n.tech?.bend;
      if (bend && bend[0] !== 0) used.push("bend");
      const pre = n.tech?.pre;
      if (pre != null && pre !== 0) used.push("pre");
      if (used.length === 0) continue;
      counts["open-string-bend"]++;
      issues.push({
        rule: "open-string-bend",
        severity: "error",
        cardId: card.id,
        cardTitle: card.title,
        bar: n.bar,
        onset: n.onset,
        notes: [toRef(n)],
        message: `0 品空弦不能 ${used.join(" / ")}（弦长不变）；换到按弦位置`,
      });
    }
  }

  issues.sort((a, b) => a.onset - b.onset || a.rule.localeCompare(b.rule));
  return {
    cardId: card.id,
    cardTitle: card.title,
    ok: issues.length === 0,
    issues,
    counts,
  };
}

export function validateCards(cards: readonly Card[], options?: ValidateOptions): ValidationResult[] {
  return cards.map(card => validateCard(card, options));
}

export function formatIssue(issue: ValidationIssue): string {
  return `[${issue.rule}] #${issue.cardId} ${issue.cardTitle} 第 ${issue.bar} 小节 t=${issue.onset.toFixed(3)}s：${issue.message}`;
}
