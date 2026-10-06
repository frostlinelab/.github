/* Frostline Lab — site logic
   Zero dependencies. Reads projects.json (the single source of truth),
   renders the home page and the gallery, handles i18n, filtering and saved projects. */

(() => {
  "use strict";

  const DATA_URL = "projects.json";
  const FAV_KEY = "frostline.favs.v1";
  const LANG_KEY = "frostline.lang.v1";
  const THEME_KEY = "frostline.theme.v1";
  const GALLERY_URL = "gallery.html";

  const ICON = {
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>'
  };

  const params = new URLSearchParams(location.search);
  const state = {
    data: null,
    lang: "en",
    theme: null,
    favs: new Set(),
    filters: { q: "", tags: new Set(), status: "all", favsOnly: false, sort: "featured" }
  };

  /* ---------- storage ---------- */

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — ignore */
    }
  }

  /* ---------- i18n ---------- */

  function t(key, vars) {
    const dict = (state.data && state.data.ui[state.lang]) || {};
    let s = dict[key];
    if (s === undefined) s = ((state.data && state.data.ui.en) || {})[key];
    if (s === undefined) return key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  }

  function pick(obj) {
    if (obj == null) return "";
    if (typeof obj === "string") return obj;
    return obj[state.lang] || obj.en || "";
  }

  function applyStatic() {
    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.lang = state.lang;
    for (const el of document.querySelectorAll("[data-i18n]")) {
      el.textContent = t(el.dataset.i18n);
    }
    for (const el of document.querySelectorAll("[data-i18n-ph]")) {
      el.placeholder = t(el.dataset.i18nPh);
    }
    for (const el of document.querySelectorAll("[data-i18n-aria]")) {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
      const title = t(el.dataset.i18nAria);
      el.title = title;
    }
    if (document.body.dataset.titleKey) {
      document.title = t(document.body.dataset.titleKey);
    }
    const year = document.querySelector("[data-year]");
    if (year) year.textContent = String(new Date().getFullYear());
    const langBtn = document.querySelector("[data-lang-toggle]");
    if (langBtn) langBtn.textContent = t("nav.lang");
    const themeBtn = document.querySelector("[data-theme-toggle]");
    if (themeBtn) {
      const dark = document.documentElement.dataset.theme === "dark";
      themeBtn.innerHTML = dark ? ICON.sun : ICON.moon;
    }
  }

  /* ---------- filters <-> url ---------- */

  function readFiltersFromUrl() {
    state.filters.q = params.get("q") || "";
    state.filters.status = params.get("status") || "all";
    state.filters.sort = params.get("sort") || "featured";
    state.filters.favsOnly = params.get("fav") === "1";
    state.filters.tags = new Set(
      (params.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean)
    );
  }

  function writeFiltersToUrl() {
    if (document.body.dataset.page !== "gallery") return;
    const p = new URLSearchParams();
    const f = state.filters;
    if (f.q) p.set("q", f.q);
    if (f.tags.size) p.set("tags", [...f.tags].join(","));
    if (f.status !== "all") p.set("status", f.status);
    if (f.sort !== "featured") p.set("sort", f.sort);
    if (f.favsOnly) p.set("fav", "1");
    if (state.lang !== "en") p.set("lang", state.lang);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  /* ---------- filtering ---------- */

  function tagLabel(id) {
    const tag = state.data.tags[id];
    return tag ? pick(tag) : id;
  }

  function matches(project) {
    const f = state.filters;
    if (f.favsOnly && !state.favs.has(project.id)) return false;
    if (f.status !== "all" && project.status !== f.status) return false;
    if (f.tags.size && ![...f.tags].every((tag) => project.tags.includes(tag))) return false;
    const q = f.q.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      project.name,
      project.language || "",
      ...project.tags.map(tagLabel),
      pick(project.tagline),
      pick(project.description),
      project.tagline.en,
      project.tagline.zh,
      project.description.en,
      project.description.zh
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  }

  function visibleProjects(list) {
    const f = state.filters;
    const out = list.filter(matches);
    const byUpdated = (a, b) => String(b.updated || "").localeCompare(String(a.updated || ""));
    if (f.sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, state.lang));
    else if (f.sort === "updated") out.sort(byUpdated);
    else out.sort((a, b) => Number(b.featured) - Number(a.featured));
    return out;
  }

  /* ---------- rendering ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function badge(text, extra) {
    return el("span", `badge${extra ? ` ${extra}` : ""}`, text);
  }

  function linkButton(href, label, opts = {}) {
    const a = el("a", `btn btn--small${opts.primary ? " btn--primary" : ""}`, label);
    a.href = href;
    if (opts.external) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    return a;
  }

  function createCard(project) {
    const card = el("article", "card");
    card.id = project.id;
    card.dataset.id = project.id;
    card.style.setProperty("--accent", project.accent || "var(--brand)");

    const banner = el("a", "card__banner");
    banner.href = project.repo || `${GALLERY_URL}#${project.id}`;
    banner.setAttribute("tabindex", "-1");
    banner.setAttribute("aria-hidden", "true");
    const img = el("img");
    img.src = project.banner;
    img.alt = `${project.name} banner`;
    img.loading = "lazy";
    banner.append(img);

    const fav = el("button", "card__fav");
    fav.type = "button";
    fav.dataset.fav = project.id;
    const saved = state.favs.has(project.id);
    fav.setAttribute("aria-pressed", String(saved));
    fav.innerHTML = ICON.heart;
    const favLabel = () => `${t(saved ? "card.saved" : "card.save")} — ${project.name}`;
    fav.setAttribute("aria-label", favLabel());
    fav.title = favLabel();
    fav.addEventListener("click", () => toggleFav(project.id));

    const body = el("div", "card__body");

    const head = el("div", "card__head");
    const logo = el("img", "card__logo");
    logo.src = project.logo;
    logo.alt = "";
    logo.loading = "lazy";
    const name = el("h3", "card__name");
    const nameLink = el("a", null, project.name);
    nameLink.href = project.repo || `${GALLERY_URL}#${project.id}`;
    name.append(nameLink);
    head.append(logo, name);

    const tagline = el("p", "card__tagline", pick(project.tagline));
    const desc = el("p", "card__desc", pick(project.description));

    const meta = el("div", "card__meta");
    if (project.language) meta.append(badge(project.language));
    if (project.license) meta.append(badge(project.license));
    meta.append(badge(t(`gallery.status.${project.status}`), "badge--status"));
    if (project.updated) {
      meta.append(badge(`${t("card.updated")} ${project.updated.slice(0, 7)}`, "badge--quiet"));
    }

    const links = el("div", "card__links");
    if (project.repo) links.append(linkButton(project.repo, t("card.repo"), { external: true }));
    if (project.homepage) links.append(linkButton(project.homepage, t("card.homepage"), { external: true }));
    for (const link of project.links || []) {
      if (link.url) {
        links.append(linkButton(link.url, pick(link.label), { external: true }));
      } else {
        links.append(el("span", "btn btn--small btn--disabled", `${pick(link.label)} · ${t("card.comingSoon")}`));
      }
    }

    body.append(head, tagline, desc, meta, links);
    card.append(banner, fav, body);
    return card;
  }

  function renderInto(container, projects) {
    container.textContent = "";
    for (const project of projects) container.append(createCard(project));
  }

  function renderBand(container, project) {
    container.textContent = "";
    container.style.setProperty("--accent", project.accent || "var(--brand)");

    const main = el("div");
    const logo = el("img", "band__logo");
    logo.src = project.logo;
    logo.alt = "";
    const h2 = el("h2", null, project.name);
    const tagline = el("p", null, pick(project.tagline));
    const body = el("p", null, pick(project.description));
    main.append(logo, h2, tagline, body);

    const aside = el("div", "band__aside");
    aside.append(el("span", "band__kicker", t("home.channel.kicker")));
    const cta = linkButton(GALLERY_URL, t("card.details"));
    cta.classList.remove("btn--small");
    aside.append(cta);
    for (const link of project.links || []) {
      if (link.url) {
        const b = linkButton(link.url, pick(link.label), { external: true });
        b.classList.remove("btn--small");
        b.classList.add("btn--primary");
        aside.append(b);
      } else {
        aside.append(el("span", "btn btn--disabled", `${pick(link.label)} · ${t("card.comingSoon")}`));
      }
    }

    container.append(main, aside);
  }

  /* ---------- saved projects ---------- */

  function toggleFav(id) {
    if (state.favs.has(id)) state.favs.delete(id);
    else state.favs.add(id);
    write(FAV_KEY, JSON.stringify([...state.favs]));
    /* While the "saved only" filter is on, a card leaving the saved set has to
       leave the grid too — otherwise the view contradicts the filter. */
    if (state.filters.favsOnly) update();
    else syncFavUi();
  }

  function syncFavUi() {
    for (const btn of document.querySelectorAll("[data-fav]")) {
      const id = btn.dataset.fav;
      const saved = state.favs.has(id);
      btn.setAttribute("aria-pressed", String(saved));
      const project = state.data.projects.find((p) => p.id === id);
      const label = `${t(saved ? "card.saved" : "card.save")}${project ? ` — ${project.name}` : ""}`;
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }
    const counter = document.querySelector("[data-fav-count]");
    if (counter) counter.textContent = String(state.favs.size);
    const copyBtn = document.querySelector("[data-copy-favs]");
    if (copyBtn) copyBtn.disabled = state.favs.size === 0;
  }

  async function copyFavs() {
    const lines = state.data.projects
      .filter((p) => state.favs.has(p.id))
      .map((p) => {
        const url = p.repo || new URL(`${GALLERY_URL}#${p.id}`, location.href).href;
        return `- [${p.name}](${url}) — ${pick(p.tagline)}`;
      });
    const text = `## Frostline Lab — saved projects\n${lines.join("\n")}\n`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    const btn = document.querySelector("[data-copy-favs]");
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = ok ? t("gallery.copied") : t("gallery.copy");
    setTimeout(() => { btn.textContent = original; }, 1600);
  }

  /* ---------- gallery toolbar ---------- */

  function buildToolbar(projects) {
    const tagHost = document.querySelector("[data-tag-chips]");
    const statusHost = document.querySelector("[data-status-chips]");
    const search = document.querySelector("[data-search]");
    const sort = document.querySelector("[data-sort]");
    const favToggle = document.querySelector("[data-only-favs]");
    const copyBtn = document.querySelector("[data-copy-favs]");

    const counts = new Map();
    for (const project of projects) {
      for (const tag of project.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const tags = [...counts.keys()].sort(
      (a, b) => counts.get(b) - counts.get(a) || tagLabel(a).localeCompare(tagLabel(b), state.lang)
    );
    tagHost.textContent = "";
    for (const id of tags) {
      const chip = el("button", "chip", tagLabel(id));
      chip.type = "button";
      chip.dataset.tag = id;
      chip.setAttribute("aria-pressed", String(state.filters.tags.has(id)));
      chip.addEventListener("click", () => {
        const on = state.filters.tags.has(id);
        if (on) state.filters.tags.delete(id);
        else state.filters.tags.add(id);
        chip.setAttribute("aria-pressed", String(!on));
        update();
      });
      tagHost.append(chip);
    }

    const statuses = ["all", ...[...new Set(projects.map((p) => p.status))]];
    statusHost.textContent = "";
    for (const id of statuses) {
      const chip = el("button", "chip", t(`gallery.status.${id}`));
      chip.type = "button";
      chip.dataset.status = id;
      chip.setAttribute("aria-pressed", String(state.filters.status === id));
      chip.addEventListener("click", () => {
        state.filters.status = id;
        for (const other of statusHost.children) {
          other.setAttribute("aria-pressed", String(other.dataset.status === id));
        }
        update();
      });
      statusHost.append(chip);
    }

    if (search) {
      search.value = state.filters.q;
      search.addEventListener("input", () => {
        state.filters.q = search.value;
        update();
      });
    }
    if (sort) {
      sort.value = state.filters.sort;
      sort.addEventListener("change", () => {
        state.filters.sort = sort.value;
        update();
      });
    }
    if (favToggle) {
      favToggle.setAttribute("aria-pressed", String(state.filters.favsOnly));
      favToggle.addEventListener("click", () => {
        state.filters.favsOnly = !state.filters.favsOnly;
        favToggle.setAttribute("aria-pressed", String(state.filters.favsOnly));
        update();
      });
    }
    if (copyBtn) copyBtn.addEventListener("click", copyFavs);
    for (const btn of document.querySelectorAll("[data-clear]")) {
      btn.addEventListener("click", () => {
        state.filters.q = "";
        state.filters.tags.clear();
        state.filters.status = "all";
        state.filters.favsOnly = false;
        state.filters.sort = "featured";
        if (search) search.value = "";
        if (sort) sort.value = "featured";
        for (const chip of document.querySelectorAll("[data-tag-chips] .chip, [data-status-chips] .chip")) {
          chip.setAttribute("aria-pressed", String(chip.dataset.tag ? false : chip.dataset.status === "all"));
        }
        update();
      });
    }
    syncFavUi();
  }

  function update() {
    const list = state.data.projects.filter((p) => (document.body.dataset.page === "gallery" ? true : p.kind === "software"));
    const shown = visibleProjects(list);
    const grid = document.querySelector("[data-grid]");
    const empty = document.querySelector("[data-empty]");
    const results = document.querySelector("[data-results]");

    renderInto(grid, shown);
    if (results) results.textContent = t("gallery.results", { n: shown.length, total: list.length });
    if (empty) {
      empty.hidden = shown.length > 0;
      const msg = empty.querySelector("[data-empty-msg]");
      if (msg) msg.textContent = t(state.filters.favsOnly ? "gallery.emptyFavs" : "gallery.empty");
    }
    syncFavUi();
    writeFiltersToUrl();
    if (document.body.dataset.page === "gallery") {
      const onlyFavsBtn = document.querySelector("[data-only-favs]");
      if (onlyFavsBtn) {
        onlyFavsBtn.textContent = `${t("gallery.onlyFavs")} · ${state.favs.size}`;
      }
    }
  }

  /* ---------- boot ---------- */

  function initTheme() {
    const stored = read(THEME_KEY, null);
    const theme = params.get("theme") || stored;
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  }

  function initLang() {
    const stored = read(LANG_KEY, null);
    const fromUrl = params.get("lang");
    const nav = (navigator.language || "en").toLowerCase();
    state.lang = fromUrl === "zh" || fromUrl === "en" ? fromUrl : stored || (nav.startsWith("zh") ? "zh" : "en");
  }

  function wireChrome() {
    const langBtn = document.querySelector("[data-lang-toggle]");
    if (langBtn) {
      langBtn.addEventListener("click", () => {
        state.lang = state.lang === "zh" ? "en" : "zh";
        write(LANG_KEY, state.lang);
        applyStatic();
        const gallery = document.querySelector("[data-tag-chips]");
        if (gallery && state.data) buildToolbar(state.data.projects);
        update();
      });
    }
    const themeBtn = document.querySelector("[data-theme-toggle]");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const dark = document.documentElement.dataset.theme === "dark";
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        write(THEME_KEY, next);
        applyStatic();
      });
    }
  }

  function fail(message) {
    const grid = document.querySelector("[data-grid]");
    if (!grid) return;
    grid.textContent = "";
    const box = el("div", "empty");
    box.append(el("p", null, message));
    const hint = el("p");
    const code = el("code", null, "python3 -m http.server");
    hint.append(document.createTextNode("Serve the folder over HTTP to load projects.json, e.g. "), code);
    box.append(hint);
    grid.append(box);
  }

  async function boot() {
    initTheme();
    initLang();
    try {
      state.favs = new Set(JSON.parse(read(FAV_KEY, "[]")));
    } catch {
      state.favs = new Set();
    }

    let data;
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      applyStatic();
      fail(`Could not load ${DATA_URL} (${err.message}).`);
      document.body.dataset.ready = "error";
      return;
    }

    state.data = data;
    readFiltersFromUrl();
    applyStatic();
    wireChrome();

    const page = document.body.dataset.page;
    const grid = document.querySelector("[data-grid]");
    if (page === "gallery") {
      buildToolbar(data.projects);
    }
    if (page === "home") {
      const band = document.querySelector("[data-band]");
      const channel = data.projects.find((p) => p.kind === "channel");
      if (band && channel) renderBand(band, channel);
      if (grid) {
        grid.classList.add("grid");
      }
    }
    update();
    /* Readiness beacon: lets tools/smoke-test.mjs wait for a fully rendered page
       instead of guessing at a timeout. */
    document.body.dataset.ready = "1";
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
