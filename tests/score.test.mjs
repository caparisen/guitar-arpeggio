// GScore 检查：解析、Card 往返、错误定位、可弹性。用法：node tests/score.test.mjs
import assert from "node:assert";
import fs from "node:fs";

import {
  ScoreError,
  cardAscii,
  cardToScore,
  parseScore,
  validateCard,
} from "../dist/index.js";
import { DEMOS, CARDS } from "../scripts/load-examples.mjs";

const SAMPLE = fs.readFileSync(new URL("../examples/18.gtr", import.meta.url), "utf8");

// 1) 现有 Card 原样往返：cardToScore -> parseScore -> cardAscii
for (const id of [3, 17, 18, 14, 20]) {
  const c = DEMOS.find(x => x.id === id) ?? CARDS.find(x => x.id === id);
  assert.ok(c, `找不到第 ${id} 条`);
  const text = cardToScore(c);
  const back = parseScore(text);
  assert.strictEqual(cardAscii(back), cardAscii(c), `第 ${id} 条 ASCII 往返不一致`);
  if (c.beat) assert.strictEqual(back.beat, c.beat, `第 ${id} 条 beat 往返不一致`);
}

// 2) 手写 DSL：位置/音符/时值/技巧/anno/自动标签
{
  const text = `// hand-written
score test
title Test
time 3/4
tempo 96
grid 12
units 3

bar 1 Am
  mel 1:1 8/e 1.5 pre=-1 vib=16,5.2,.35 vel=.94
  arp 1:1 0/A 1.5 vel=1
  arp 1:1.5 7/D 1.5 vel=.6
  fill 1:2.75 7/D .2 vel=.56
  anno 1:1 melody
`;
  const card = parseScore(text);
  assert.strictEqual(card.bars.length, 1);
  assert.strictEqual(card.bars[0][0], "Am");
  const notes = card.bars[0][1].flatMap(e => e[1]);
  assert.strictEqual(notes.length, 4);
  const mel = notes.find(n => n[0] === 1);
  assert.ok(mel);
  assert.strictEqual(mel[1], 8);
  assert.strictEqual(mel[3].pre, -1);
  assert.deepStrictEqual(mel[3].vib, [16, 5.2, 0.35]);
  assert.strictEqual(card.anno?.[0]?.[0]?.[0], 0);
  assert.strictEqual(card.anno?.[0]?.[0]?.[1], "melody");
  const ascii = cardAscii(card);
  assert.ok(ascii.includes("7/8~"), ascii);
  assert.ok(ascii.includes("melody"), ascii);
  const check = validateCard(card);
  assert.strictEqual(check.ok, true);
  assert.deepStrictEqual(check.issues, []);
}

// 3) 音高写法：C5@e 与 C5 都落 1 弦 8 品
{
  const text = `time 4/4
tempo 96
grid 16
units 4
bar 1 C
  mel 1:1 C5@e 1
  mel 1:2 C5 1
`;
  const card = parseScore(text);
  const notes = card.bars[0][1].flatMap(e => e[1]);
  assert.deepStrictEqual(notes.map(n => [n[0], n[1]]), [[1, 8], [1, 8]]);
}

// 4) 非整拍：落到最近的格，并补 off
{
  const text = `time 4/4
tempo 96
grid 16
units 4
bar 1 Am
  mel 1:1.1 8/e 1
`;
  const card = parseScore(text);
  const ev = card.bars[0][1][0];
  assert.strictEqual(ev[0], 0);
  assert.ok(Math.abs((ev[1][0][3].off ?? 0) - 0.0625) < 1e-6, `off=${ev[1][0][3].off}`);
}

// 5) track 默认力度
{
  const text = `time 4/4
tempo 90
grid 16
units 4
track mel vel=.5
bar 1 Am
  mel 1:1 8/e 1
`;
  const card = parseScore(text);
  const note = card.bars[0][1][0][1][0];
  assert.strictEqual(note[3].vel, 0.5);
}

// 6) 错误定位
{
  assert.throws(() => parseScore(""), ScoreError);
  assert.throws(() => parseScore("bar 1 Am\n  mel 1:1 25/e 1"), /品 25/);
  assert.throws(() => parseScore("bar 1 Am\n  mel 1:1 8/X 1"), /e\/B\/G\/D\/A\/E/);
  assert.throws(() => parseScore("bar 1 Am\n  mel 1:5 8/e 1"), /拍号/);
  assert.throws(() => parseScore("bar 1 Am\n  mel 1:1 8/e"), /时值/);
  assert.throws(() => parseScore("bar 1 Am\n  mel 1:1 8/e 1 foo=1"), /未知技巧/);
  assert.throws(() => parseScore("bar 1 Am\nbar 3 G"), /第 3 小节/);
  assert.throws(() => parseScore("mel 1:1 8/e 1"), /第 1 小节/);
}

// 7) 仓库里的示例：可解析 + 可弹性
{
  const card = parseScore(SAMPLE);
  assert.strictEqual(card.bars.length, 8);
  const check = validateCard(card);
  assert.strictEqual(check.ok, true);
  assert.deepStrictEqual(check.issues, []);
}

// 8) 第 20 条的 .gtr 源文件：可解析 + 可弹性 + 16 小节
{
  const sample20 = fs.readFileSync(new URL("../examples/20.gtr", import.meta.url), "utf8");
  const card = parseScore(sample20);
  assert.strictEqual(card.bars.length, 16);
  const check = validateCard(card);
  assert.strictEqual(check.ok, true);
  assert.deepStrictEqual(check.issues, []);
}

console.log("score ok: Card 往返、手写 DSL、音高、off、track 默认力度、错误、示例、第 20 条 .gtr");
