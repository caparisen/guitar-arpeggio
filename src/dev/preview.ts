/**
 * 开发预览页（不随包发布）。
 * 从 examples/index.json 读 GScore 文件，parseScore -> buildPattern -> 卡片；
 * 同时生成左侧固定导航，播放指针仍是 ASCII 的 p 行。
 */
import { Engine, browserHost, buildPattern, cardAscii, parseScore } from "../index.js";
import type { Card, Pattern } from "../index.js";

const engine = new Engine(browserHost);
const views = new Map<Pattern, { card: Card; pre: HTMLPreElement }>();
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const app = $("app");
const toc = $("toc");
const status = $("status");
let exporting = false;
let items: ReadonlyArray<{ card: Card; pattern: Pattern }> = [];
const links = new Map<number, HTMLAnchorElement>();

interface ManifestEntry {
  id: number;
  file: string;
  title: string;
}
interface Manifest {
  files: ManifestEntry[];
}

async function loadItems(): Promise<Array<{ card: Card; pattern: Pattern }>> {
  const res = await fetch("examples/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`examples/index.json: HTTP ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  return Promise.all(
    manifest.files.map(async entry => {
      const r = await fetch(`examples/${entry.file}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${entry.file}: HTTP ${r.status}`);
      const card = parseScore(await r.text());
      return { card, pattern: buildPattern(card) };
    }),
  );
}

function cardNode(card: Card, pattern: Pattern): HTMLElement {
  const div = document.createElement("div");
  div.className = "card";
  div.id = `c${card.id}`;
  div.dataset.id = String(card.id);

  const hd = document.createElement("div");
  hd.className = "hd";

  const no = document.createElement("span");
  no.className = "no";
  no.textContent = String(card.id).padStart(2, "0");
  hd.append(no);

  const tt = document.createElement("span");
  tt.className = "tt";
  tt.textContent = card.title;
  hd.append(tt);

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${card.en} · ${card.sig} · ♩=${card.bpm} · ${card.star}`;
  hd.append(meta);
  div.append(hd);

  const prog = document.createElement("div");
  prog.className = "meta";
  prog.style.marginTop = "4px";
  prog.textContent = card.prog;
  div.append(prog);

  const pre = document.createElement("pre");
  pre.textContent = cardAscii(card, { pointer: { bar: 0, slot: 0 }, header: false });
  views.set(pattern, { card, pre });
  div.append(pre);

  const how = document.createElement("div");
  how.className = "how";
  how.textContent = card.how;
  div.append(how);

  const row = document.createElement("div");
  row.className = "row";

  const play = document.createElement("button");
  play.textContent = "▶ 播放";
  play.onclick = () => {
    if (exporting) return;
    engine.stop();
    div.classList.add("playing");
    const dur = engine.play(pattern);
    window.setTimeout(() => div.classList.remove("playing"), dur * 1000 + 200);
  };
  row.append(play);

  const wav = document.createElement("button");
  wav.textContent = "⤓ WAV";
  wav.onclick = async () => {
    if (exporting) return;
    exporting = true;
    const old = wav.textContent;
    wav.disabled = true;
    wav.textContent = "导出中…";
    try {
      const buf = await engine.render(pattern);
      const url = URL.createObjectURL(Engine.encodeWav(buf));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${String(card.id).padStart(2, "0")}-${card.en.replace(/[^\w-]+/g, "_")}-${engine.timbre}.wav`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      window.alert(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      exporting = false;
      wav.disabled = false;
      wav.textContent = old;
    }
  };
  row.append(wav);

  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = `${(pattern.barSec * pattern.bars).toFixed(1)} 秒 · ${pattern.notes.length} 音`;
  row.append(hint);

  div.append(row);
  return div;
}

/** 左侧固定导航 + 滚动高亮 */
function buildToc(): void {
  toc.innerHTML = "";
  const head = document.createElement("div");
  head.className = "toc-h";
  head.textContent = "示例";
  toc.append(head);
  for (const { card } of items) {
    const a = document.createElement("a");
    a.href = `#c${card.id}`;
    a.textContent = `${String(card.id).padStart(2, "0")} ${card.title}`;
    toc.append(a);
    links.set(card.id, a);
  }
  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = Number((entry.target as HTMLElement).dataset.id ?? 0);
        for (const [key, link] of links) link.classList.toggle("on", key === id);
      }
    },
    { rootMargin: "-130px 0px -65% 0px" },
  );
  for (const { card } of items) {
    const el = document.getElementById(`c${card.id}`);
    if (el) observer.observe(el);
  }
}

let allPlaying = false;
let allTimer = 0;

