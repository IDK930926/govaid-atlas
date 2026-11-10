// Edit decision list for the final backup demo. All product footage comes from the single
// continuous take in take/ (real GovAid Atlas run). No speed changes: every segment plays at 1x.
import fs from "node:fs";
import path from "node:path";

import {fileURLToPath} from "node:url";
const S = path.dirname(fileURLToPath(import.meta.url));
const TAKE = path.join(S, "take");
const B = path.join(S, "build");
fs.mkdirSync(B, {recursive: true});
const frames = JSON.parse(fs.readFileSync(path.join(TAKE, "frames.json"), "utf8"));

// [scene, rawStart, rawEnd]  (raw seconds in the take)
const segments = [
  ["S1 Hero", 0.3, 7.3],
  ["S2 Goal", 12.6, 21.6],
  ["S3 Journey→Gate", 21.6, 34.6],
  ["S4 Gate→Resume", 40.0, 49.0],
  ["S5 Actual/What-if", 53.3, 66.3],
  ["S6a Passport", 75.8, 81.3],
  ["S6b Evidence", 83.5, 90.0],
  ["S7 Benchmark", 99.7, 109.7],
];
const ENDCARD = {scene: "S8 Ending", file: path.join(S, "endcard.jpg"), dur: 5.0};

let list = "ffconcat version 1.0\n";
let out = 0;
const edl = [];
for (const [scene, a, b] of segments) {
  let i = frames.findLastIndex((f) => f.t <= a);
  if (i < 0) i = 0;
  const startOut = out;
  let cur = a;
  while (cur < b - 1e-6) {
    const next = i + 1 < frames.length ? Math.min(frames[i + 1].t, b) : b;
    const d = next - cur;
    if (d > 0) {
      list += `file '${path.join(TAKE, "frames", frames[i].name).replace(/\\/g, "/")}'\nduration ${d.toFixed(6)}\n`;
      out += d;
    }
    cur = next;
    i++;
  }
  edl.push({scene, raw: [a, b], out: [+startOut.toFixed(3), +out.toFixed(3)], speed: "1x"});
}
list += `file '${ENDCARD.file.replace(/\\/g, "/")}'\nduration ${ENDCARD.dur}\n`;
edl.push({scene: ENDCARD.scene, raw: "recording-page.html card 2", out: [+out.toFixed(3), +(out + ENDCARD.dur).toFixed(3)]});
out += ENDCARD.dur;
list += `file '${ENDCARD.file.replace(/\\/g, "/")}'\n`;
fs.writeFileSync(path.join(B, "video.ffconcat"), list);
fs.writeFileSync(path.join(B, "edl.json"), JSON.stringify({total: out, edl}, null, 1));

// Captions: one table → burned-in ASS + sidecar SRT.
const cues = [
  [0.3, 6.8, "GovAid Atlas", "可追溯、可暫停、可人工確認的政府補助 AI Agent"],
  [7.2, 11.5, "LLM 只負責理解使用者需求與調度工具"],
  [11.6, 15.8, "資格判定交由 deterministic rules 執行"],
  [16.2, 20.7, "Agent 理解需求、規劃工具", "下一個工具：evaluate_central_rules"],
  [20.9, 28.8, "中央條件 UNCERTAIN（待確認）→ Agent 暫停", "必要資料不足時不猜測，交給 Human Gate 人工確認"],
  [29.2, 32.6, "本人是否持有住宅？→ 沒有自有住宅"],
  [32.8, 37.8, "人工確認後才繼續執行（Resume）", "中央方案 PASS（通過）"],
  [38.3, 44.3, "ACTUAL 新北永和 NT$13,500", "WHAT-IF 臺北文山 NT$15,500"],
  [44.4, 50.8, "中央條件 PASS，但地方必要條件尚未確認", "新北、臺北地方方案仍維持 UNCERTAIN"],
  [51.2, 56.4, "Decision Passport 申辦決策護照", "需要補充的資料・建議下一步・風險提醒"],
  [56.6, 62.8, "官方依據 Evidence：R1・R6・R7", "每項判斷都可追溯到官方來源"],
  [63.3, 66.0, "LLM + Policy Context vs GovAid Atlas", "狀態正確率 70% → 100%｜證據覆蓋率 77.8% → 100%"],
  [66.1, 69.1, "無依據主張 30% → 0%", "過度確定 40% → 0%"],
  [69.2, 72.9, "10 組合成政策導航測試案例", "不代表真實世界整體準確率"],
];
const assT = (t) => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = (t % 60); return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
const srtT = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Microsoft JhengHei,44,&H00FFFFFF,&H00FFFFFF,&H00202020,&H00000000,-1,0,0,0,100,100,1,0,3,14,0,2,80,80,40,1
Style: Badge,Microsoft JhengHei,20,&H00FFFFFF,&H00FFFFFF,&H00353535,&H00000000,-1,0,0,0,100,100,1,0,3,9,0,9,40,14,16,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,${assT(0)},${assT(out)},Badge,,0,0,0,,預錄畫面 · PRE-RECORDED
`;
let srt = "";
cues.forEach(([a, b, ...lines], k) => {
  ass += `Dialogue: 0,${assT(a)},${assT(b)},Cap,,0,0,0,,${lines.join("\\N")}\n`;
  srt += `${k + 1}\n${srtT(a)} --> ${srtT(b)}\n${lines.join("\n")}\n\n`;
});
fs.writeFileSync(path.join(B, "subs.ass"), ass);
fs.writeFileSync(path.join(B, "captions.srt"), srt);

// Narration placement (seconds in output timeline)
const vo = {s1: 0.4, s2: 7.4, s3: 18.8, s4: 29.8, s5: 41.0, s6: 51.4, s7: 63.6, s8: 72.3};
fs.writeFileSync(path.join(B, "vo.json"), JSON.stringify(vo));
console.log("total", out.toFixed(3));
console.log(edl.map((e) => `${e.scene.padEnd(20)} out ${e.out.join("–")}  raw ${e.raw}`).join("\n"));
