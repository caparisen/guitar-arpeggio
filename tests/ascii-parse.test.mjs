// ASCII 谱 -> Card 的往返检查。用法：node tests/ascii-parse.test.mjs
import assert from "node:assert";

import { cardAscii, parseAscii, renderBlock } from "../dist/index.js";
import { CARDS, DEMOS } from "../scripts/load-examples.mjs";

const meta = c => ({
  id: c.id,
  title: c.title,
  en: c.en,
  sig: c.sig,
  bpm: c.bpm,
  grid: c.grid,
  units: c.units,
  w: c.w ?? 4,
  star: c.star,
  prog: c.prog,
  shapes: c.shapes,
  how: c.how,
  tips: c.tips,
});

// 1) Geordie 第 17 条原样往返（头里的全局字段自动读取）
{
  const c = DEMOS.find(x => x.id === 17);
  assert.ok(c, "找不到第 17 条");
  const text = cardAscii(c);
  const back = parseAscii(text);
  assert.strictEqual(back.bars.length, c.bars.length);
  assert.strictEqual(back.grid, c.grid);
  assert.strictEqual(back.id, c.id);
  assert.strictEqual(back.title, c.title);
  assert.strictEqual(back.en, c.en);
  assert.strictEqual(back.sig, c.sig);
  assert.strictEqual(back.bpm, c.bpm);
  assert.strictEqual(back.units, c.units);
  assert.strictEqual(back.w ?? 4, c.w ?? 4);
  assert.strictEqual(back.star, c.star);
  assert.strictEqual(back.prog, c.prog);
  assert.strictEqual(back.shapes, c.shapes);
  assert.strictEqual(back.how, c.how);
  assert.deepStrictEqual(back.tips, c.tips);
  assert.strictEqual(cardAscii(back), text);

  // opts 优先于文件头
  const over = parseAscii(text, { title: "覆盖", bpm: 60 });
  assert.strictEqual(over.title, "覆盖");
  assert.strictEqual(over.bpm, 60);
}

// 1b) 6/8 的 beat / tips / star / prog 等也从文件头还原
{
  const c = CARDS.find(x => x.id === 3);
  assert.ok(c, "找不到第 3 条");
  const text = cardAscii(c);
  const back = parseAscii(text);
  assert.strictEqual(back.beat, c.beat);
  assert.strictEqual(back.w ?? 4, c.w ?? 4);
  assert.deepStrictEqual(back.tips, c.tips);
  assert.strictEqual(back.star, c.star);
  assert.strictEqual(back.prog, c.prog);
  assert.strictEqual(back.shapes, c.shapes);
  assert.strictEqual(back.how, c.how);
  assert.strictEqual(cardAscii(back), text);
}

// 2) 指针 p 行不影响解析
{
  const c = DEMOS.find(x => x.id === 17);
  const text = cardAscii(c, { pointer: { bar: 4, slot: 6 } });
  assert.ok(text.includes("p |"), "应当有指针行");
  const back = parseAscii(text);
  assert.strictEqual(cardAscii(back), cardAscii(c));
}

// 3) 手写标签还原成近似 Tech
{
  const E = (slot, ...notes) => [slot, notes];
  const c = {
    id: 99, title: "parse-test", en: "", sig: "4/4", bpm: 96, grid: 16, units: 4,
    star: "", prog: "", shapes: "", how: "", tips: [],
    bars: [["Am", [
      E(0, [1, 8, "7/8~", { pre: -1, vib: [18, 5.2, 0.35] }, 1.5]),
      E(4, [1, 7, "7p5", { steps: [{ at: 0.28, semi: -2 }], t60: 3.5, vel: 0.62 }, 0.5]),
      E(8, [1, 12, "12*", { harm: 2, semi: 12 }, 1.5]),
    ]]],
  };
  const text = cardAscii(c);
  const back = parseAscii(text);
  assert.strictEqual(cardAscii(back), text);

  const notes = back.bars[0][1].flatMap(e => e[1]);
  const slide = notes.find(n => n[2] === "7/8~");
  assert.ok(slide, "7/8~ 丢了");
  assert.strictEqual(slide[1], 8, "RawNote 的音高应当写目标 8");
  assert.strictEqual(slide[3].pre, -1);
  const pull = notes.find(n => n[2] === "7p5");
  assert.ok(pull, "7p5 丢了");
  assert.strictEqual(pull[1], 7);
  assert.deepStrictEqual(pull[3].steps, [{ at: 0.28, semi: -2 }]);
  const harm = notes.find(n => n[2] === "12*");
  assert.ok(harm, "12* 丢了");
  assert.strictEqual(harm[3].harm, 2);
  assert.strictEqual(harm[3].semi, 12);
}

// 4) 一行多小节
{
  const c = CARDS[0];
  const text = renderBlock(c.bars.slice(0, 4), 4, c.grid, c.w ?? 4, c.anno, { dynamics: true, units: c.units }).join("\n");
  const back = parseAscii(text, meta(c));
  assert.strictEqual(back.bars.length, 4);
  const again = renderBlock(back.bars, 4, back.grid, back.w ?? 4, back.anno, { dynamics: true, units: back.units }).join("\n");
  assert.strictEqual(again, text);
}

// 4b) w=8 的勾弦/滑音卡：5h7 / 7p5 / 5/9 / 9\5
{
  const c = DEMOS[4]; // 14 勾弦与滑音
  const text = cardAscii(c);
  const back = parseAscii(text);
  assert.strictEqual(cardAscii(back), text);
  const notes = back.bars.flatMap(b => b[1].flatMap(e => e[1]));
  const up = notes.find(n => n[2] === "5h7");
  assert.ok(up, "5h7 丢了");
  assert.deepStrictEqual(up[3].steps, [{ at: 0.28, semi: 2 }]);
  const down = notes.find(n => n[2] === "9\\5");
  assert.ok(down, "9\\5 丢了");
  assert.strictEqual(down[1], 5, "下滑的目标音高应当写 5");
  assert.strictEqual(down[3].pre, 4);
}

// 5) 不是谱面的文本要报错
{
  assert.throws(() => parseAscii("hello"), /parseAscii/);
}

console.log("ascii-parse ok: 文件头/opts 覆盖、Geordie 往返、指针行忽略、标签/Tech、多小节、w=8 技巧卡、空输入报错");
