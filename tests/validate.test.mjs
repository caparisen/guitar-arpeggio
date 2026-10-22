// 谱面可弹性校验的正反例。用法：node tests/validate.test.mjs
import assert from "node:assert";

import { DEFAULT_LIMITS, formatIssue, validateCard, validateCards } from "../dist/index.js";
import { CARDS, DEMOS } from "../scripts/load-examples.mjs";

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

// 1) 1 弦 10 品 + 6 弦 3 品：跨 7 品，必须报 fret-span
{
  const c = card([bar(E(0, [1, 10], [6, 3]))]);
  const r = validateCard(c);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.issues.length, 1);
  assert.strictEqual(r.issues[0].rule, "fret-span");
  assert.strictEqual(r.issues[0].span, 7);
  assert.strictEqual(r.issues[0].limit, DEFAULT_LIMITS.maxFretSpan);
  assert.strictEqual(r.counts["fret-span"], 1);
  assert.ok(formatIssue(r.issues[0]).includes("#99"));
  assert.ok(formatIssue(r.issues[0]).includes("第 1 小节"));
}

// 2) 5 品 + 3 品：跨 2 品，合法
{
  const c = card([bar(E(0, [1, 5], [6, 3]))]);
  assert.strictEqual(validateCard(c).ok, true);
}

// 3) 0 品空弦 + vib：必须报 open-string-vibrato
{
  const c = card([bar(E(0, [1, 0, undefined, { vib: [20, 5, 0.3] }]))]);
  const r = validateCard(c);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.issues[0].rule, "open-string-vibrato");
  assert.strictEqual(r.counts["open-string-vibrato"], 1);
}

// 4) 按弦 + vib：合法
{
  const c = card([bar(E(0, [2, 5, undefined, { vib: [20, 5, 0.3] }]))]);
  assert.strictEqual(validateCard(c).ok, true);
}

// 5) 0 品空弦 + bend：必须报 open-string-bend
{
  const c = card([bar(E(0, [1, 0, undefined, { bend: [2, 0.1, 0.3] }]))]);
  const r = validateCard(c);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.issues[0].rule, "open-string-bend");
}

// 6) 0 品空弦 + steps（空弦锤弦）：合法
{
  const c = card([bar(E(0, [1, 0, undefined, { steps: [{ at: 0.2, semi: 2 }] }]))]);
  assert.strictEqual(validateCard(c).ok, true);
}

// 7) 泛音只轻触节点，不参与品位跨度
{
  const c = card([bar(E(0, [1, 12, "12*", { harm: 2, semi: 12 }], [6, 3]))]);
  assert.strictEqual(validateCard(c).ok, true);
}

// 8) 窗口边界：0.125s 内算同一组（报），0.5s 外拆开（不报）
{
  const c1 = card([bar(E(0, [1, 10]), E(1, [6, 3]))]);
  const c2 = card([bar(E(0, [1, 10]), E(4, [6, 3]))]);
  assert.strictEqual(validateCard(c1).ok, false);
  assert.strictEqual(validateCard(c2).ok, true);
}

// 9) 选项：收紧跨度上限
{
  const c = card([bar(E(0, [1, 5], [6, 3]))]);
  assert.strictEqual(validateCard(c, { maxFretSpan: 1 }).ok, false);
}

// 10) 选项：允许空弦揉弦（纯合成卡片用）
{
  const c = card([bar(E(0, [1, 0, undefined, { vib: [20, 5, 0.3] }]))]);
  assert.strictEqual(validateCard(c, { allowOpenStringVibrato: true }).ok, true);
}

// 11) 选项：只跑指定规则
{
  const c = card([bar(E(0, [1, 10], [6, 3]), E(0, [1, 0, undefined, { vib: [20, 5, 0.3] }]))]);
  const r = validateCard(c, { rules: ["open-string-vibrato"] });
  assert.strictEqual(r.issues.length, 1);
  assert.strictEqual(r.issues[0].rule, "open-string-vibrato");
}

// 12) 现有 19 条卡片全部通过
{
  const results = validateCards([...CARDS, ...DEMOS]);
  const failed = results.filter(r => !r.ok);
  assert.deepStrictEqual(
    failed.map(r => r.cardId),
    [],
    failed.map(r => `${r.cardId}: ${r.issues.map(formatIssue).join(" | ")}`).join("\n"),
  );
}

console.log(
  "validate ok: 跨度（含窗口/选项）、空弦揉弦/推弦、空弦 steps 放行、泛音排除、19 条真实卡片",
);
