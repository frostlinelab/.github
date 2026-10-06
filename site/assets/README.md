# Artwork spec

Every project in `site/projects.json` points at one banner and one logo, named after the project `id`:

```
site/assets/banners/<id>.<ext>     site/assets/logos/<id>.<ext>
```

The extension is whatever `projects.json` says — the files do not have to share a format. Drop-in
replacements are welcome as long as the path in `projects.json` matches; run `node tools/build-embed.js`
afterwards and it will fail loudly if a file is missing.

**Currently placeholders:** all four banners, and the logos for Vitreo, Biocraft-Spark and
Biocraft Marketplace. The Frostline Physics logo and the org mark below are real artwork.

## Banners — 1200 × 675 (16:9)

Shown as the card header in the README grid, the gallery and the homepage.

- **Opaque background.** Banners sit on both light and dark pages, so no transparency.
- **Dark text on a light ground**, or the reverse — but pick one and check both themes.
- Keep the project name in the left third; the right side reads better as imagery.
- SVG is ideal. For raster, keep it under ~60 KB.

## Logos — square, 256 px is plenty (largest drawn size is 34 px)

Used at 16–34 px: in the README project line, on the gallery cards, and in the homepage channel band.

- No text — it is always rendered next to the project name.
- Bold shapes, few details. If it does not read at 20 px, it is too busy.
- Frostline Physics uses a dark rounded tile with transparent corners; that style works in both
  themes, but note GitHub adds its own grey plate behind small README images (see below).

### Format: try WebP before PNG

The two real marks are smooth gradients behind soft glows, and PNG compresses those badly —
92 KB at 256 px, where WebP needs **6 KB**. Encode raster logos with `cwebp -q 88 -alpha_q 100`;
raw.githubusercontent serves `.webp` as `image/webp`, so the README embeds work unchanged.

**Keep GitHub's fallback plate in mind.** README images below a certain size come back with
`class="js-gh-image-fallback"` and a `--bgColor-muted` background plus a 6 px radius, whether or
not they are wrapped in a link. A transparent logo hides this completely; a logo with transparent
*cut corners* shows the plate through them. Harmless in practice — the tint is the page background —
but it is why a tight-cropped tile is safer than one with a wide transparent margin.

## Brand mark and favicon

The organisation mark lives outside the per-project set:

```
site/assets/brand/frostline-lab.webp   header brand mark, drawn at 24 px (same WebP advice)
site/favicon.png                       64 px PNG — WebP favicons are not reliable in Safari
```

Both come from `~/Documents/Frostline lab.png` and `~/Movies/frostline-physics/assets/Frostline
Physics.png`; re-export from those masters when the artwork changes. The masters are not in this
repo — ask if you want them versioned.

## Accent colours

Each project has an `accent` in `projects.json` (used for badges, the channel band edge and the artwork).
Current palette: Vitreo `#2BB3C0` · Biocraft-Spark `#3FAE6A` · Biocraft Marketplace `#7C6CF0` · Frostline Physics `#3D7BF7`.
