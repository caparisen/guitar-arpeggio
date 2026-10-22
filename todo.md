# Guitar Arpeggio — 待办

浏览器里的拨弦合成器 + 六线谱播放器。纯 ESM 发布，无打包器。

## 已完成

- [x] Karplus-Strong 发声核心（双极化、拨弦位置梳、按弦衰减、力度→亮度）
- [x] 钢弦 / 尼龙弦两档音色
- [x] 琴体卷积：程序合成 IR，并联送音（不是替换干声）
- [x] 推弦 / 揉弦 / 预推弦（playbackRate 自动化）
- [x] 扫弦、闷音、切音、琶音滚奏（同一套错开机制，跨度 13–240 ms）
- [x] 自然泛音（12/7/5 品）+ 滑音噪声
- [x] 16 条练习与演示，含 ASCII 谱与注记行
- [x] 导出 WAV（OfflineAudioContext）
- [x] 音频回归测试（21 项）
- [x] **TypeScript 化**：strict + 零 any，`tsc` 直接产出可发布的 ESM
- [x] 引擎与 DOM 解耦，`EngineHost` 可注入（测试不再 mock document）

- [x] **指弹小品（第 15 条）**：12 小节 A 小调，低音交替 + 旋律，
      依次用上分解、泛音、勾弦、滑音、推弦、揉弦、滚和弦
  - 坑：`dur` 在数据里是「槽数」，`buildPattern` 要的是秒，直接传会得到 12 秒长音
  - 坑：7 品泛音在 2 弦上是 F#，A 小调里不能要，得手动挑弦

## 待办

- [x] **谱集生成器迁移**：`scripts/emit-book.mjs` 从 `Card[]` 直接产出 txt，
      和旧 Python 产物逐行对比只差一处措辞（原文指向已删除的 html 文件）
- [ ] **测试迁到 JS**（可选）：现在 DSP 断言靠 Python + numpy，是开发依赖，
      不随包发布。迁过去可以去掉 Python 依赖。
- [~] **AudioWorklet**（进行中）
  - [x] `KsString`：纯 DSP 的实时弦，延迟线长度可变 → 推弦/滑音不改时长
        - 坑：写指针要初始化到 `ceil(delay)`，否则读位置落在未填充区，直接静音
        - 一阶低通有相位延迟，算延迟长度时要扣掉 `a/(1-a)`，否则音高偏低
  - [x] `ks-processor.ts` 外壳（注册 / 消息 / 双声道）+ `worklet/index.ts` 加载器
  - [x] 测试：基频、弯音前后频率、弯音后仍有能量（27 项全过）
  - [x] **接线**：`Engine.prepare()` 加载 worklet，带 bend/pre/vib 的音走实时弦，
        其余仍走 buffer；`addModule` 失败自动退回 buffer（推弦会变调变快）
        - 坑：`new URL("./worklet/...", import.meta.url)` 多了一级，实际是同级目录
        - 坑：引擎里别写 `window.setTimeout`，Node 测试会挂
        - 坑：实时弦激励没归一化，输出峰值只有 0.28（buffer 是 0.85），
          实际听感上推弦的音比低音小 10 dB，会被完全盖住
        - 坑：断开的定时器从「排程时刻」算而不是「起音时刻」，
          整条一次排完时，第 2 小节被切短、第 3/4 小节还没响就被断开
  - [x] **勾弦 / 拉弦 / 滑音**：`tech.steps` 在指定时刻跳音高（不重新拨弦），
        引擎在那一刻补一记很轻的撞击声；滑音复用 bend + 擦弦噪声
        - 坑：测试里 `currentFrame` 没归零就 handle，起音帧被算到未来，
          前 0.23 s 全是静音，测出来的音高是过渡段的平均值
  - [x] **共鸣弦**：总线上并联一个 `sympathetic` worklet，六根空弦作为被动
        梳状谐振器被总线信号驱动；`KsResonator` 是可测的纯 DSP
        - 总线电平 0.22：单弦共振点输出约为输入的 66%，乘完约 −22 dB
        - 与实时弦分开加载，任何一个模块失败都不影响另一个

- [x] **节点泄漏**：`stop()` 只停音源、不摘节点，每次重播都往图上堆几百个，
      连点几次音频线程就崩（先卡顿后静音）
  - 改成全局 `activeNodes` 登记表；每条音的整串节点在音源 `onended` 时摘掉，
    `stop()` 兜底全清；预览页在连播期间禁用按钮

- [x] **播完之后还在响**：共鸣弦的梳状环路里有直流分量在无限循环，
      5 秒后仍有 −48 dB；加了环路 DC blocker + 停声 0.2 秒后的收尾包络，
      现在停声 1 秒衰减 40 dB 以上

- [x] **Geordie（Joan Baez）伴奏（第 16 条）**：A 小调 3/4，4 小节前奏 +
      16 小节 A 段 + 3 小节尾奏；六连音分解，1 弦只在前奏和句尾加花
  - 和弦按 Baez 版本：Am–G–F–C ｜ Am–C–G ｜ Am–C–G–Em ｜ F–C–E–Am
  - 坑：2 弦每小节只响一次，放任它拖过小节线会在 G→F、Em→F 上留下三全音，
    所以 2 弦的时值固定为半小节
  - 坑：6 根弦一起落的滚和弦会把总线顶到 1.0；E 和 Am 的尾奏滚和弦
    把力度压到 0.7、跨度放到 80 ms

