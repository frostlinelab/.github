# Artwork spec

Every project in `site/projects.json` points at one banner and one logo, named after the project `id`:

```
site/assets/banners/<id>.svg     site/assets/logos/<id>.svg
```

Drop-in replacements are welcome as long as the names and the sizes below stay the same — run
`node tools/build-embed.js` afterwards and it will fail loudly if a file is missing.

## Banners — 1200 × 675 (16:9)

Shown as the card header in the README grid, the gallery and the homepage.

- **Opaque background.** Banners sit on both light and dark pages, so no transparency.
- **Dark text on a light ground**, or the reverse — but pick one and check both themes.
- Keep the project name in the left third; the right side reads better as imagery.
- Keep the file under ~60 KB where possible — SVG is ideal, PNG/WebP also work (change the extension in `projects.json`).

## Logos — square, 512 × 512 recommended, transparent

Used at 16–34 px: in the README project line, on the gallery cards, and in the homepage channel band.

- **Transparent background**, no text — it is always rendered next to the project name.
- Bold shapes, few details. If it does not read at 20 px, it is too busy.
- Keep the main strokes in the project accent colour so it matches the card and badges.

## Accent colours

Each project has an `accent` in `projects.json` (used for badges, the channel band edge and the artwork).
Current palette: Vitreo `#2BB3C0` · Biocraft-Spark `#3FAE6A` · Biocraft Marketplace `#7C6CF0` · Frostline Physics `#3D7BF7`.
