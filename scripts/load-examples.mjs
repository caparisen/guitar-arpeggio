// 从 examples/*.gtr 读全部示例（Node 侧：测试 / 校验 / 打印谱集）。
// 页面走 fetch，不 import 这个文件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseScore } from "../dist/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "examples");
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));

export const ALL = manifest.files.map(entry =>
  parseScore(fs.readFileSync(path.join(DIR, entry.file), "utf8")),
);
export const CARDS = ALL.filter(c => c.id <= 8);
export const DEMOS = ALL.filter(c => c.id >= 9);
export { manifest };