- [x] **Geordie 旋律 + 加花（第 17 条）**：把声乐旋律搬到 1 弦，叠在第 16 条的
      分解上；A 段 16 小节，旋律落 0/3/6/9 格
  - 旋律按 Baez 版本的 ABC 转写（Am，原谱 2/4）重排成 3/4
  - 坑：第 15 小节的 D4 低于 1 弦空弦，必须换到 2 弦 3 品（E7 的七音）
  - 坑：旋律的 E4 / C5 会和伴奏低八度的 2 分音叠在同一频率上；
    旋律力度提到 0.94，并把 A 段里抢 1 弦的加花关掉（`makeBars(false)`）
  - 坑：开把位分解 + 高把位旋律会出现「1 弦 10 品 + 6 弦 3 品」这种 7–9 品
    跨距，等于要求章鱼；A 段第 1、6–11 小节把分解整体搬到旋律所在的把位
    （7–10 / 8–10 / 10–12），低音改用 5/6 弦高把位或空弦，跨距全部 ≤5
  - 美化：按弦长音加揉弦（playbackRate LFO）；进入音用 `pre` 从下方滑入 +
    `slide` 擦弦噪声；第 12 小节用 hammer-on/pull-off 做 G–A–G；尾奏最后一拍换成 7 品泛音 B5
  - 加花：`FILLS` 只留 8 个单音（力度 0.56，p）：内声部/倚音；
    中间的音改用滑音/推弦——`/` 上滑、`\` 先推后放、`8b10` 推全音，
    不再用成串的十六分音符（之前 50 多个，听起来比旋律快一档、喧宾夺主）
  - 长音 E4 换到 2 弦 5 品（同一个音，可揉）；A 段第 4/5/14 小节伴奏让出
    2 弦，A5 用 3 弦 5 品 C4 补回小三度；空弦 E4 只留在 A15/A16 的经过音
  - 谱面：`RawNote` 的显示标签由 `pre`/`bend`/`vib`/`steps` 自动生成（`7/8~`、`10/12`、
    `5~`、`3h5p3~`），空弦写 `0`，泛音写 `7*`，第 12 小节加 `turn` 注记——之前只写了
    `Tech`，谱面只有品号

- [x] **勾弦/拉弦 `steps` 的离线渲染 + 谱面自动标记**：
      `applyTech` 在 buffer 路径按 `steps` 跳 `playbackRate`，每一步补一记轻拨片声；
      `renderBar` 对没有手写 label 的 `steps` 自动生成 `3h5p3`（glide 用 `/` `\`）。
      A12 的 G–A–G 改成一次拨弦的 `3h5p3~`；`tests/engine.test.mjs` 验 ±2 半音，
      `tests/ascii.test.mjs` 验自动标记

- [x] **18 / 19：两种编曲实验（同旋律，前 8 小节）**：
      18 只换和声：Am7–G6–Fmaj7–Cmaj7/E ｜ Am7–Cmaj7–G6–Gadd9，低音 A–G–F–E；
      19 伴奏切分：低音仍在第 1 拍，其余 5 个分解音整体晚一个十六分（0/3/5/7/9/11）。
      两条复用第 17 条的 MELODY / FILLS，方便直接 A/B；`src/data/geordie-variants.ts`。

- [x] **ASCII 解析 `parseAscii`（对外）**：`cardAscii` → `Card`，保留手写标签，
      把 `~ / \ b h p * x` 还原成近似 `Tech`；时值按同弦下一次拨响推断，
      力度从 `d` 行读；支持一小节一块和一行多小节。
      `bpm/sig/grid/units/w` 不在谱面里，必须通过 `ParseOptions` 传。
      `tests/ascii-parse.test.mjs` 覆盖 Geordie 往返、指针行忽略、标签/Tech、
      多小节、空输入报错。

- [x] **播放指针（ASCII）**：`Engine.position` 用 timeline + `currentTime` 算
      `{ pattern, bar, slot }`；`cardAscii({ pointer })` 每小节多一行 `p | ... ^ ...`；
      预览页约 30 fps 只重绘当前卡片。`tests/ascii.test.mjs` 验 `^` 的列位置，
      `tests/engine.test.mjs` 验 bar/slot 和 stop 后归零。

- [x] **清理 dist**：`tsconfig.json` 只编译库（`exclude` `src/dev`）→ `dist/`；
      `tsconfig.dev.json` 把库 + 开发预览编译到 `build/`；`scripts/clean.mjs` 每次构建先清空；
      npm `files` 只有 `dist`；示例是根目录 `examples/*.gtr`，测试/校验/谱集走
      `scripts/load-examples.mjs`，预览页直接 fetch + `parseScore`。
      `dist/` 现在只有 `index`、`ascii-parse`、`score`、`validate`、`data/{types,build,ascii}`、`engine/`。

- [x] **ASCII 文件头**：`cardAscii` 默认输出 `# guitar-arpeggio tab v1` +
      `id/title/en/sig/bpm/grid/units/beat/w/star/prog/shapes/how/tip`；
      `parseAscii` 自动读，`opts` 覆盖；`header:false` 只出谱面。
      音符级信息按设计仍近似（时值/力度/精确 Tech/off 等舍弃）。
      预览页的 `pre` 用 `header:false` 保持紧凑；`score` CLI 默认带文件头。

- [x] **examples 全 .gtr + 页面直读 + 导航/固定顶栏**：
      19 条 `examples/*.gtr` + `examples/index.json`；页面 fetch + `parseScore`，
      不再 import TS 示例；`tests` / `validate` / `book` 走 `scripts/load-examples.mjs`。
      页面左侧固定导航（滚动高亮）+ 固定顶栏（全部按钮/速度/状态）；
      `examples/03.gtr` 补 `beat ♩.`；`scores/` 的样例合并进 `examples/`。

- [x] **20：17 的加花 + 18 的和声（16 小节）**：
      `examples/20.gtr` 是源文件（16 小节、140 音）；`scripts/compile-score.mjs`
      生成 `src/data/geordie-combined.ts`，`demos.ts` 直接 import。
      和声：Am7–G6–Fmaj7–Cmaj7/E ｜ Am7–Cmaj7–G6–Gadd9 ｜ Am7–Cmaj7–G–Em7 ｜
      Fmaj7–Cmaj7/E–E7–Am7；第 4/14 小节低音 E，前四小节 A–G–F–E。
      旋律/加花/滑音/勾弦沿用第 17 条 A 段；`tests/score.test.mjs` 加了第 20 条往返和 .gtr 校验。

- [x] **GScore（Agent 写谱 DSL）**：`src/score.ts` 的 `parseScore` / `cardToScore` /
      `ScoreError`；行式 `bar:beat track fret/string beats tech...`；`C5` / `C5@e`；
      非整拍自动补 `off`；头部 `time/tempo/grid/units/...`；`//` 注释。
      `scripts/score.mjs`（ASCII / `--check` / `--json`）；`examples/18.gtr`；
      `tests/score.test.mjs` 覆盖 17/18/14 的 Card 往返、手写 DSL、音高、off、
      track 默认力度、错误、示例。
  - 同时把 `pre/bend/vib/steps/harm` 的标签生成收敛到 `noteLabel`，`renderBar`
    自动用；GScore 里不写 `label=`，ASCII 也会显示 `7/8~` / `8b10` / `3h5p3~`。

- [x] **WAV 导出的采样率 bug**：实时 `AudioContext` 常是 48 kHz，离线导出固定
      44.1 kHz；`ConvolverNode` 不接受采样率不匹配的 IR，点「WAV」会抛
      `NotSupportedError`
  - 修法：`VoiceBank` 的所有缓存键（琴体 IR、单音、拨片、滑音）都带上
    `ctx.sampleRate`，离线图重新生成 44.1k 的 IR
  - 测试：`tests/engine.test.mjs` 用 48k 实时上下文 + 44.1k 离线上下文跑一遍
    `render`，断言离线卷积节点拿到的是 44.1k IR

- [x] **对外校验模块 `src/validate.ts`**：把「手弹不出来」的规则做成 API
  - `fret-span`：0.3 秒窗口内同时按的品位跨度 >5 报错；空弦、泛音不计
  - `open-string-vibrato`：0 品 + `vib` 报错（左手没有按弦点）
  - `open-string-bend`：0 品 + `bend`/`pre` 报错；`steps`（空弦锤弦）放行
  - `npm run validate` 跑全部 16 条卡片，CI 加了一步
  - `tests/validate.test.mjs`：跨 7 品、空弦 vib/bend、空弦 steps、泛音排除、
    窗口边界、选项、16 条真实卡片

- [x] **谱面力度行**：`cardAscii()` 在六线谱下面多画 `d` 行（pp–ff），
      同一格取最大力度；`renderBlock(..., { dynamics: true, units })` 可选
  - 显式 `tech.vel` 优先；没有按弦序 + 拍位重音估（与 buildPattern 同规则）
  - 预览页默认显示；`npm run book` 默认不显示，打印谱集不变
  - `tests/ascii.test.mjs` 覆盖显式/默认力度、开关、Geordie 力度行

## 已知问题

- 密集扫弦 / 滚和弦的瞬态会顶到 0 dB（主压缩器是 -18 dB / 3:1，不是限幅器）；
  第 10、13 条有数百个采样被削平。Geordie 靠滚和弦力度 0.7 + 高音时值收短，
  峰值压到 0.98，已经没有削波。
- 推弦走 playbackRate 重采样：变调同时变快，推全音尾音提前 12%
- 无力度分层（靠 highshelf 模拟亮度），大力弹会有点「薄」
- 泛音延音受 buffer 2 秒上限限制，真琴能响 4–5 秒
- 首次交互后要后台烤 ~75 个 buffer（约 2.5 s CPU），期间点播放可能卡一下
