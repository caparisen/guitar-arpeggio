# Guitar Arpeggio

浏览器里的 Karplus-Strong 吉他合成器。仓库附带 19 条分解和弦 / 扫弦 / 泛音 / 曲目谱例
（含 Joan Baez《Geordie》的 3/4 伴奏，以及旋律 + 加花版）；**npm 包只发布引擎、渲染、
解析和校验，示例/曲目是 `examples/*.gtr`，不进 `dist/`**。
纯 ESM 发布，**没有打包器**。

```bash
npm install
npm run build       # 库 → dist/（不含示例）
npm run build:dev   # 库 + 开发预览 → build/（页面直接 fetch examples/*.gtr）
npm run dev         # build:dev + 开发预览：http://localhost:5173
npm test            # 音频回归（27 项）+ 接线 + 谱面校验（会先 build dist）
npm run validate    # 只跑谱面可弹性校验（会先 build dist）
```

## 用法

```js
import { Engine, browserHost, buildPattern } from "guitar-arpeggio";
import type { Card } from "guitar-arpeggio";

const myCard: Card = {
  id: 1, title: "一个和弦", en: "one chord",
  sig: "4/4", bpm: 80, grid: 16, units: 4, star: "★",
  prog: "C", shapes: "C x32010", how: "", tips: [],
  bars: [["C", [[0, [[5, 3, undefined, { vel: 0.9 }]]]]]],
};

const engine = new Engine(browserHost);
const pattern = buildPattern(myCard);      // 谱面数据 → 音符
engine.play(pattern);                       // 直接排给 Web Audio
```

19 条示例是 `examples/*.gtr`（`examples/index.json` 是清单）；预览页直接
`fetch` + `parseScore`，不经过 TS 示例数据，也不随 npm 包发布。

引擎不碰 DOM：`setTimbre / setBody / setSpeed / play / stop / render / warm`，
测试里换一个 `EngineHost` 就能在 Node 跑。

## 谱面校验

`validateCard()` 把「手弹不出来」的地方挑出来，不改音频：

```js
import { formatIssue, validateCard } from "guitar-arpeggio";

const result = validateCard(myCard);
if (!result.ok) console.log(result.issues.map(formatIssue));
```

规则：

- `fret-span`：0.3 秒窗口内**同时按**的音，品位跨度不能超过 5。空弦不算（不用按），
  泛音不算（只轻触节点）。
- `open-string-vibrato`：0 品空弦不能加 `vib`——左手没有按弦点。
- `open-string-bend`：0 品空弦不能加 `bend` / `pre`（弦长不能变）。`steps`
  （勾弦/锤弦）不在此列：从空弦锤到品格是能弹的。

`validateCard(card, { maxFretSpan, groupWindow, allowOpenStringVibrato, rules })`
可以改限制或只跑某条规则；`validateCards(cards)` 对一组卡片跑。`npm run validate`
对全部 19 条跑一遍，CI 也会跑。

## 谱面力度

`cardAscii()` 默认在六线谱下面多画一行 `d`：

```
d |-ff------p---mp--mf--mp--f---mp--mf--f---p-------|
```

符号 `pp < p < mp < mf < f < ff`。有 `tech.vel` 用它；没有就按弦序 + 拍位重音估一个
（和 `buildPattern` 同一套规则，不含随机抖动）。同一格多个音取最大力度。

`renderBlock(..., { dynamics: true, units })` 可以只对某一块打开；`npm run book`
的打印谱集默认不开，保持原样。

## ASCII 解析 / 播放指针

`cardAscii(card)` 默认在谱面之前输出一个 `#` 文件头，`parseAscii(text)` 直接读回全局字段：

```
# guitar-arpeggio tab v1
# id 17
# title Geordie A 段：旋律 + 加花（23 小节）
# en geordie melody and fills
# sig 3/4
# bpm 96
# grid 12
# units 3
# star ★★☆
# prog ...
# shapes ...
# how ...
# tip ...
```

```js
const text = cardAscii(card);   // 带文件头
const back = parseAscii(text);  // 头里的 id/title/sig/bpm/grid/units/beat/w/star/prog/shapes/how/tip 自动读取

const over = parseAscii(text, { bpm: 80 });  // opts 优先，可覆盖
const tabOnly = cardAscii(card, { header: false }); // 只要谱面
```

文件头只解决**全局字段**；音符级信息按设计仍是近似的：手写标签保留，`~ / \ b h p * x`
还原成近似 `Tech`；时值按同一根弦的下一次拨响推断，力度从 `d` 行读，`p` 行忽略，
`x` 无法还原被闷住的真实品位。**ASCII 是视图，不是完整乐谱**。

播放指针：

```js
const pos = engine.position; // { pattern, bar, slot } | null
cardAscii(card, { pointer: { bar: pos.bar, slot: pos.slot }, header: false });
```

`cardAscii` 每小节多画一行 `p | ... ^ ...`；预览页用 `requestAnimationFrame`
约 30 fps 重绘当前卡片。

## 谱面 / 视图 / 演奏

- **GTR ↔ Card**：完整乐谱；无损。每个音的时值、力度、`Tech`、`label`、`off` 都在。
- **ASCII**：视图。文件头带全局字段；音符级信息按设计舍弃，`parseAscii` 只能近似回读。
- **Pattern**：`buildPattern` 编译出的演奏时间表（绝对秒 / MIDI / 力度 / 人性化抖动），
  给 `Engine` 播放；**不是乐谱源**，也不做反向转换。
