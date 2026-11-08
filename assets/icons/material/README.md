# Bundled Google Material Icons (offline assets)

These icons are stored as local SVG source files. The Light Remote Wall renders them inline through `lib/material-icon.mjs`. Browser pages do **not** request Google Fonts, Google's icon CDN or a remote icon stylesheet.

Source: [Google Material Design Icons](https://github.com/google/material-design-icons), licensed under [Apache License 2.0](https://github.com/google/material-design-icons/blob/master/LICENSE). The repository's root `LICENSE` contains the Apache-2.0 terms.

The G2 floating PTY widget reuses the existing local `arrow_back.svg` and `terminal.svg` and adds these verified upstream files (fetched 2026-10-19):

- `remove.svg` — `src/content/remove/materialicons/24px.svg` (minimize)
- `drag_indicator.svg` — `src/action/drag_indicator/materialicons/24px.svg` (drag affordance)
- `open_in_full.svg` — `src/action/open_in_full/materialicons/24px.svg` (expand)

No fonts were added or bundled as part of this G2 patch. The icons are static, cached server-side and inserted inline; no runtime HTTP dependencies.
