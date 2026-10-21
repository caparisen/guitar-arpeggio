// 生成可打印的谱集（guitar-arpeggio-patterns.txt）。
// 用法：node scripts/emit-book.mjs [--stdout]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CARDS, DEMOS, renderBlock } from "../dist/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "guitar-arpeggio-patterns.txt");
const W = 66;

/* ---------- 中英混排折行（中文按 2 列，避免断在标点前） ---------- */
const wide = (ch) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch);

function wrap(text, width = 70, indent = "   ", hang = "   ") {
  const toks = text.match(/[A-Za-z0-9#/.+\-=]+|\s+|./gu) ?? [];
  const lines = [];
  let cur = "";
  let cw = 0;
  let first = true;
  for (const tok of toks) {
    if (/^\s+$/.test(tok)) {
      if (cur && !cur.endsWith(" ")) {
        cur += " ";
        cw += 1;
      }
      continue;
    }
    let tw = 0;
    for (const ch of tok) tw += wide(ch) ? 2 : 1;
    const limit = width - (first ? indent.length : hang.length);
    const noBreak = "，。、；：！？）」』】…".includes(tok);
    if (cw + tw > limit && cur.trim() && !noBreak) {
      lines.push((first ? indent : hang) + cur.replace(/\s+$/, ""));
      first = false;
      cur = "";
      cw = 0;
    }
    cur += tok;
    cw += tw;
  }
  if (cur.trim()) lines.push((first ? indent : hang) + cur.replace(/\s+$/, ""));
  return lines;
}

/* ---------- 文件骨架 ---------- */
const out = [];
const add = (...ls) => out.push(...ls);
const bar = (ch = "-") => ch.repeat(W);

add("=".repeat(W));
add("  吉他分解和弦 8 条  ·  GUITAR ARPEGGIO STUDIES");
add("=".repeat(W));
add("");
add("调弦   E A D G B E（标准）");
add("记谱   e B G D A E 由上到下 = 1-6 弦；数字 = 品格；- = 不弹");
add("时值   横向 4 个字符 = 1 个十六分音符（每拍 16 字符）。");
add("       音符之间的空白宽度 = 它的时值，不是随手排的。");
add("");
add("试听   把任意一段六行谱整块复制，粘贴到：");
add("       https://www.gitaartabs.nl/en/reference/tab-player");
add("       点 Play。Tempo 按每条的标注调。");
add("       播放器是按字符间距估节奏的，若整体快/慢一倍，");
add("       把 Tempo 减半/加倍即可。");
add("");
add("=".repeat(W));
add("");

/* ---------- 8 条练习 ---------- */
for (const c of CARDS) {
  add(bar());
  add(`${String(c.id).padStart(2, "0")}  ${c.title}   [${c.en}]`);
  add(bar());
  add(`${c.sig}   ${c.beat ?? "♩"}=${c.bpm}   难度 ${c.star}`);
  add(`进行  ${c.prog}`);
  add(`和弦  ${c.shapes}`);
  add("");
  add("手法");
  add(...wrap(c.how, 70));
  add("");
  add("要点");
  for (const t of c.tips) add(...wrap(t, 70, "   · ", "     "));
  add("");
  add(...renderBlock(c.bars, 1, c.grid, c.w ?? 4, c.anno));
  add("");
}

/* ---------- 附录 ---------- */
const [bend, strum, harm] = DEMOS;

add("=".repeat(W));
add("附  技巧记号：推弦 / 揉弦");
add("=".repeat(W));
add("");
add("5b7      从 5 品起音，推到 7 品的音高（全音推弦）");
add("(5)b7    预推弦：先推到 7 品音高，再拨弦");
add("r5       推到顶之后放回 5 品的音高");
add("5~       揉弦（幅度约半个半音，5 Hz 上下）");
add("5b7~     先推全音，推到位再加揉弦");
add("");
add("注意  b / r / ~ 不是音符。在线 ASCII 播放器不认这几个符号，");
add("      它只会按 5 品那个音弹出来，听不出推弦和揉弦——");
add("      要听效果请用「npm run dev」打开的预览页，");
add("      那里用 playbackRate 自动化还原：推弦是变调（顺带变快），");
add("      推高一个全音，那段音的尾音会提前 12% 收掉。");
add("");
add(...renderBlock(bend.bars, 1, bend.grid, bend.w ?? 4, bend.anno));
add("");

add(bar());
add("附  扫弦与闷音（第 10 条）");
add(bar());
add("D  下扫：6→1 弦依次过，约 13 ms；U  上扫：1→6 弦，约 10 ms，力度轻 25%");
add("闷音：掌根压琴桥，音头保留、延音砍到 100 ms；切音更短，约 60 ms");
add("");
add(...renderBlock(strum.bars, 1, strum.grid, strum.w ?? 4, strum.anno));
add("");

add(bar());
add("附  泛音与滑音（第 11 条）");
add(bar());
add("记法  12* / 7* / 5* = 在 12 / 7 / 5 品轻触节点，发声分别高 12 / 19 / 24 个半音");
add("      5/7 = 从 5 品滑到 7 品（滑的瞬间另有一层擦弦噪声）");
add("");
add(...renderBlock(harm.bars, 1, harm.grid, harm.w ?? 4, harm.anno));
add("");

add("=".repeat(W));
add("  练法：从 01 开始，每条先只弹低音，再加手指；");
add("  每天 15 分钟，一条弹到不看谱，再进下一条。");
add("=".repeat(W));
add("");

const text = out.join("\n");
if (process.argv.includes("--stdout")) {
  process.stdout.write(text);
} else {
  fs.writeFileSync(OUT, text, "utf8");
  console.log(`wrote ${path.relative(ROOT, OUT)} (${text.split("\n").length} lines)`);
}
