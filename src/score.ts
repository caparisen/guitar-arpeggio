import { noteLabel } from "./data/ascii.js";
import type { Bar, Card, RawNote } from "./data/types.js";
import type { Tech } from "./engine/types.js";
import { TUNING } from "./engine/config.js";

/**
 * GScore：给 Agent 写谱的行式 DSL（.gtr）。
 *
 *   bar:beat  track  fret/string  beats  [key=value ...]
 *
 * 例：
 *   bar 1 Am7
 *     arp 1:1   0/A 3    vel=1
 *     mel 1:1   8/e 1.5  pre=-1 vib=16,5.2,.35 vel=.94
 *
 * - 位置用 `bar:beat`（beat 从 1 开始，可小数），编译器映射到 grid；
 *   非整格会自动补 `off`（秒）。
 * - 音符用 `fret/string`（`8/e`、`0/A`），也接受 `C5` / `C5@e`。
 * - 时值用拍；技巧 key 直接对应 `Tech`：vel / pre / rel / slide / vib /
 *   bend / steps / harm / semi / mute / t60 / off / label。
 * - 同一个 `bar:beat` 写多行就是和弦；没有行就是休止。
 * - 头部：id / title / en / time / tempo / grid / units / w / star /
 *   prog / shapes / how / tip；`//` 是注释，`#` 只在行首当注释（避免和 C#5 冲突）。
 */

export class ScoreError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column = 1) {
    super(`score: line ${line}:${column}: ${message}`);
    this.name = "ScoreError";
    this.line = line;
    this.column = column;
  }
}

const STRING_OF: Readonly<Record<string, number>> = { e: 1, B: 2, G: 3, D: 4, A: 5, E: 6 };
const CHAR_OF: Readonly<Record<number, string>> = { 1: "e", 2: "B", 3: "G", 4: "D", 5: "A", 6: "E" };
const PITCH_CLASS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface Header {
  id?: number;
  title?: string;
  en?: string;
  sig?: string;
  bpm?: number;
  grid?: number;
  units?: number;
  w?: number;
  /** 拍号单位记号，6/8 用附点四分 ♩. */
  beat?: string;
  star?: string;
  prog?: string;
  shapes?: string;
  how?: string;
  tips: string[];
  score?: string;
}

const stripComment = (line: string): string => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) return "";
  const i = line.indexOf("//");
  return i >= 0 ? line.slice(0, i) : line;
};

const unquote = (s: string): string => {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith("\"") && t.endsWith("\"")) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
};

/** 3/4→3，6/8→2，4/4→4；没写 units 时用 */
function unitsFromSig(sig: string): number {
  const m = /^(\d+)\/(\d+)$/.exec(sig.trim());
  if (!m) return 4;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (d === 8) return Math.max(1, Math.round(n / 3));
  if (d === 2) return n * 2;
  return n;
}

function pitchMidi(letter: string, accidental: string, octave: number): number {
  const pc = PITCH_CLASS[letter] ?? 0;
  const acc = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return 12 * (octave + 1) + pc + acc;
}

const fmt = (n: number): string => {
  const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
};

