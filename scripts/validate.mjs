// 谱面可弹性校验：npm run validate [-- --max-span 5 --window 0.3]
import { formatIssue, validateCards } from "../dist/index.js";
import { CARDS, DEMOS } from "./load-examples.mjs";

const argv = process.argv.slice(2);
const numberArg = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0 || argv[i + 1] == null) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const options = {
  maxFretSpan: numberArg("--max-span", 5),
  groupWindow: numberArg("--window", 0.3),
};

const cards = [...CARDS, ...DEMOS];
const results = validateCards(cards, options);
const failed = results.filter(r => !r.ok);
const total = results.reduce((n, r) => n + r.issues.length, 0);

for (const r of failed) {
  for (const issue of r.issues) console.log(formatIssue(issue));
}

console.log(
  `${cards.length} 条卡片，跨度上限 ${options.maxFretSpan} 品，窗口 ${options.groupWindow}s：` +
    (total === 0 ? "全部通过" : `${failed.length} 条有问题，共 ${total} 处`),
);

process.exit(total === 0 ? 0 : 1);
