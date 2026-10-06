#!/usr/bin/env node
/**
 * Frostline Lab — README embed builder.
 *
 * Turns site/projects.json into HTML that survives GitHub's README sanitizer:
 *   tools/embed/org-grid.html     the 2-column project grid for the org profile
 *   tools/embed/per-repo/<id>.md  header banner + "Part of Frostline Lab" footer card
 *   tools/embed/preview.html      the grid rendered under a GitHub-like sanitizer,
 *                                 for a visual check before pushing
 *
 * Usage:
 *   node tools/build-embed.js                 build + verify (no files outside tools/embed)
 *   node tools/build-embed.js --write         also inject into the README markers
 *   node tools/build-embed.js --check-links   HEAD-check the generated URLs online
 *   node tools/build-embed.js --target=FILE   override the README that --write edits
 *
 * GitHub strips <script>, <style>, <iframe>, style=, class=, event handlers and inline
 * <svg> from README HTML. Everything generated here stays inside the allowlist
 * (table/tr/td/p/a/img/strong/sub/br + href/src/alt/width/height/align/valign).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const SITE_DIR = path.join(ROOT, "site");
const DATA_FILE = path.join(SITE_DIR, "projects.json");
const OUT_DIR = path.join(__dirname, "embed");
const PER_REPO_DIR = path.join(OUT_DIR, "per-repo");

/* Images are served straight from the repository, so the embeds work the moment
   this repo is pushed — independent of the Cloudflare Pages deploy. Links point
   at the Pages site. Change these two constants when the domain changes. */
const ASSET_BASE = "https://raw.githubusercontent.com/frostlinelab/.github/main/site";
const SITE_BASE = "https://frostlinelab.pages.dev";

const MARKER_START = "<!-- FROSTLINE-EMBED:START -->";
const MARKER_END = "<!-- FROSTLINE-EMBED:END -->";

const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tr", "td", "th", "p", "a", "img", "strong", "em", "sub", "sup", "br", "hr", "div", "span"
]);
const ALLOWED_ATTRS = new Set(["href", "src", "alt", "width", "height", "align", "valign", "title"]);
const VOID_TAGS = new Set(["img", "br", "hr", "meta", "link", "input", "source"]);

const FORBIDDEN = [
  [/<script/i, "<script>"],
  [/<style/i, "<style>"],
  [/\sstyle\s*=/i, "style= attribute"],
  [/\sclass\s*=/i, "class= attribute"],
  [/\son[a-z]+\s*=/i, "inline event handler"],
  [/<iframe/i, "<iframe>"],
  [/<svg/i, "inline <svg>"],
  [/<button/i, "<button>"],
  [/<input/i, "<input>"],
  [/<form/i, "<form>"],
  [/javascript:/i, "javascript: URL"]
];

const STATUS_LABEL = { active: "Active", wip: "In progress", archived: "Archived" };

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

let failures = 0;
let warnings = 0;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const warn = (msg) => { warnings++; console.log(`  ! ${msg}`); };

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const label = (obj) => (obj && typeof obj === "object" ? obj.en || obj.zh : obj) || "";

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ---------- load + validate ---------- */

