#!/usr/bin/env node
/**
 * Frostline Lab — site smoke test.
 *
 * Serves site/ over HTTP and drives headless Chrome over the pages: renders,
 * language switching, tag/search filtering, the saved-projects empty state, and
 * the GitHub-sanitizer simulation of the README embed. Screenshots land in
 * tools/screenshots/ for eyeballing.
 *
 * Usage:
 *   node tools/smoke-test.mjs              run every check + screenshots
 *   node tools/smoke-test.mjs --serve      just serve site/ (for a manual look)
 *   node tools/smoke-test.mjs --port=9000  use another port
 */

import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE = path.join(ROOT, "site");
const SHOTS = path.join(__dirname, "screenshots");

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const val = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(val("port", "8765"));
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE = path.join(os.tmpdir(), `frostline-chrome-${process.pid}`);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8"
};

/* ---------- static server ---------- */

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    let target = path.join(SITE, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) target = path.join(target, "index.html");
    if (!path.resolve(target).startsWith(SITE) || !existsSync(target)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

/* ---------- headless chrome ---------- */

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].find((p) => existsSync(p));
}

let CHROME = null;

const BASE_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-extensions",
  "--mute-audio",
  `--user-data-dir=${PROFILE}`
];

/* Chrome's headless process does not always exit on its own (updater helpers keep it
   alive), so we resolve as soon as the output is complete and then kill the process
   group we spawned — never the user's own browser. */
function chromeOnce(extra, { wantDom = false, wantFile = null, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(CHROME, [...BASE_ARGS, ...extra], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    let out = "";
    let err = "";
    let done = false;
    let timer = null;

    const finish = (reason) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolve({ out, err, reason });
    };

    child.stdout.on("data", (d) => {
      out += d;
      if (wantDom && out.includes("</html>")) finish("dom");
    });
    child.stderr.on("data", (d) => {
      err += d;
      if (/<html/i.test(err) && wantDom) finish("dom-stderr");
    });
    child.on("error", (e) => {
      err += String(e);
      finish("error");
    });
    child.on("close", () => finish("exit"));
    timer = setTimeout(() => finish("timeout"), timeout);

    if (wantFile) {
      const poll = setInterval(() => {
        try {
          if (existsSync(wantFile) && statSync(wantFile).size > 0) {
            clearInterval(poll);
            setTimeout(() => finish("file"), 500);
          }
        } catch {
          /* keep polling */
        }
      }, 250);
    }
  });
}

/* The page sets data-ready once projects.json is rendered, so retry instead of
   hoping the virtual time budget covered the fetch. */
async function dom(url, attempts = 3) {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    const { out } = await chromeOnce(["--virtual-time-budget=8000", "--dump-dom", url], { wantDom: true });
    last = out;
    if (out.includes("data-ready=")) return out;
  }
  return last;
}

async function screenshot(name, url, size = "1280,1050") {
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await rm(file, { force: true });
  await chromeOnce(
    [`--window-size=${size}`, "--hide-scrollbars", "--virtual-time-budget=5000", `--screenshot=${file}`, url],
    { wantFile: file }
  );
  return file;
}

/* ---------- interactive session (CDP) ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(url, port = 9223) {
  const child = spawn(CHROME, [...BASE_ARGS, `--remote-debugging-port=${port}`, "about:blank"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  const close = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
      target = await res.json();
    } catch {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === "page") || null;
      } catch {
        /* chrome not up yet */
      }
    }
  }
  if (!target || !target.webSocketDebuggerUrl) {
    close();
    return null;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
    setTimeout(reject, 10000);
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const slot = pending.get(msg.id);
    if (slot) {
      pending.delete(msg.id);
      slot(msg);
    }
  });

  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return res?.result?.result?.value;
  };

  await send("Page.enable", {});
  await send("Page.navigate", { url });

  const destroy = () => {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    close();
  };

  const navigate = (url) => send("Page.navigate", { url });

  return { evaluate, navigate, destroy };
}

/* ---------- checks ---------- */

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const cardCount = (html) => (html.match(/class="card"/g) || []).length;

