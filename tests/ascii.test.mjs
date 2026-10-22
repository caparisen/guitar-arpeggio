// 力度行检查。用法：node tests/ascii.test.mjs
import assert from "node:assert";

import { cardAscii, renderBlock, renderDynamics } from "../dist/index.js";
import { DEMOS } from "../scripts/load-examples.mjs";

const E = (slot, ...notes) => [slot, notes];
const bar = (...events) => ["X", events];
const card = (bars, id = 99) => ({
  id,
  title: `test-${id}`,
  en: "",
  sig: "4/4",
  bpm: 120,
  grid: 16,
  units: 4,
  star: "",
  prog: "",
  shapes: "",
  how: "",
  tips: [],
  bars,
});

// 0) 文件头：默认带 # 元数据，header:false 只出谱面
{
  const c = card([bar(E(0, [1, 5]))]);
  const text = cardAscii(c);
  assert.ok(text.startsWith("# guitar-arpeggio tab v1"), text);
  for (const line of [
    "# id 99", "# title test-99", "# sig 4/4", "# bpm 120",
    "# grid 16", "# units 4", "# star ", "# prog ", "# how ",
  ]) {
    assert.ok(text.includes(line), `${line} 不在文件头里`);
  }
  assert.ok(!cardAscii(c, { header: false }).includes("# "), "header:false 不应有文件头");
}

// 1) 显式 vel：1.0 → ff，0.72 → mp
{
  const c = card([bar(E(0, [1, 5, undefined, { vel: 1 }]), E(4, [1, 5, undefined, { vel: 0.72 }]))]);
  const row = renderDynamics(c.bars[0][1], 16, 4, 4);
  assert.ok(row.includes("ff"), row);
  assert.ok(row.includes("mp"), row);

  const ascii = cardAscii(c, { header: false });
  assert.ok(ascii.includes("d |"), ascii);
  assert.ok(ascii.includes("ff"), ascii);
  assert.ok(ascii.includes("mp"), ascii);
}

// 2) 没有显式 vel 时按弦序 + 拍位估：1 弦 5 品在 slot 0 → 0.91 → f
{
  const row = renderDynamics([E(0, [1, 5])], 16, 4, 4);
  assert.ok(row.includes("f"), row);
}

// 2b) 同一格两个 Event：取最大力度（0.76 → mf），不能后一个覆盖前一个
{
  const c = card([
    bar(E(0, [1, 5, undefined, { vel: 0.56 }]), E(0, [2, 3, undefined, { vel: 0.76 }])),
  ]);
  const row = renderDynamics(c.bars[0][1], 16, 4, 4);
  assert.ok(row.includes("mf"), row);
  assert.ok(!row.includes("pf"), row);
}

// 3) renderBlock 默认不画 d 行，显式打开才画
{
  const c = card([bar(E(0, [1, 5]))]);
  const off = renderBlock(c.bars, 1, c.grid, 4).join("\n");
  assert.ok(!off.includes("d |"), off);
  const on = renderBlock(c.bars, 1, c.grid, 4, undefined, { dynamics: true, units: c.units }).join("\n");
  assert.ok(on.includes("d |"), on);
}

// 4) steps 自动标成 3h5p3（不用手写 label）
{
  const c = card([bar(E(0, [1, 3, undefined, { steps: [{ at: 0.2, semi: 2 }, { at: 0.4, semi: 0 }] }]))]);
  const ascii = cardAscii(c, { header: false });
  assert.ok(ascii.includes("3h5p3"), ascii);
}

// 5) 播放指针行：slot 4 的 ^ 在第 20 列
{
  const c = card([bar(E(0, [1, 5]))]);
  const text = cardAscii(c, { pointer: { bar: 0, slot: 4 }, header: false });
  const line = text.split("\n").find(l => l.startsWith("p |"));
  assert.ok(line, text);
  assert.strictEqual(line.indexOf("^"), 20);
}

// 6) Geordie 第 17 条：d 行同时有 ff / f / mp
{
  const g = DEMOS.find(c => c.id === 17);
  assert.ok(g, "找不到第 17 条");
  const ascii = cardAscii(g, { header: false });
  assert.ok(ascii.includes("d |"), ascii);
  assert.ok(ascii.includes("ff"), "ff 不在力度行里");
  assert.ok(ascii.includes("mp"), "mp 不在力度行里");
  assert.ok(/[^a-z]f[^a-z]/.test(ascii), "独立的 f 不在力度行里");
}

console.log("ascii ok: 文件头、显式/默认 vel、d 行开关、力度行、steps 自动标记、播放指针");
