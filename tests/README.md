# 测试

音频项目的麻烦在于“对不对”很难断言。这里把开发过程中反复手工验过的东西固化成了脚本。

测试从 `dist/`（库）和 `examples/*.gtr`（`scripts/load-examples.mjs`）读；`npm test`
会先 `npm run build`（只建 `dist/`）。`npm run build:dev` 只给预览页用，测试不需要。
直接跑单个测试时也要先 `npm run build`。

```bash
python tests/test_audio.py
```

它会先跑 `node tests/dump.mjs`（用 mock 的 Web Audio 环境执行页面脚本，导出 f32 采样），
再用 numpy 做断言。**改了发声代码之后先跑这个**，别靠耳朵。

依赖：node、numpy。

## 覆盖的 10 组

| | 检查什么 | 判据 |
|---|---|---|
| 1 | buffer 健康度 | 全是有限值、不削波（≤1.0）、有能量 |
| 2 | 基频准确度 | 自相关估频，误差 < 1.5% |
| 3 | 三个变体是否真的不同 | 平均逐点差 > 0.02 |
| 4 | 衰减单调 | rms(0.1s) > rms(0.8s) > rms(1.6s)，且末段 < 首段 50% |
| 5 | 泛音音色 | 频谱重心比按弦低 25% 以上 |
| 6 | 琴体 IR | 100 Hz 抬升 > 1.5×，8 kHz < 1.2× |
| 7 | 数据完整性 | 19 条、音高/弦号/时值/力度都在范围内 |
| 8 | 扫弦与滚奏跨度 | 扫弦 10–20 ms，滚奏 40/120/240 ms，方向正确 |
| 9 | WAV 编码 | RIFF 头、PCM 格式、声道/采样率/位深、总长度 |
| 10 | 实时弦（AudioWorklet） | 基频、弯音前后频率、弯音后仍有能量 |

## 两个踩过的坑（都写进注释了）

**估基频不能用频谱最大值。** 低音 E2 的二次谐波本来就比基频强——拨弦位置梳
`sin(kπβ)` 加上琴体 100–200 Hz 抬升，峰值法会判成高八度，测试也就“假失败”了。
改用自相关（FFT 加速，别用 `np.correlate` 的 O(n²)）。

**测试要能失败。** 第 8 组故意卡死跨度数值：如果有人把滚奏改回 80 ms，
它必须红，否则这个测试没有意义。

## 谱面校验

`node tests/validate.test.mjs` 用合成卡片覆盖可弹性规则的正反例；`npm run validate`
对全部卡片跑一遍（CI 也会跑）。规则在 `src/validate.ts`。

`node tests/ascii.test.mjs` 检查 `#` 文件头（默认带 / `header:false` 不带）、力度行
（显式/默认 vel、`renderBlock` 默认不画、Geordie 的 `d` 行）、`steps` 的自动标记
`3h5p3`，以及播放指针 `p` 行的 `^` 位置。

`node tests/ascii-parse.test.mjs` 检查 `parseAscii`：文件头的 id/title/sig/bpm/grid/
units/beat/w/star/prog/shapes/how/tip 自动读取、opts 覆盖、Geordie 原样往返、
指针行忽略、`7/8~`/`7p5`/`12*` 的标签和近似 Tech、一行多小节、空输入报错。

`node tests/engine.test.mjs` 检查实时弦/buffer 分流、退回、断开定时器、离线 IR
采样率、`steps` 在离线 buffer 路径里的 `playbackRate` 跳变（`5h7` +2、`7p5` -2
半音），以及 `position` 的 bar/slot 和 stop 后归零。

`node tests/score.test.mjs` 检查 GScore：第 3/17/18/14/20 条的
`cardToScore -> parseScore -> cardAscii` 往返（含 6/8 的 `beat`）、手写 DSL、
`C5`/`C5@e` 音高、非整拍 `off`、track 默认力度、错误定位、仓库里的 `.gtr` 示例
（含第 20 条）。

## 产物

`tests/out/` 是中间产物（f32 + manifest.json），已 gitignore。
