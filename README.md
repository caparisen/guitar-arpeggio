# Guitar Arpeggio

浏览器里的 Karplus-Strong 吉他合成器，附带 13 条分解和弦 / 扫弦 / 泛音谱例。
纯 ESM 发布，**没有打包器**。

```bash
npm install
npm run build      # tsc → dist/
npm run dev        # 开发预览：http://localhost:5173
npm test           # 音频回归测试（21 项）
```

## 用法

```js
import { Engine, browserHost, CARDS, buildPattern } from "guitar-arpeggio";

const engine = new Engine(browserHost);
const pattern = buildPattern(CARDS[0]);   // 谱面数据 → 音符
engine.play(pattern);                      // 直接排给 Web Audio
```

引擎不碰 DOM：`setTimbre / setBody / setSpeed / play / stop / render / warm`，
测试里换一个 `EngineHost` 就能在 Node 跑。

## 目录

```
src/engine/    发声引擎（TypeScript，strict）
  types.ts     数据契约
  config.ts    调弦、音色表、琴体模态表
  dsp.ts       琴体 IR 合成、WAV 编码
  voice.ts     单音 buffer 仓库（含 LRU）
  engine.ts    上下文、总线、调度、离线渲染
src/data/      内容层
  patterns.ts  01–08 分解练习
  demos.ts     09–13 技巧演示（推弦 / 扫弦 / 泛音 / 心太软前奏 / 滚奏）
  build.ts     谱面 → 音符（起音、时值、力度）
  ascii.ts     六线谱渲染（含注记行）
src/dev/       开发预览（不发布）
tests/         音频回归测试
```

## 设计上的几个决定

**不用打包器。** `dist/` 里就是浏览器能直接 import 的 ESM。代价是相对导入必须写
`.js` 后缀（tsconfig 用 `nodenext` 强制这一点），换来的是一行 `tsc` 就发布。

**引擎不碰 DOM。** 所有状态通过方法设置，`EngineHost` 抽象掉 `AudioContext` 的创建。
测试因此不需要 mock document。

**内容是数据，不是代码。** 谱例是 `Card` 对象，`buildPattern()` 负责算起音、时值、力度；
渲染器只认 `Pattern`。加一条新练习不用碰引擎。

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

## 已知缺口

- 测试仍然用 Python + numpy 做 DSP 断言（`tests/test_audio.py`）。属于开发工具，
  不随包发布；迁到 JS 是可选项。
- `guitar-arpeggio-patterns.txt`（可打印谱集）目前是冻结产物，生成器还留在旧的
  Python 脚本里，尚未迁移到 `scripts/emit-book.mjs`。