/** 解析 GScore。结构错误抛 ScoreError（带行号）；玩法检查请再跑 validateCard */
export function parseScore(text: string): Card {
  let lineNo = 0;
  const header: Header = { tips: [] };
  const bars: Bar[] = [];
  const annos: Array<Array<readonly [number, string]>> = [];
  const trackVel = new Map<string, number>();
  let currentTrack = "n";

  const sig = (): string => header.sig ?? "4/4";
  const bpm = (): number => header.bpm ?? 90;
  const units = (): number => header.units ?? unitsFromSig(sig());
  const grid = (): number => header.grid ?? units() * 4;
  const barSec = (): number => (units() * 60) / bpm();

  const fail = (msg: string, column = 1): never => {
    throw new ScoreError(msg, lineNo, column);
  };

  const beatToSlot = (beat: number): { slot: number; off: number } => {
    const g = grid();
    const u = units();
    if (!Number.isFinite(beat) || beat < 1 || beat >= u + 1) fail(`拍号 ${beat} 超出 1..${u + 1}（不含）`);
    const raw = ((beat - 1) * g) / u;
    const slot = Math.round(raw);
    if (slot < 0 || slot >= g) fail(`拍号 ${beat} 映射到槽位 ${slot}，超出 0..${g - 1}`);
    const exact = ((beat - 1) * barSec()) / u;
    const off = exact - slot * (barSec() / g);
    return { slot, off };
  };

  const numbers = (value: string): number[] =>
    value.split(",").map(s => {
      const n = Number(s);
      if (!Number.isFinite(n)) fail(`不是数字：${s}`);
      return n;
    });

  const parseNoteToken = (tok: string): { string: number; fret: number } => {
    if (tok.includes("/")) {
      const [fs, ss] = tok.split("/");
      const fret = Number(fs);
      const string = STRING_OF[ss ?? ""];
      if (!Number.isInteger(fret) || fret < 0 || fret > 24) fail(`品 ${fs} 超出 0..24`);
      if (!string) fail(`弦「${ss}」不是 e/B/G/D/A/E 之一`);
      return { string, fret };
    }
    const m = /^([A-G])([#b]?)(-?\d+)(?:@([eBGDAE]))?$/.exec(tok);
    if (!m) return fail(`无法识别的音高：${tok}`);
    const midi = pitchMidi(m[1]!, m[2] ?? "", Number(m[3]));
    if (m[4]) {
      const string = STRING_OF[m[4]]!;
      const fret = midi - TUNING[string]!;
      if (fret < 0 || fret > 24) fail(`音高 ${tok} 在 ${m[4]} 弦上超出 0..24 品`);
      return { string, fret };
    }
    let best: { string: number; fret: number } | null = null;
    for (let s = 1; s <= 6; s++) {
      const fret = midi - TUNING[s]!;
      if (fret < 0 || fret > 24) continue;
      if (!best || fret < best.fret || (fret === best.fret && s < best.string)) best = { string: s, fret };
    }
    if (!best) return fail(`音高 ${tok} 在吉他上找不到`);
    return best;
  };

  const applyTech = (tok: string, tech: Tech): string | undefined => {
    const eq = tok.indexOf("=");
    if (eq < 0) fail(`技巧要写成 key=value：${tok}`);
    const key = tok.slice(0, eq);
    const value = tok.slice(eq + 1);
    switch (key) {
      case "label":
        return value;
      case "vel":
        tech.vel = numbers(value)[0]!;
        return undefined;
      case "pre":
        tech.pre = numbers(value)[0]!;
        return undefined;
      case "rel": {
        const [at, dur] = numbers(value);
        tech.relAt = at!;
        tech.relDur = dur!;
        return undefined;
      }
      case "slide":
        tech.slide = numbers(value)[0]!;
        return undefined;
      case "vib": {
        const [cents, hz, at] = numbers(value);
        tech.vib = [cents!, hz!, at!];
        return undefined;
      }
      case "bend": {
        const [semi, at, dur] = numbers(value);
        tech.bend = [semi!, at!, dur!];
        return undefined;
      }
      case "steps":
        tech.steps = value.split(",").map(s => {
          const [semi, at] = s.split("@").map(Number);
          if (!Number.isFinite(semi) || !Number.isFinite(at)) fail(`steps 要写成 semi@at：${s}`);
          return { at: at!, semi: semi! };
        });
        return undefined;
      case "harm": {
        const [node, semi] = numbers(value);
        tech.harm = node!;
        if (semi != null) tech.semi = semi;
        return undefined;
      }
      case "semi":
        tech.semi = numbers(value)[0]!;
        return undefined;
      case "mute":
        tech.mute = numbers(value)[0]!;
        return undefined;
      case "t60":
        tech.t60 = numbers(value)[0]!;
        return undefined;
      case "off":
        tech.off = numbers(value)[0]!;
        return undefined;
      default:
        fail(`未知技巧 key：${key}`);
    }
  };

  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    lineNo++;
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const first = parts[0]!;

    if (first === "bar") {
      const rest = line.slice(3).trim();
      const m = /^(\d+)(?:\s+(.*))?$/.exec(rest);
      let label = rest;
      if (m) {
        const n = Number(m[1]);
        if (n !== bars.length + 1) fail(`第 ${n} 小节对不上，当前应当是第 ${bars.length + 1} 小节`);
        label = m[2] ?? "";
      }
      bars.push([label.trim(), []]);
      annos.push([]);
      continue;
    }

    if (first === "track") {
      const rest = line.slice(5).trim();
      const [name, ...settings] = rest.split(/\s+/);
      currentTrack = name ?? "n";
      for (const s of settings) {
        if (s.startsWith("vel=")) trackVel.set(currentTrack, Number(s.slice(4)));
      }
      continue;
    }

    if (first === "anno") {
      const rest = line.slice(4).trim();
      const m = /^(\d+):([\d.]+)\s+(.+)$/.exec(rest);
      if (!m) return fail("anno 要写成 anno bar:beat 文字");
      const barNo = Number(m[1]);
      if (barNo < 1 || barNo > bars.length) fail(`anno 的小节 ${barNo} 不存在`);
      const { slot } = beatToSlot(Number(m[2]));
      annos[barNo - 1]!.push([slot, m[3]!.trim()]);
      continue;
    }

    if (first === "score") {
      header.score = line.slice(5).trim();
      continue;
    }

    if (first === "section") continue;

    switch (first) {
      case "id": header.id = Number(line.slice(2).trim()); continue;
      case "title": header.title = unquote(line.slice(5).trim()); continue;
      case "en": header.en = unquote(line.slice(2).trim()); continue;
      case "time":
      case "sig": header.sig = line.slice(first.length).trim(); continue;
      case "tempo":
      case "bpm": header.bpm = Number(line.slice(first.length).trim()); continue;
      case "grid": header.grid = Number(line.slice(4).trim()); continue;
      case "units": header.units = Number(line.slice(5).trim()); continue;
      case "beat": header.beat = line.slice(4).trim(); continue;
      case "w": header.w = Number(line.slice(1).trim()); continue;
      case "star": header.star = line.slice(4).trim(); continue;
      case "prog": header.prog = line.slice(4).trim(); continue;
      case "shapes": header.shapes = line.slice(6).trim(); continue;
      case "how": header.how = unquote(line.slice(3).trim()); continue;
      case "tip":
      case "tips": header.tips.push(unquote(line.slice(first.length).trim())); continue;
    }

    // 音符行：可写成 `track bar:beat ...` 或 `bar:beat track ...`
    let i = 0;
    let track = currentTrack;
    if (!parts[i]!.includes(":")) track = parts[i++]!;
    const pos = parts[i++];
    if (!pos) fail("音符行缺少 bar:beat");
    const pm = /^(\d+):([\d.]+)$/.exec(pos);
    if (!pm) return fail(`位置要写成 bar:beat：${pos}`);
    const barNo = Number(pm[1]);
    if (barNo !== bars.length) fail(`音符在第 ${barNo} 小节，但当前是第 ${bars.length} 小节`);
    const bar = bars[bars.length - 1]!;
    const beat = Number(pm[2]);
    const { slot, off } = beatToSlot(beat);

    const noteTok = parts[i++];
    if (!noteTok) fail("音符行缺少音符");
    const durTok = parts[i++];
    if (!durTok) fail("音符行缺少时值");
    const beats = Number(durTok);
    if (!Number.isFinite(beats) || beats <= 0) fail(`时值必须是正数：${durTok}`);

    const { string, fret } = parseNoteToken(noteTok);
    const tech: Tech = {};
    let label: string | undefined;
    let explicitOff = false;
    for (; i < parts.length; i++) {
      const t = parts[i]!;
      if (t.startsWith("off=")) explicitOff = true;
      const maybeLabel = applyTech(t, tech);
      if (maybeLabel != null) label = maybeLabel;
    }
    if (!explicitOff && Math.abs(off) > 1e-4) tech.off = Number(off.toFixed(4));
    if (tech.vel == null) {
      const v = trackVel.get(track);
      if (v != null) tech.vel = v;
    }

    const raw: RawNote = [string, fret, label, tech, Number(((beats * 60) / bpm()).toFixed(4))];
    const existing = bar[1].find(e => e[0] === slot);
    if (existing) existing[1].push(raw);
    else bar[1].push([slot, [raw]]);
  }

  if (bars.length === 0) fail("没有找到任何 bar");

  for (const [, events] of bars) events.sort((a, b) => a[0] - b[0]);
  const hasAnno = annos.some(a => a.length > 0);

  return {
    id: header.id ?? 0,
    title: header.title ?? header.score ?? "未命名",
    en: header.en ?? "",
    sig: sig(),
    bpm: bpm(),
    grid: grid(),
    units: units(),
    ...(header.beat ? { beat: header.beat } : {}),
    ...(header.w != null ? { w: header.w } : {}),
    star: header.star ?? "★",
    prog: header.prog ?? "",
    shapes: header.shapes ?? "",
    how: header.how ?? "",
    tips: header.tips,
    ...(hasAnno ? { anno: annos } : {}),
    bars,
  };
}

/** 把 Card 导出成 GScore；和 parseScore 互为往返 */
export function cardToScore(card: Card): string {
  const out: string[] = [];
  const slug = `${card.en || card.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  out.push(`// generated from ${card.title}`);
  if (slug) out.push(`score ${slug}`);
  out.push(`id ${card.id}`);
  out.push(`title ${card.title}`);
  if (card.en) out.push(`en ${card.en}`);
  out.push(`time ${card.sig}`);
  out.push(`tempo ${card.bpm}`);
  out.push(`grid ${card.grid}`);
  out.push(`units ${card.units}`);
  if (card.beat) out.push(`beat ${card.beat}`);
  if (card.w != null && card.w !== 4) out.push(`w ${card.w}`);
  out.push(`star ${card.star}`);
  if (card.prog) out.push(`prog ${card.prog}`);
  if (card.shapes) out.push(`shapes ${card.shapes}`);
  if (card.how) out.push(`how ${card.how}`);
  for (const t of card.tips) out.push(`tip ${t}`);

  card.bars.forEach(([label, events], bi) => {
    out.push("");
    out.push(`bar ${bi + 1} ${label}`);
    for (const [slot, notes] of events) {
      const beat = fmt(1 + (slot * card.units) / card.grid);
      for (const note of notes) {
        const [string, fret, label2, techRaw, durSec] = note;
        const tech = techRaw ?? {};
        const track = string === 1 ? "mel" : string >= 5 ? "bass" : "arp";
        const beats = fmt(((durSec ?? 0.5) * card.bpm) / 60);
        const tokens: string[] = [];
        if (tech.vel != null) tokens.push(`vel=${fmt(tech.vel)}`);
        if (tech.pre != null) tokens.push(`pre=${fmt(tech.pre)}`);
        if (tech.relAt != null || tech.relDur != null) {
          tokens.push(`rel=${fmt(tech.relAt ?? 0)},${fmt(tech.relDur ?? 0)}`);
        }
        if (tech.slide) tokens.push(`slide=${fmt(tech.slide)}`);
        if (tech.vib) tokens.push(`vib=${tech.vib.map(fmt).join(",")}`);
        if (tech.bend) tokens.push(`bend=${tech.bend.map(fmt).join(",")}`);
        if (tech.steps) tokens.push(`steps=${tech.steps.map(s => `${fmt(s.semi)}@${fmt(s.at)}`).join(",")}`);
        if (tech.harm != null) {
          tokens.push(`harm=${fmt(tech.harm)}${tech.semi != null ? `,${fmt(tech.semi)}` : ""}`);
        } else if (tech.semi != null) {
          tokens.push(`semi=${fmt(tech.semi)}`);
        }
        if (tech.mute) tokens.push(`mute=${fmt(tech.mute)}`);
        if (tech.t60 != null) tokens.push(`t60=${fmt(tech.t60)}`);
        if (tech.off) tokens.push(`off=${fmt(tech.off)}`);
        const auto = noteLabel(fret, tech);
        if (label2 && label2 !== auto) tokens.push(`label=${label2}`);
        const tail = tokens.length ? ` ${tokens.join(" ")}` : "";
        out.push(`  ${track} ${bi + 1}:${beat} ${fret}/${CHAR_OF[string]} ${beats}${tail}`);
      }
    }
    for (const [slot, text] of card.anno?.[bi] ?? []) {
      out.push(`  anno ${bi + 1}:${fmt(1 + (slot * card.units) / card.grid)} ${text}`);
    }
  });
  out.push("");
  return out.join("\n");
}
