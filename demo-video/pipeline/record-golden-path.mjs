// One continuous, uninterrupted Golden Path capture of the real GovAid Atlas UI.
// Frames come from Chrome's CDP screencast; events.json logs timestamps for editing.
import {chromium} from "playwright";
import fs from "node:fs";
import path from "node:path";

const URL = process.argv[2] ?? "https://govaid.torchark.tw";
const OUT = process.argv[3] ?? "raw";
fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(path.join(OUT, "frames"), {recursive: true});
fs.mkdirSync(path.join(OUT, "shots"), {recursive: true});

const browser = await chromium.launch({headless: true, executablePath: process.env.HOME_PW + "/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe", args: ["--hide-scrollbars", "--force-color-profile=srgb"]});
const context = await browser.newContext({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1, locale: "zh-TW", timezoneId: "Asia/Taipei", colorScheme: "light"});
// Recording aid only: a visible cursor (headless Chrome draws none). pointer-events:none, no DOM logic touched.
await context.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__rec_cursor";
    c.style.cssText = "position:fixed;left:-100px;top:-100px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,196,0,.35);border:2px solid rgba(30,30,30,.85);box-shadow:0 0 0 4px rgba(255,196,0,.18);pointer-events:none;z-index:2147483647;transition:transform .12s ease";
    document.documentElement.appendChild(c);
    window.addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    window.addEventListener("mousedown", () => { c.style.transform = "scale(.7)"; }, true);
    window.addEventListener("mouseup", () => { c.style.transform = "scale(1)"; }, true);
  });
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

const frames = [];
const events = [];
let t0 = null;
let n = 0;
cdp.on("Page.screencastFrame", async (f) => {
  const ts = f.metadata.timestamp;
  if (t0 === null) t0 = ts;
  const name = `f${String(n++).padStart(6, "0")}.jpg`;
  fs.writeFileSync(path.join(OUT, "frames", name), Buffer.from(f.data, "base64"));
  frames.push({name, t: ts - wall0});
  cdp.send("Page.screencastFrameAck", {sessionId: f.sessionId}).catch(() => {});
});
const now = () => (t0 === null ? 0 : Date.now() / 1000 - wall0);
let wall0 = 0;
const mark = async (label, shot = true) => {
  const t = Date.now() / 1000 - wall0;
  events.push({label, t});
  console.log(t.toFixed(2), label);
  if (shot) await page.screenshot({path: path.join(OUT, "shots", `${String(events.length).padStart(2, "0")}-${label}.png`)});
};
const pause = (ms) => page.waitForTimeout(ms);
let mx = 960, my = 700;
async function moveTo(x, y, steps = 30) { await page.mouse.move(x, y, {steps}); mx = x; my = y; }
async function moveToEl(loc, steps = 30) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await moveTo(b.x + b.width / 2, b.y + b.height / 2, steps);
}
async function smoothScrollTo(y, ms = 1500) {
  await page.evaluate(async ({y, ms}) => {
    const s = window.scrollY, d = y - s, st = performance.now();
    await new Promise((r) => { const f = (now) => { const p = Math.min(1, (now - st) / ms); const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; window.scrollTo(0, s + d * e); p < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  }, {y, ms});
}
async function scrollElTop(loc, offset = 90, ms = 1500) {
  const y = await loc.evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
  await smoothScrollTo(Math.max(0, y), ms);
}

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

await page.goto(URL, {waitUntil: "networkidle"});
await page.getByText("AVAILABLE", {exact: true}).first().waitFor({timeout: 30000});
await page.mouse.move(mx, my);
await pause(1000);
wall0 = Date.now() / 1000;
await cdp.send("Page.startScreencast", {format: "jpeg", quality: 94, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1});
await pause(200);
await mark("hero");
// S1 hero: gentle cursor drift so the screencast keeps producing frames
await moveTo(1500, 260, 120);
await pause(3000);
await moveTo(1100, 500, 90);
await pause(1800);
// S2 goal
await mark("goal-move", false);
await moveTo(760, 480, 45);
await pause(3200);
const cta = page.locator("button.cta");
await mark("cta-move", false);
await moveToEl(cta, 45);
await pause(1000);
await mark("click-start");
await cta.click();

// S3 journey → Human Gate (real model call; wait as long as it takes)
const gateBtn = page.getByRole("button", {name: "沒有自有住宅"});
await gateBtn.waitFor({state: "visible", timeout: 240000});
await mark("gate-visible", false);
await pause(1200);
await mark("gate");
// read along the gate: stepper, then the paused-state note
await moveTo(330, 300, 60);
await pause(2500);
await moveTo(840, 527, 70);
await pause(3500);
await mark("gate-move-to-btn", false);
await moveToEl(gateBtn, 45);
await pause(900);
await mark("click-gate");
await gateBtn.click();

// S4 resume → central PASS
await page.locator(".app.phase-decide").waitFor({state: "visible", timeout: 240000});
await mark("decide-visible", false);
await pause(1500);
await mark("decide-top");
await moveTo(500, 340, 60);
await pause(5000);

// S5 actual vs what-if
await mark("scroll-compare", false);
await moveTo(960, 600, 30);
const compareHead = page.getByText("目前住址 vs 搬遷假設").first();
await scrollElTop(compareHead, 96, 1600);
await mark("compare");
await moveTo(740, 470, 70);
await pause(3500);
await moveTo(1360, 470, 70);
await pause(3500);
await moveTo(1300, 600, 50);
await pause(3500);

// S6 decision passport
await mark("scroll-passport", false);
const passportHead = page.getByText("申辦決策護照").first();
await scrollElTop(passportHead, 150, 1600);
await mark("passport");
await moveTo(700, 330, 60);
await pause(3500);
await mark("scroll-evidence", false);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
await smoothScrollTo(total - 1080, 1600);
await mark("evidence");
await moveTo(1400, 640, 70);
await pause(5500);

// S7 benchmark
await mark("gov-move", false);
const gov = page.getByRole("button", {name: "查看系統如何控制風險"});
await moveToEl(gov, 40);
await pause(500);
await mark("click-gov");
await gov.click();
await pause(900);
const evalTab = page.locator("#gov-tab-EVAL");
await moveToEl(evalTab, 40);
await pause(400);
await mark("click-eval");
await evalTab.click();
await pause(900);
await mark("eval");
await moveTo(1700, 760, 80);
await pause(9000);
fs.writeFileSync(path.join(OUT, "eval.html"), await page.content());
await mark("end");
await cdp.send("Page.stopScreencast");
await pause(500);
fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify(frames));
fs.writeFileSync(path.join(OUT, "events.json"), JSON.stringify({events, consoleErrors, url: URL, frames: frames.length}, null, 1));
console.log("frames", frames.length, "consoleErrors", consoleErrors);
await browser.close();
