#!/usr/bin/env node
/**
 * GScore CLI
 *
 *   npm run score -- examples/18.gtr
 *   npm run score -- examples/18.gtr --check
 *   npm run score -- examples/18.gtr --json
 *
 * 先 npm run build（脚本读 dist/）。
 */
import fs from "node:fs";

import { cardAscii, formatIssue, parseScore, ScoreError, validateCard } from "../dist/index.js";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
if (!file) {
  console.error("用法: npm run score -- <file.gtr> [--check] [--json]");
  process.exit(2);
}

let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (err) {
  console.error(`读不了 ${file}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

try {
  const card = parseScore(text);
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(card, null, 2) + "\n");
  } else {
    const notes = card.bars.reduce((n, b) => n + b[1].reduce((m, e) => m + e[1].length, 0), 0);
    console.log(`# ${card.title} · ${card.sig} · ♩=${card.bpm} · ${card.bars.length} 小节 · ${notes} 音`);
    console.log(cardAscii(card));
  }

  if (args.includes("--check")) {
    const result = validateCard(card);
    if (!result.ok) {
      for (const issue of result.issues) console.error(formatIssue(issue));
      process.exitCode = 1;
    } else {
      console.error(`ok: ${card.bars.length} 小节，可弹性校验通过`);
    }
  }
} catch (err) {
  if (err instanceof ScoreError) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
