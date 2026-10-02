# Sai Suraj Karra · Portfolio

AI & data lead for industrial gases. A static, no-build portfolio site with working interactive models:

- **ASU agent lab** – optimise an air-separation plant against hourly power prices (dynamic programming), then approve or reject each change the agents propose.
- **Distillation column lab** – step through a McCabe–Thiele column and see the stages-versus-reflux trade-off.
- **Landfill gas lab** – first-order-decay (EPA-style) gas forecast over 60 years.
- **Project map** – 37 projects across 11 areas with air separation at the centre; click an area to zoom, click a project for its full write-up.
- **Technology map** and a **searchable project index** (press `/` or `Ctrl/⌘ K`).

Every lab can be shared as a link to the exact scenario and exported as a PNG.

## Publish on GitHub Pages

1. Merge this branch into `main` (or pick this branch below).
2. **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`, then save.
3. The site is served at `https://<user>.github.io/SSK_Profile/`. All paths are relative, so no configuration is needed.

If your Pages URL differs from `https://saisurajkarra.github.io/SSK_Profile/`, update the `canonical` and `og:` / `twitter:` URLs at the top of `index.html` so shared links preview correctly.

## Run locally

```bash
npx http-server . -p 8080     # any static server works
```

## Layout

```
index.html                 page content (also readable without JavaScript)
assets/css/main.css        design tokens (light/dark), components
assets/js/                 ES modules, no bundler
  main.js                  wiring: theme, tabs, command palette, deep links
  lab-asu.js lab-column.js lab-landfill.js
  galaxy.js explorer.js drawer.js tech.js
assets/data/projects.json  project cards shown on the site
assets/vendor/d3.min.js    D3 v7 (ISC licence)
assets/fonts/              Archivo, Source Serif 4, IBM Plex Mono (SIL OFL)
scripts/check-data.py      pre-publish guard for the data file
```

## Editing content

- Profile copy lives directly in `index.html`.
- Project cards live in `assets/data/projects.json`. After editing, run the guard:

  ```bash
  python3 scripts/check-data.py assets/data/projects.json
  ```

  It fails if a card contains file paths, e-mail addresses, URLs, credential words, the employer's name, or internal project names. Add new internal names to `INTERNAL_CS` / `INTERNAL_CI` in the script.

## Privacy

No analytics, cookies or third-party requests. Fonts and D3 are served from this repository. The contact address is assembled in JavaScript to avoid trivial scraping.

## Licences

D3 (ISC); Archivo, Source Serif 4 and IBM Plex Mono (SIL Open Font License 1.1). Site code © Sai Suraj Karra.
