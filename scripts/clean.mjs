#!/usr/bin/env node
// 删除构建产物：node scripts/clean.mjs dist build
import fs from "node:fs";

for (const target of process.argv.slice(2)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`cleaned ${target}/`);
}