function loadData() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const data = JSON.parse(raw);
  console.log("\nProjects data");
  pass(`site/projects.json parsed (${data.projects.length} projects, ${Object.keys(data.tags).length} tags)`);

  const ids = new Set();
  for (const p of data.projects) {
    const where = `project "${p.id || "?"}"`;
    if (!p.id) fail(`${where}: missing id`);
    if (ids.has(p.id)) fail(`${where}: duplicate id`);
    ids.add(p.id);
    for (const field of ["name", "kind", "tagline", "description", "tags", "status", "banner", "logo"]) {
      if (p[field] == null) fail(`${where}: missing ${field}`);
    }
    if (!["software", "channel"].includes(p.kind)) fail(`${where}: unknown kind "${p.kind}"`);
    if (!STATUS_LABEL[p.status]) fail(`${where}: unknown status "${p.status}"`);
    for (const t of p.tags || []) if (!data.tags[t]) fail(`${where}: tag "${t}" is not declared in tags`);
    for (const lang of ["en", "zh"]) {
      if (!p.tagline || !p.tagline[lang]) fail(`${where}: missing tagline.${lang}`);
      if (!p.description || !p.description[lang]) fail(`${where}: missing description.${lang}`);
    }
    if (p.repo && !/^https:\/\/github\.com\//.test(p.repo)) fail(`${where}: repo must be an https github.com URL`);
    for (const link of p.links || []) {
      if (link.url && !/^https:\/\//.test(link.url)) fail(`${where}: link "${label(link.label)}" must be https or null`);
    }
    for (const asset of [p.banner, p.logo]) {
      const file = path.join(SITE_DIR, asset);
      if (!fs.existsSync(file)) fail(`${where}: asset missing on disk — ${asset}`);
    }
    if (!p.accent || !/^#[0-9a-f]{3,8}$/i.test(p.accent)) fail(`${where}: accent must be a hex colour`);
  }
  const hasUi = data.ui && data.ui.en && data.ui.zh;
  if (!hasUi) fail("ui.en / ui.zh dictionary missing");
  else pass("bilingual ui dictionary present");

  const bannerBytes = data.projects.reduce((n, p) => n + fs.statSync(path.join(SITE_DIR, p.banner)).size, 0);
  pass(`banner + logo assets exist on disk (${(bannerBytes / 1024).toFixed(0)} KB of banners)`);
  return data;
}

/* ---------- embed generation ---------- */

function bannerUrl(p) { return `${ASSET_BASE}/${p.banner}`; }
function logoUrl(p) { return `${ASSET_BASE}/${p.logo}`; }
function primaryUrl(p) { return p.repo || `${SITE_BASE}/gallery.html#${p.id}`; }

function gridCell(p) {
  const meta = [];
  if (p.language) meta.push(esc(p.language));
  if (p.license) meta.push(esc(p.license));
  meta.push(esc(STATUS_LABEL[p.status]));
  for (const link of p.links || []) {
    meta.push(link.url ? `<a href="${esc(link.url)}">${esc(label(link.label))}</a>` : `${esc(label(link.label))} — soon`);
  }
  meta.push(`<a href="${SITE_BASE}/gallery.html#${p.id}">Gallery</a>`);

  const repoLine = p.repo ? `<a href="${esc(p.repo)}">Repository</a> · ` : "";

  return [
    `<td width="50%" valign="top">`,
    `  <a href="${esc(primaryUrl(p))}"><img src="${bannerUrl(p)}" alt="${esc(p.name)} — ${esc(label(p.tagline))}" width="100%"></a>`,
    `  <p>`,
    `    <a href="${esc(primaryUrl(p))}"><img src="${logoUrl(p)}" alt="" width="16" height="16"></a> <strong><a href="${esc(primaryUrl(p))}">${esc(p.name)}</a></strong><br>`,
    `    ${esc(label(p.tagline))}<br>`,
    `    <sub>${esc(p.tagline.zh)}</sub><br>`,
    `    <sub>${meta.join(" · ")}</sub>`,
    `  </p>`,
    `</td>`
  ].join("\n");
}

function buildOrgGrid(data) {
  const cells = data.projects.map(gridCell);
  if (cells.length % 2 === 1) cells.push(`<td width="50%" valign="top"></td>`);
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(`<tr>\n${cells[i]}\n${cells[i + 1]}\n</tr>`);
  }
  return `<table>\n${rows.join("\n")}\n</table>`;
}

function buildPerRepo(p) {
  return `<!-- Frostline Lab — generated by tools/build-embed.js. Paste the block you need. -->

<!-- Header banner (optional, put it right under your H1) -->
<p align="center">
  <a href="${SITE_BASE}"><img src="${bannerUrl(p)}" alt="${esc(p.name)} — a Frostline Lab project" width="820"></a>
</p>

<!-- Footer card (recommended) -->
<p align="center">
  <a href="${SITE_BASE}"><img src="${logoUrl(p)}" alt="" width="28" height="28"></a><br>
  <sub>Part of <a href="${SITE_BASE}">Frostline Lab</a> · <a href="${SITE_BASE}/gallery.html#${p.id}">All projects</a></sub>
</p>
`;
}

/* ---------- sanitizer-safety checks ---------- */

function tagTokens(html) {
  return [...html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g)].map((m) => ({
    closing: m[1] === "/",
    name: m[2].toLowerCase(),
    attrs: m[3].trim(),
    selfClosing: m[4] === "/"
  }));
}