function initControls(): void {
  $("all").onclick = () => {
    if (allPlaying) return;
    engine.stop();
    let at: number | undefined = undefined;
    for (const { card, pattern } of items) {
      const dur = engine.play(pattern, at);
      const el = document.getElementById(`c${card.id}`);
      el?.classList.add("playing");
      window.setTimeout(() => el?.classList.remove("playing"), dur * 1000 + 200);
      at = (at ?? (engine.context?.currentTime ?? 0) + 0.12) + dur + 0.75;
    }
    const totalMs = ((at ?? 0) - (engine.context?.currentTime ?? 0)) * 1000;
    const btn = $<HTMLButtonElement>("all");
    allPlaying = true;
    btn.disabled = true;
    allTimer = window.setTimeout(() => {
      allPlaying = false;
      btn.disabled = false;
    }, Math.max(1000, totalMs));
  };

  $("stop").onclick = () => {
    window.clearTimeout(allTimer);
    allPlaying = false;
    $<HTMLButtonElement>("all").disabled = false;
    engine.stop();
  };

  const spd = $<HTMLInputElement>("spd");
  spd.oninput = () => {
    $("spdv").textContent = `${spd.value}%`;
    engine.setSpeed(Number(spd.value) / 100);
  };

  $("timbre").addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest("button[data-t]");
    if (!(btn instanceof HTMLButtonElement)) return;
    for (const b of document.querySelectorAll("#timbre button")) b.classList.remove("on");
    btn.classList.add("on");
    engine.stop();
    engine.setTimbre(btn.dataset.t === "nylon" ? "nylon" : "steel");
    engine.warm(items.map(i => i.pattern));
  });

  $("sym").addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest("button[data-s]");
    if (!(btn instanceof HTMLButtonElement)) return;
    for (const b of document.querySelectorAll("#sym button")) b.classList.remove("on");
    btn.classList.add("on");
    engine.setSympathetic(btn.dataset.s === "on");
  });

  $("body").addEventListener("click", e => {
    const btn = (e.target as HTMLElement).closest("button[data-b]");
    if (!(btn instanceof HTMLButtonElement)) return;
    for (const b of document.querySelectorAll("#body button")) b.classList.remove("on");
    btn.classList.add("on");
    engine.setBody(btn.dataset.b === "on");
  });
}

// 播放指针：约 30 fps 只重绘当前卡片；停止后指针回到第 1 小节第 1 格
let lastPattern: Pattern | null = null;
let lastFrame = 0;
const resetPointer = (pattern: Pattern): void => {
  const v = views.get(pattern);
  if (v) v.pre.textContent = cardAscii(v.card, { pointer: { bar: 0, slot: 0 }, header: false });
};
const drawPointer = (now: number): void => {
  window.requestAnimationFrame(drawPointer);
  if (now - lastFrame < 33) return;
  lastFrame = now;
  const pos = engine.position;
  if (!pos) {
    if (lastPattern) resetPointer(lastPattern);
    lastPattern = null;
    return;
  }
  if (lastPattern && lastPattern !== pos.pattern) resetPointer(lastPattern);
  const v = views.get(pos.pattern);
  if (!v) {
    lastPattern = null;
    return;
  }
  v.pre.textContent = cardAscii(v.card, { pointer: { bar: pos.bar, slot: pos.slot }, header: false });
  lastPattern = pos.pattern;
};
window.requestAnimationFrame(drawPointer);

async function boot(): Promise<void> {
  try {
    status.textContent = "加载 examples/*.gtr …";
    items = await loadItems();
    for (const { card, pattern } of items) app.append(cardNode(card, pattern));
    buildToc();
    initControls();
    status.textContent = `已加载 ${items.length} 条 · 实时弦检测中…`;
    void selfCheck();
  } catch (err) {
    status.textContent = `加载失败：${err instanceof Error ? err.message : String(err)}`;
    app.textContent = "examples/ 加载失败；确认 npm run dev 且 examples/index.json 存在。";
  }
}

async function selfCheck(): Promise<void> {
  try {
    const ok = await engine.prepare();
    if (!ok) {
      status.textContent = "实时弦：不可用（推弦退回 buffer）";
      return;
    }
    const before = engine.liveCount;
    const bendCard = items.find(i => i.card.id === 9);
    if (!bendCard) throw new Error("找不到第 9 条");
    engine.play(bendCard.pattern);
    const live = engine.liveCount - before;
    engine.stop();
    status.textContent = `实时弦：已启用（${live} 个音）｜共鸣：${engine.sympatheticReady ? "开" : "关"}`;
  } catch (err) {
    status.textContent = `自检失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

// 首次交互后再预热，避免无手势就建 AudioContext
let warmed = false;
document.addEventListener(
  "pointerdown",
  () => {
    if (warmed) return;
    warmed = true;
    void engine.prepare();               // 加载 AudioWorklet，失败就退回 buffer
    engine.warm(items.map(i => i.pattern));
  },
  { once: true },
);

void boot();
