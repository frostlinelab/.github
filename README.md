# frostlinelab/.github

The organization profile, the team site, and the tooling that keeps them in sync.

| Path | What it is |
|---|---|
| `profile/README.md` | The organization profile shown at [github.com/frostlinelab](https://github.com/frostlinelab). Its project grid is generated. |
| `site/` | Team homepage (`index.html`) and the filterable project gallery (`gallery.html`). Deployed to Cloudflare Pages. |
| `site/projects.json` | Single source of truth for every project: text, links, tags, status, assets. |
| `tools/build-embed.js` | Generates the README embeds and verifies they survive GitHub's sanitizer. |
| `tools/smoke-test.mjs` | Serves `site/` and drives headless Chrome over the pages. |

## Add or edit a project

1. Edit `site/projects.json` — bilingual `tagline`/`description`, `tags`, `status`, links, and the `banner`/`logo` paths.
2. Add the artwork as `site/assets/banners/<id>.svg` and `site/assets/logos/<id>.svg` (see [`site/assets/README.md`](site/assets/README.md)).
3. Regenerate the README embed and verify:

   ```sh
   node tools/build-embed.js --write     # injects the grid into profile/README.md
   node tools/smoke-test.mjs             # renders the site in headless Chrome and asserts it works
   ```

   `--check-links` additionally HEAD-checks the embed URLs (run it after pushing).

## Deploy to Cloudflare Pages

| Setting | Value |
|---|---|
| Git repository | `frostlinelab/.github` |
| Production branch | `main` |
| Build command | *(leave empty)* |
| Build output directory | `site` |

The site is plain HTML/CSS/JS with no build step, so the output directory is all Pages needs.

## README embeds

GitHub strips `<script>`, `<style>`, `style=`, `class=`, `<iframe>` and inline `<svg>` from READMEs, so the
grid is plain `table`/`img`/`a`/`sub` markup that survives the sanitizer. Image URLs point at
`raw.githubusercontent.com/.../site/...`; links point at the Pages site. Both live as two constants at the top of
`tools/build-embed.js` — change them there and re-run with `--write` if the domain ever moves.

`tools/embed/preview.html` renders the generated grid under a GitHub-like sanitizer for a quick visual check
before pushing. Per-repository snippets (header banner + "Part of Frostline Lab" footer) are written to
`tools/embed/per-repo/<id>.md` for pasting into the individual project READMEs.
