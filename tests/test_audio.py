# -*- coding: utf-8 -*-
"""音频回归测试：跑 node tests/dump.js 导出 buffer，再在这里断言。

判据来自开发过程里反复手工验过的东西：基频准不准、衰减是不是单调、
泛音的频谱重心是不是明显更低、扫弦/滚奏的跨度对不对、WAV 头对不对。

用法：python tests/test_audio.py
"""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
MANIFEST = os.path.join(OUT, "manifest.json")
SR = 44100

passed = []
failed = []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  " + detail) if detail else ""))


def load(name):
    return np.fromfile(os.path.join(OUT, name + ".f32"), dtype="<f4").astype(np.float64)


def f0_est(x):
    """自相关估基频（FFT 加速）。

    不能用「频谱最大值」——低音 E2 的二次谐波本来就比基频强
    （拨弦位置梳 sin(kπβ) 加上琴体 100–200 Hz 抬升），峰值法会判成高八度。
    """
    seg = x[2000:2000 + 16384]
    seg = seg - seg.mean()
    n = len(seg)
    N = 1 << (2 * n - 1).bit_length()
    F = np.fft.rfft(seg, N)
    ac = np.fft.irfft(F * np.conj(F), N)[:n]
    lo, hi = int(SR / 1200), int(SR / 70)
    k = int(np.argmax(ac[lo:hi])) + lo
    if 0 < k < n - 1:
        a, b, c = ac[k - 1], ac[k], ac[k + 1]
        den = a - 2 * b + c
        d = 0.5 * (a - c) / den if den else 0.0
        return float(SR / (k + d))
    return float(SR / k)


def rms(x, t):
    s = int(t * SR)
    seg = x[s:s + 2205]
    return float(np.sqrt((seg ** 2).mean())) if len(seg) else 0.0


def centroid(x):
    w = 8192
    seg = x[2000:2000 + w] * np.hanning(w)
    S = np.abs(np.fft.rfft(seg))
    f = np.fft.rfftfreq(w, 1 / SR)
    return float((S * f).sum() / max(S.sum(), 1e-12))


