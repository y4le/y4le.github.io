# YaleThom.as

This landing page is generated from [`projects.yaml`](projects.yaml). The build
produces a static `index.html`; it does not ship any JavaScript to the browser.

## Add a project

Each project repository owns its public declaration at
`.yalethomas/project.yaml`. Schema 1 requires the complete rich project record:

```yaml
schema: 1
title: metrainome
description: A timing instrument that makes practice accuracy visible.
bullets:
  - Places targets, recent hits, and timing distributions on one shared axis.
  - Runs locally in the browser with keyboard and touch controls.
date:
  start: "2025-01"
  end: "present"
link: https://yalethom.as/metrainome/
type: app
tags:
  - music
  - Web Audio
  - data visualization
svg: .yalethomas/card.svg
```

All fields are required. Set `svg: null` for a typographic card; otherwise the
SVG path is repository-root-relative and must name an existing file. Titles,
descriptions, bullets, dates, canonical links, types, and tags are validated as
schema 1 data rather than rewritten by this site.

Rebuild the aggregate manifest by scanning a directory that contains project
repositories:

```sh
npm run manifest -- /home/yale/dev
```

Rebuild mode is the default: it replaces the aggregate project list with every
valid declaration found under the scan path, sorted by canonical project slug.
It preserves the consumer-owned `site` mapping. To update matching projects
while retaining unmatched aggregate entries and their order, use:

```sh
npm run manifest -- --update /home/yale/dev
```

Update matching is case-insensitive by project title; newly found projects are
appended. The command copies declared artwork to deterministic
`images/projects/<slug>.svg` paths and rewrites only `projects.yaml` and changed
SVG copies. It does not delete unmatched assets, build the site, or edit
`index.html`.

## Build

Requires Node.js 20 or newer.

```sh
npm ci
npm run build
```

Commit `projects.yaml`, copied SVGs, and the generated `index.html`. GitHub
Pages can continue serving the repository root from `master`.

## Custom domain and project URLs

The `CNAME` file configures this user site for `yalethom.as`. In GitHub, set
the custom domain for `y4le/y4le.github.io` to `yalethom.as`, then point the
domain's apex DNS records at GitHub Pages. The individual project sites inherit
that domain and are available at paths matching their repository names, such as
`yalethom.as/graphtv/` and `yalethom.as/react-resume/`.

Project declarations use their canonical `https://yalethom.as/<project>/`
links. Each linked repository must have GitHub Pages enabled for its path to
resolve.

## Development

Start a local development server and open <http://localhost:8000>:

```sh
npm run dev
```

To make the same server available to devices on the tailnet, run:

```sh
npm run dev:tailscale
```

The command prints the HTTPS tailnet URL, registers only the project-owned
`/y4le/` route, and removes that route when the server stops. Set `PORT` to use
a port other than `8000` with either command.

To verify that the generated page is current without changing it:

```sh
npm run check
```

Do not edit `index.html` or generated project entries directly. Make structural
changes in `src/index.template.html`, style changes in `main.css`, and project
content changes in each source repository's `.yalethomas/project.yaml`, then
rerun the manifest and site builds.
