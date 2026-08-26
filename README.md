# YaleThom.as

This landing page is generated from [`projects.yaml`](projects.yaml), the
aggregate project data, and [`site.yaml`](site.yaml), the hand-edited site
configuration. The build produces a static `index.html`; a small script controls
SVG animation playback.

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
valid declaration found under the scan path. To update matching projects while
retaining aggregate entries the scan did not match, use:

```sh
npm run manifest -- --update /home/yale/dev
```

Update matching is case-insensitive by project title. Both modes store
`projects.yaml` in canonical project-slug order, so the file stays diff-stable
and carries no display decisions; ordering lives in `site.yaml` instead. The
command copies declared artwork to deterministic `images/projects/<slug>.svg`
paths and rewrites only `projects.yaml` and changed SVG copies. It does not
touch `site.yaml`, delete unmatched assets, build the site, or edit
`index.html`. Same-origin SVG animations are paused and reset at rest, played
while the card is hovered or keyboard-focused, and allowed to finish their
current cycle when that interaction ends; reduced-motion preferences are
respected.

## Order the projects

`site.yaml` owns the site mapping and the display order. Ordering is a site
decision, so it stays in this repository rather than in the individual project
declarations:

```yaml
site:
  title: YaleThom.as
  link: https://yalethom.as
order:
  - txtop
  - graphtv
```

Projects named in `order` render first, in that order, identified by project
slug — the path segment of the canonical link. Every project left out follows
by recency: ongoing work (`date.end: present`) first, then the most recent
`date.end`, then the most recent `date.start`, with the slug as the final
tiebreak. A bare `YYYY` counts as the earliest point in that year, and a project
without a start date sorts last within its group.

Entries must be unique lowercase kebab-case slugs; duplicates fail the build.
Slugs matching no project are reported and ignored, so pinning survives a scan
that covers only some project repositories.

Reordering is a `site.yaml` edit plus `npm run build` — it neither rescans the
source repositories nor changes `projects.yaml`.

## Build

Requires Node.js 20 or newer.

```sh
npm ci
npm run build
```

The build probes the homepage and every project link concurrently, with a
five-second timeout per destination. Any non-success response, timeout, or
network error produces a large, bold-red warning in interactive terminals that
lists the affected sites. The warning does not fail the build or remove their
cards, so a transient outage does not silently change the generated page.

Browser icons share one rectangle geometry source. After changing it, regenerate
both committed assets:

```sh
npm run favicon
```

Commit `site.yaml`, `projects.yaml`, copied SVGs, and the generated `index.html`,
`favicon.svg`, and `favicon.ico`. GitHub Pages can continue serving the repository
root from `master`.

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
`/y4le/` route, and removes that route when the server stops. Starting it again
stops a previous `y4le-site` server owned by this repository before relaunching,
so a stale process on port `8000` does not cause `EADDRINUSE`. It will not stop
an unrelated process on that port. Set `PORT` to use a port other than `8000`
with either command.

To verify that the generated page is current without changing it:

```sh
npm run check
```

Do not edit `index.html`, `favicon.svg`, `favicon.ico`, or generated project
entries directly. Make structural changes in `src/index.template.html`, favicon
geometry changes in `scripts/favicon.mjs`, style changes in `main.css`, site
title, link, and ordering changes in `site.yaml`, and project content changes in
each source repository's `.yalethomas/project.yaml`, then rerun the applicable
favicon, manifest, and site builds.
