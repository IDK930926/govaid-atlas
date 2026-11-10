import {chromium} from "playwright";
const [file, out] = process.argv.slice(2);
const b = await chromium.launch({executablePath: process.env.HOME_PW + "/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe"});
const p = await b.newPage({viewport: {width: 1920, height: 1080}});
await p.goto("file:///" + file + "#2");
await p.keyboard.press("h");
await p.waitForTimeout(1500);
await p.screenshot({path: out});
await b.close();