- 同一份 GTR/Card 是确定的；`buildPattern` 用固定种子的抖动，所以同一个 Card 得到同一个
  Pattern。真正“每次演奏不同”的是 `Engine.play` 的音频层（力度 / 微时序 / 拨弦位置 /
  变体的随机）；谱面和 Pattern 本身不变。

## GScore（Agent 写谱）

`GScore` 是行式 DSL（`.gtr`），给 Agent 写谱用：`parseScore` 编译成 `Card`，
`cardToScore` 反向导出；ASCII 只是渲染。

```gtr
score geordie-a1
title Geordie A1（换和声）
time 3/4
tempo 96
grid 12
units 3

bar 1 Am7
  arp 1:1 0/A 3 vel=1
  arp 1:1.5 7/D 1.5 vel=.6
  arp 1:2 9/G 1.5 vel=.76
  arp 1:2.5 8/B 1.5 vel=.64
  mel 1:1 8/e 1.5 pre=-1 vib=16,5.2,.35 vel=.94
  mel 1:2.5 8/e .75
  fill 1:2.75 7/D .2 vel=.56
  anno 1:1 melody
```

- `<bar>:<beat> <track> <fret>/<string> <beats> [key=value ...]`；track 可省。
- 音符 `8/e` / `0/A`，也接受 `C5` / `C5@e`；非整拍自动补 `off`。
- 技巧 key 就是 `Tech`：`vel / pre / rel / slide / vib / bend / steps / harm /
  semi / mute / t60 / off / label`。
- 同一 `bar:beat` 多行 = 和弦；没有行 = 休止。
- `//` 注释；`#` 只在行首当注释（`C#5` 不受影响）。
- 头部：`id / title / en / time / tempo / grid / units / beat / w / star / prog /
  shapes / how / tip`。

```bash
npm run build
npm run score -- examples/18.gtr           # 打印 ASCII
npm run score -- examples/18.gtr --check   # 再跑可弹性校验
npm run score -- examples/18.gtr --json    # 输出 Card
```

```js
import { parseScore, cardToScore, cardAscii } from "guitar-arpeggio";

const card = parseScore(text);     // 结构错误带行号/小节/拍
const text2 = cardToScore(card);   // Card -> GScore
```

`cardToScore(parseScore(...))` 对现有 Card 是往返的；`tests/score.test.mjs` 对第 3、17、18、14、20 条
做了 `cardToScore -> parseScore -> cardAscii` 一致性检查（含 6/8 的 `beat`）。`x` 闷音和 `label=` 也保留。

### 用 GScore 生成卡片

`examples/20.gtr` 是第 20 条（第 17 条的加花 + 第 18 条的和声）的源文件。示例页直接读 `.gtr`；
如果要把某个 `.gtr` 固化成 TS 数据，可以：

```bash
npm run build
npm run compile-score -- examples/20.gtr build/geordie-20.ts GEORDIE_20
```

生成 `build/geordie-20.ts`（gitignored）里的一个 TS 字面量。编译脚本会先跑
`validateCard`，不通过就拒绝生成；它用 TS 字面量而不是 JSON，所以 `RawNote` 里的
`undefined` 会原样保留。

## 目录

```
src/engine/    发声引擎（TypeScript，strict）
  types.ts     数据契约
  config.ts    调弦、音色表、琴体模态表
  dsp.ts       琴体 IR 合成、WAV 编码
  voice.ts     单音 buffer 仓库（含 LRU）
  engine.ts    上下文、总线、调度、离线渲染
src/data/      库的数据层
  types.ts     Card / Bar / Event / RawNote
  build.ts     谱面 → 音符（起音、时值、力度）
  ascii.ts     六线谱渲染（含注记行 / 力度行 / 播放指针）
src/ascii-parse.ts  ASCII 谱 → Card 的解析器
src/score.ts   GScore 解析 / 导出（Agent 写谱）
src/validate.ts  谱面可弹性校验（对外 API）
src/dev/       开发预览（不发布，编译到 build/dev）
examples/      19 条 .gtr + index.json（页面直接 fetch）
scripts/load-examples.mjs  examples/*.gtr -> Card（Node 侧测试/校验/谱集）
scripts/score.mjs  GScore CLI
scripts/compile-score.mjs  GScore -> TS 字面量
scripts/clean.mjs  清理 dist / build
tests/         音频回归与接线测试
```

## 实时弦（AudioWorklet）

推弦 / 揉弦 / 勾弦 / 滑音走的是另一条路：`KsString` 在音频线程里改延迟线长度，音高变了、
**时长不变**。其余音仍然用预渲染的 buffer（更省 CPU）。

```js
await engine.prepare();          // 加载 worklet；失败会退回 buffer
engine.play(patternWithBends);
```

共鸣弦是同一条总线上的并联支路：六根空弦用被动谐振器模拟，被所有音
「带着振」。`engine.setSympathetic(false)` 可以关掉。

`prepare()` 返回 false 时一切照常，只是推弦退回 `playbackRate` 重采样
（代价：变调同时变快）。

离线渲染（`engine.render`）没有 AudioWorklet，`steps`（勾弦/拉弦）现在也会用
`playbackRate` 的跳变 + 每一记轻撞击声模拟：音高对，音色和实时弦略有差别。
谱面里 `steps` 会自动标成 `3h5p3`（hammer-on/pull-off；带 glide 的用 `/` `\`），
手写 label 优先。

## 已知缺口

- 测试仍然用 Python + numpy 做 DSP 断言（`tests/test_audio.py`）。属于开发工具，
  不随包发布；迁到 JS 是可选项。
- `guitar-arpeggio-patterns.txt` 由 `scripts/emit-book.mjs` 从 `examples/*.gtr` 生成，
  CI 会检查它是否过期。