def run_dump():
    r = subprocess.run(["node", os.path.join(HERE, "dump.mjs")],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print("[dump 失败]")
        print(r.stdout)
        print(r.stderr)
        return False
    print(r.stdout.strip())
    return True


def main():
    if not run_dump():
        return 2
    if not os.path.exists(MANIFEST):
        print("dump 没有产出 manifest.json")
        return 2
    man = json.load(open(MANIFEST, encoding="utf-8"))
    names = {b["name"] for b in man["buffers"]}

    print("\n[1] buffer 基本健康度")
    bad = []
    for n in sorted(names):
        x = load(n)
        if not np.isfinite(x).all() or np.abs(x).max() > 1.0 or np.sqrt((x ** 2).mean()) < 1e-4:
            bad.append(n)
    check("所有 buffer 有限、不削波、有能量", not bad, str(bad[:3]))

    print("\n[2] 基频准确度（容差 1.5%）")
    for t in ("steel", "nylon"):
        for midi, sidx in ((40, 6), (52, 4), (64, 1)):
            exp = 440.0 * 2 ** ((midi - 69) / 12)
            errs = []
            for v in range(3):
                name = f"note_{t}_{midi}_{sidx}_v{v}"
                if name not in names:
                    errs.append(9.9)
                    continue
                got = f0_est(load(name))
                errs.append(abs(got - exp) / exp)
            check(f"{t} midi{midi} 三个变体的基频", max(errs) < 0.015,
                  f"最大误差 {max(errs) * 100:.2f}%  期望 {exp:.1f}Hz")

    print("\n[3] 三个变体确实不同（不是同一份 buffer）")
    base = load("note_steel_52_4_v0")
    for v in (1, 2):
        o = load(f"note_steel_52_4_v{v}")
        diff = float(np.abs(base[::97] - o[::97]).mean())
        check(f"变体 v0 vs v{v} 有差异", diff > 0.02, f"平均差 {diff:.3f}")

    print("\n[4] 衰减单调且够快")
    for midi, sidx in ((40, 6), (64, 1)):
        x = load(f"note_steel_{midi}_{sidx}_v0")
        a, b, c = rms(x, 0.1), rms(x, 0.8), rms(x, 1.6)
        check(f"midi{midi} 包络递减", a > b > c and c < a * 0.5,
              f"{a:.3f} → {b:.3f} → {c:.3f}")

    print("\n[5] 泛音音色比按弦更纯")
    plain, harm = load("plain_52"), load("harm_52")
    cp, ch = centroid(plain), centroid(harm)
    check("泛音频谱重心明显更低", ch < cp * 0.75, f"{cp:.0f}Hz → {ch:.0f}Hz")

    print("\n[6] 琴体 IR")
    for t in ("steel", "nylon"):
        ir = load(f"ir_{t}")
        H = np.abs(np.fft.rfft(ir, 1 << 15))
        f = np.fft.rfftfreq(1 << 15, 1 / SR)
        ref = float(H[(f > 800) & (f < 1200)].mean())
        low = float(H[(f > 90) & (f < 120)].max()) / max(ref, 1e-9)
        high = float(H[(f > 7000) & (f < 9000)].max()) / max(ref, 1e-9)
        check(f"{t} IR 低频抬升、高频滚降",
              low > 1.5 and high < 1.2,
              f"100Hz {20 * np.log10(low):+.1f}dB  8kHz {20 * np.log10(high):+.1f}dB")

    print("\n[7] 数据完整性（19 条）")
    ps = man["patterns"]
    check("条数 19", len(ps) == 19, f"实际 {len(ps)}")
    bad = []
    for p in ps:
        end = p["barSec"] * p["bars"]
        for n in p["notes"]:
            if not (40 <= n[1] <= 90 and 1 <= n[2] <= 6 and 0 < n[3] <= 2.0
                    and 0 <= n[0] <= end + 0.01 and 0.5 <= n[4] <= 1.0):
                bad.append((p["id"], n))
    check("每个音的音高/弦号/时值/力度都在范围内", not bad, str(bad[:3]))

    print("\n[8] 扫弦与滚奏的跨度")
    def spans(p, gap=0.3):
        ts = sorted((n[0], n[2]) for n in p["notes"])
        groups = []
        for t, s in ts:
            if groups and t - groups[-1][0][0] < gap:
                groups[-1].append((t, s))
            else:
                groups.append([(t, s)])
        return [(g[0][0], (max(x[0] for x in g) - min(x[0] for x in g)) * 1000,
                 [x[1] for x in sorted(g)]) for g in groups]

    strum = next(p for p in ps if p["id"] == 10)
    sp = spans(strum)
    check("第 10 条扫弦跨度 10–20 ms", all(8 <= s <= 20 for _, s, _ in sp),
          f"最大 {max(s for _, s, _ in sp):.0f} ms")

    roll = next(p for p in ps if p["id"] == 13)
    rp = spans(roll)
    want = [40, 120, 240, 240]
    got = [round(s) for _, s, _ in rp]
    check("第 13 条滚奏跨度 40/120/240/240 ms", len(got) == 4 and all(abs(a - b) <= 8 for a, b in zip(got, want)),
          f"实际 {got}")
    check("滚奏最后一段是反向（1 弦先响）", rp[-1][2][0] == 1, str(rp[-1][2]))
    check("滚奏第一段是正向（5 弦先响）", rp[0][2][0] == 5, str(rp[0][2]))

    print("\n[9] WAV 编码")
    if man.get("wav"):
        raw = open(os.path.join(OUT, "test.wav"), "rb").read()
        w = man["wav"]
        ok = (raw[0:4] == b"RIFF" and raw[8:12] == b"WAVE" and raw[12:16] == b"fmt "
              and int.from_bytes(raw[20:22], "little") == 1
              and int.from_bytes(raw[22:24], "little") == w["channels"]
              and int.from_bytes(raw[24:28], "little") == w["sampleRate"]
              and int.from_bytes(raw[34:36], "little") == 16
              and len(raw) == 44 + w["length"] * w["channels"] * 2)
        check("WAV 头与长度正确", ok, f"{len(raw)} 字节")

    print("\n[10] 实时弦（AudioWorklet 核心）")
    ks110, ks220 = load("ks_110"), load("ks_220")
    e110 = abs(f0_est(ks110) - 110) / 110
    e220 = abs(f0_est(ks220) - 220) / 220
    check("实时弦基频 110 Hz", e110 < 0.02, f"误差 {e110 * 100:.2f}%")
    check("实时弦基频 220 Hz", e220 < 0.02, f"误差 {e220 * 100:.2f}%")
    a, b2 = rms(ks220, 0.1), rms(ks220, 1.5)
    check("实时弦会衰减但没提前消失", a > b2 > a * 0.01, f"{a:.3f} → {b2:.3f}")

    bend = load("ks_bend")
    f_before = f0_est(bend[:22050])
    f_after = f0_est(bend[35280:57330])
    check("弯音前 220 Hz", abs(f_before - 220) / 220 < 0.02, f"{f_before:.1f}")
    check("弯音后 247 Hz", abs(f_after - 247) / 247 < 0.02, f"{f_after:.1f}")
    tail = rms(bend, 1.5)
    check("弯音不改时长（1.5 s 处仍有声）", tail > 0.02, f"{tail:.3f}")

    print("\n" + "=" * 60)
    print(f"通过 {len(passed)} 项，失败 {len(failed)} 项")
    if failed:
        for f in failed:
            print("  FAIL " + f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