function checkTagsBalanced(html, what) {
  const stack = [];
  for (const token of tagTokens(html)) {
    if (token.closing) {
      const open = stack.pop();
      if (open !== token.name) {
        fail(`${what}: unbalanced </${token.name}> (expected </${open || "nothing"}>)`);
        return;
      }
    } else if (!token.selfClosing && !VOID_TAGS.has(token.name)) {
      stack.push(token.name);
    }
  }
  if (stack.length) fail(`${what}: unclosed <${stack.join(">, <")}>`);
  else pass(`${what}: tags balanced`);
}

function checkAttributes(html, what) {
  let problems = 0;
  for (const token of tagTokens(html)) {
    if (token.closing || !token.attrs) continue;
    for (const attr of token.attrs.matchAll(/([a-zA-Z-:]+)\s*=/g)) {
      if (!ALLOWED_ATTRS.has(attr[1].toLowerCase())) {
        fail(`${what}: <${token.name}> uses attribute "${attr[1]}" which GitHub strips`);
        problems++;
      }
    }
    if (token.name === "img") {
      const a = token.attrs;
      if (!/\salt\s*=/.test(a)) { fail(`${what}: <img> without alt`); problems++; }
      if (!/\swidth\s*=/.test(a)) { warn(`${what}: <img> without a width attribute (may render oversized)`); }
    }
  }
  if (!problems) pass(`${what}: only allowlisted attributes used`);
}

/* GitHub auto-wraps any image that is not already inside a link, and adds its own
   fallback styling (grey rounded background) while it is at it. Wrapping every <img>
   in an <a> keeps our markup exactly as generated — verified against the live org page. */
function checkImagesAreLinked(html, what) {
  let problems = 0;
  for (const line of html.split("\n")) {
    const img = line.indexOf("<img");
    if (img === -1) continue;
    if (line.lastIndexOf("<a ", img) === -1) {
      fail(`${what}: an <img> is not wrapped in a link — GitHub would auto-link it and restyle it`);
      problems++;
    }
  }
  if (!problems) pass(`${what}: every <img> sits inside a link, so GitHub leaves the markup alone`);
}

function checkForbidden(html, what) {
  let problems = 0;
  for (const [re, name] of FORBIDDEN) {
    if (re.test(html)) { fail(`${what}: contains forbidden ${name}`); problems++; }
  }
  if (!problems) pass(`${what}: no construction GitHub would strip`);
}

function checkTags(html, what) {
  let problems = 0;
  for (const token of tagTokens(html)) {
    if (!ALLOWED_TAGS.has(token.name)) { fail(`${what}: tag <${token.name}> is not on the allowlist`); problems++; }
  }
  if (!problems) pass(`${what}: every tag is on the allowlist`);
}

/* ---------- preview (approximate GitHub rendering) ---------- */