async function main() {
  if (!existsSync(SITE)) {
    console.error(`FAIL — ${SITE} not found`);
    process.exit(1);
  }

  const server = await startServer();
  console.log(`\nServing ${SITE} at ${BASE}`);

  if (has("serve")) {
    console.log("Press Ctrl-C to stop.");
    return;
  }

  CHROME = chromePath();
  if (!CHROME) {
    console.error("FAIL — no Chrome/Chromium found. Set CHROME_PATH.");
    server.close();
    process.exit(1);
  }

  console.log(`Chrome: ${CHROME}`);
  console.log("\nGallery");
  const gallery = await dom(`${BASE}/gallery.html?lang=en`);
  check("renders every project as a card", cardCount(gallery) === 4, `found ${cardCount(gallery)}`);
  check("shows the English tagline", gallery.includes("Write once, refract everywhere."));
  check("shows the result counter", gallery.includes("4 of 4 projects"));
  check("channel links are not dead links", !/href=""[^>]*>Bilibili/.test(gallery) && gallery.includes("Coming soon"));

  const zh = await dom(`${BASE}/gallery.html?lang=zh`);
  check("?lang=zh renders Chinese copy", zh.includes("一次编写，处处折射。"));
  check("?lang=zh switches the document language", /<html[^>]+lang="zh-CN"/.test(zh));
  check("?lang=zh still renders every card", cardCount(zh) === 4, `found ${cardCount(zh)}`);

  const rust = await dom(`${BASE}/gallery.html?lang=en&tags=rust`);
  check("?tags=rust filters to one card", cardCount(rust) === 1, `found ${cardCount(rust)}`);

  const search = await dom(`${BASE}/gallery.html?lang=en&q=biocraft`);
  check("?q=biocraft matches both Biocraft projects", cardCount(search) === 2, `found ${cardCount(search)}`);

  const none = await dom(`${BASE}/gallery.html?lang=en&q=zzzz`);
  check("empty search shows the empty state", cardCount(none) === 0 && /Nothing matches those filters/.test(none));

  const favs = await dom(`${BASE}/gallery.html?lang=en&fav=1`);
  check("?fav=1 with nothing saved shows the saved-empty state", cardCount(favs) === 0 && /Nothing saved yet/.test(favs));

  console.log("\nHomepage");
  const home = await dom(`${BASE}/index.html?lang=en`);
  check("lists the three software projects", cardCount(home) === 3, `found ${cardCount(home)}`);
  check("renders the Frostline Physics band", home.includes("3Blue1Brown") && home.includes("Frostline Physics"));
  check("band offers Bilibili and YouTube as coming-soon, not dead links",
    home.includes("Bilibili · Coming soon") && home.includes("YouTube · Coming soon"));

  const homeZh = await dom(`${BASE}/index.html?lang=zh`);
  check("homepage switches to Chinese", homeZh.includes("物理专业版"));

  console.log("\nSaved projects (interactive, via DevTools protocol)");
  const session = await cdp(`${BASE}/gallery.html?lang=en`);
  if (!session) {
    check("attach to a DevTools session", false, "could not reach Chrome's debugging port");
  } else {
    let cards = -1;
    for (let i = 0; i < 40 && cards !== 4; i++) {
      await sleep(250);
      cards = (await session.evaluate("document.querySelectorAll('.card').length")) ?? -1;
    }
    check("gallery finishes rendering before interacting", cards === 4, `found ${cards}`);

    await session.evaluate(`document.querySelector('[data-fav="vitreo"]').click()`);
    await sleep(250);
    check("clicking the heart marks the project saved",
      (await session.evaluate(`document.querySelector('[data-fav="vitreo"]').getAttribute('aria-pressed')`)) === "true");
    check("the saved set is persisted for the next visit",
      (await session.evaluate(`JSON.parse(localStorage.getItem('frostline.favs.v1') || '[]').join(',')`)) === "vitreo");
    check("the copy-list button becomes available",
      (await session.evaluate(`!document.querySelector('[data-copy-favs]').disabled`)) === true);

    await session.evaluate(`document.querySelector('[data-only-favs]').click()`);
    await sleep(250);
    check("'saved only' narrows the gallery to that project",
      (await session.evaluate("document.querySelectorAll('.card').length")) === 1);
    check("the filter state is written to the URL for sharing",
      String(await session.evaluate("location.search")).includes("fav=1"));

    await session.evaluate(`document.querySelector('[data-fav="vitreo"]').click()`);
    await sleep(250);
    check("clicking again un-saves it and the empty state returns",
      (await session.evaluate("document.querySelectorAll('.card').length")) === 0 &&
        (await session.evaluate("JSON.parse(localStorage.getItem('frostline.favs.v1') || '[]').length")) === 0);

    /* Every "Gallery" link in the READMEs is /gallery#<id>, so the fragment has to
       survive boot and actually take the reader to that project. */
    await session.navigate(`${BASE}/gallery.html?lang=en#vitreo`);
    let target = "";
    for (let i = 0; i < 40 && target !== "vitreo"; i++) {
      await sleep(250);
      target = (await session.evaluate("document.querySelector('.card--target')?.id")) || "";
    }
    check("a #project deep link marks the card it points at", target === "vitreo", `got "${target}"`);
    check("the deep link survives the filter-state rewrite",
      (await session.evaluate("location.hash")) === "#vitreo",
      `hash is "${await session.evaluate("location.hash")}"`);
    check("the deep link scrolls the card into view",
      (await session.evaluate("window.scrollY")) > 0);

    session.destroy();
  }

  console.log("\nREADME embed (GitHub sanitizer simulation)");
  const previewHtml = await readFile(path.join(__dirname, "embed", "preview.html"), "utf8");
  check("preview embeds all four grid cells", (previewHtml.match(/<td width="50%" valign="top">/g) || []).length === 4);
  check("preview grid carries no scripts (nothing for GitHub to strip)", !/<script/i.test(previewHtml));

  console.log("\nScreenshots");
  const files = [];
  files.push(await screenshot("home", `${BASE}/index.html?lang=en`, "1280,1150"));
  files.push(await screenshot("home-zh-dark", `${BASE}/index.html?lang=zh&theme=dark`, "1280,1150"));
  files.push(await screenshot("gallery", `${BASE}/gallery.html?lang=en`, "1280,1250"));
  files.push(await screenshot("gallery-zh", `${BASE}/gallery.html?lang=zh`, "1280,1250"));
  files.push(await screenshot("readme-embed", `file://${path.join(__dirname, "embed", "preview.html")}`, "1100,900"));
  for (const f of files) console.log(`    ${f}`);

  await rm(PROFILE, { recursive: true, force: true });
  server.close();

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFAIL — ${err.stack || err.message}`);
  process.exit(1);
});
