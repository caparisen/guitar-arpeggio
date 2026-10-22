#!/usr/bin/env node
/**
 * GScore -> TypeScript Card
 *
 *   npm run build
 *   npm run compile-score -- examples/20.gtr build/geordie-20.ts GEORDIE_20
 *
 * 生成的 .ts 直接 import 到 demos.ts；改谱请改 .gtr 再跑这个脚本。
 */
import fs from "node:fs";
import path from "node:path";

import { formatIssue, parseScore, validateCard } from "../dist/index.js";

const [input, output, exportName] = process.argv.slice(2);
if (!input || !output || !exportName) {
  console.error("用法: npm run compile-score -- <input.gtr> <output.ts> <ExportName>");
  process.exit(2);
}

const text = fs.readFileSync(input, "utf8");
const card = parseScore(text);

const result = validateCard(card);
if (!result.ok) {
  for (const issue of result.issues) console.error(formatIssue(issue));
  console.error(`拒绝生成 ${output}：可弹性校验未通过`);
  process.exit(1);
}

/** 用 TS 字面量而不是 JSON，保留 RawNote 里的 undefined */
function ts(value, indent = 0) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = value.map(v => ts(v, indent + 1));
    if (value.every(v => v === null || typeof v !== "object")) return `[${inner.join(", ")}]`;
    const pad = "  ".repeat(indent);
    return `[\n${inner.map(s => "  ".repeat(indent + 1) + s).join(",\n")}\n${pad}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const pad = "  ".repeat(indent);
    return `{\n${entries
      .map(([k, v]) => `${"  ".repeat(indent + 1)}${JSON.stringify(k)}: ${ts(v, indent + 1)}`)
      .join(",\n")}\n${pad}}`;
  }
  throw new Error(`不支持的字面量类型: ${typeof value}`);
}

const header = [
  `// generated from ${input} by scripts/compile-score.mjs`,
  `// edit the .gtr and re-run: npm run compile-score -- ${input} ${output} ${exportName}`,
  "",
].join("\n");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${header}export const ${exportName} = ${ts(card)};\n`);
console.log(`wrote ${output} (${card.bars.length} bars, ${card.bars.reduce((n, b) => n + b[1].reduce((m, e) => m + e[1].length, 0), 0)} notes)`);