function buildPreview(gridHtml) {
  /* The preview is written to tools/embed/, so swap the raw.githubusercontent asset
     base for a relative path — that way the real banners and logos render locally,
     before anything is pushed. */
  const local = gridHtml.replaceAll(ASSET_BASE, "../../site");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Frostline embed preview — GitHub sanitizer simulation</title>
<style>
  body { margin: 0; background: #fff; color: #1f2328; font: 16px/1.5 -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
  .markdown-body { max-width: 1012px; margin: 0 auto; padding: 40px 32px; }
  .markdown-body img { max-width: 100%; }
  .markdown-body table { border-collapse: collapse; width: 100%; }
  .markdown-body td { padding: 8px 12px 8px 0; border: 0; }
  .markdown-body p { margin: 0.4em 0; }
  .markdown-body sub { font-size: 11.5px; color: #59636e; }
  .markdown-body a { color: #0969da; text-decoration: none; }
  .markdown-body a:hover { text-decoration: underline; }
  .note { max-width: 1012px; margin: 24px auto 0; padding: 10px 14px; border: 1px solid #d1d9e0;
          border-radius: 8px; font-size: 13px; color: #59636e; background: #f6f8fa; }
</style></head>
<body>
  <p class="note">Simulation only: this is <code>tools/embed/org-grid.html</code> rendered with the attribute set
  GitHub keeps. The real test is the live organization page.</p>
  <div class="markdown-body">
${local}
  </div>
</body></html>
`;
}

/* ---------- link checking ---------- */

function head(url, redirects = 0) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: "HEAD", timeout: 8000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        resolve(head(new URL(res.headers.location, url).href, redirects + 1));
      } else {
        res.resume();
        resolve({ status: res.statusCode, type: res.headers["content-type"] || "" });
      }
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, type: "timeout" }); });
    req.on("error", () => resolve({ status: 0, type: "error" }));
    req.end();
  });
}

async function checkLinks(urls) {
  console.log("\nOnline link check");
  for (const url of urls) {
    const { status, type } = await head(url);
    if (status === 200) pass(`${status} ${type.split(";")[0]} — ${url}`);
    else warn(`${status || "unreachable"} — ${url} (expected before the first push / deploy)`);
  }
}

/* ---------- write ---------- */

function inject(target, block) {
  const file = path.resolve(ROOT, target);
  if (!fs.existsSync(file)) { fail(`--write target not found: ${target}`); return; }
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1) {
    fail(`${target}: markers ${MARKER_START} / ${MARKER_END} not found`);
    return;
  }
  const next = text.slice(0, start + MARKER_START.length) + "\n" + block + "\n" + text.slice(end);
  if (next === text) { pass(`${target}: embed already up to date`); return; }
  fs.writeFileSync(file, next);
  pass(`${target}: embed block written (${(block.length / 1024).toFixed(1)} KB)`);
}

/* ---------- main ---------- */

async function main() {
  const data = loadData();

  console.log("\nGenerated embeds");
  const grid = buildOrgGrid(data);
  mkdirp(PER_REPO_DIR);
  fs.writeFileSync(path.join(OUT_DIR, "org-grid.html"), grid + "\n");
  pass(`tools/embed/org-grid.html — ${data.projects.length} cards, ${(grid.length / 1024).toFixed(1)} KB, sha ${sha256(grid)}`);

  for (const p of data.projects.filter((x) => x.repo)) {
    const snippet = buildPerRepo(p);
    fs.writeFileSync(path.join(PER_REPO_DIR, `${p.id}.md`), snippet);
    pass(`tools/embed/per-repo/${p.id}.md — banner + footer card`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "preview.html"), buildPreview(grid));
  pass("tools/embed/preview.html — sanitizer simulation for eyeballing");

  console.log("\nSanitizer safety");
  checkForbidden(grid, "org-grid");
  checkTags(grid, "org-grid");
  checkAttributes(grid, "org-grid");
  checkImagesAreLinked(grid, "org-grid");
  checkTagsBalanced(grid, "org-grid");

  /* The per-repo snippets land in other repositories' READMEs, so they get the
     same treatment as the grid — a stripped tag there is just as invisible. */
  for (const p of data.projects.filter((x) => x.repo)) {
    const what = `per-repo/${p.id}`;
    const snippet = buildPerRepo(p);
    checkForbidden(snippet, what);
    checkTags(snippet, what);
    checkAttributes(snippet, what);
    checkImagesAreLinked(snippet, what);
    checkTagsBalanced(snippet, what);
  }

  console.log("\nAsset URLs (used by the embeds)");
  const urls = [...new Set(data.projects.flatMap((p) => [bannerUrl(p), logoUrl(p)]))];
  for (const u of urls) console.log(`    ${u}`);

  if (flag("check-links")) await checkLinks([...urls, `${SITE_BASE}/gallery.html`]);
  else console.log("\nOnline link check skipped (pass --check-links after pushing / deploying)");

  if (flag("write")) {
    console.log("\nREADME injection");
    inject(value("target", "profile/README.md"), grid);
  }

  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} error(s), ${warnings} warning(s)` +
      (flag("write") ? "" : "\n(run with --write to update the README embed, --check-links to verify URLs online)")
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFAIL — ${err.stack || err.message}`);
  process.exit(1);
});
