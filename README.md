# YaleThom.as

This landing page is generated from [`projects.yaml`](projects.yaml). The build
produces a static `index.html`; it does not ship any JavaScript to the browser.

## Add a project

Every project has four fields:

```yaml
- title: My Project
  category: tools
  link: https://example.com
  image: null
```

Use `image: null` for a centered text card. To use an image, add the file to
`images/` and set its repository-relative path:

```yaml
image: images/my-project.webp
```

SVG, AVIF, GIF, JPEG, PNG, and WebP files are supported. SVGs use the same
`image` field, for example `image: images/my-project.svg`.

The asset is the entire visual contents of its card, so include any desired
wordmark or text in the file itself. The build rejects remote, missing,
unsupported, and out-of-directory image paths.

## Build

Requires Node.js 20 or newer.

```sh
npm ci
npm run build
```

Commit `projects.yaml`, any new images, and the generated `index.html`. GitHub
Pages can continue serving the repository root from `master`.

## Custom domain and project URLs

The `CNAME` file configures this user site for `yalethom.as`. In GitHub, set
the custom domain for `y4le/y4le.github.io` to `yalethom.as`, then point the
domain's apex DNS records at GitHub Pages. The individual project sites inherit
that domain and are available at paths matching their repository names, such as
`yalethom.as/graphtv/` and `yalethom.as/react-resume/`.

Keep project links site-relative in `projects.yaml`. This preserves the project
path when GitHub redirects from `y4le.github.io` to the custom domain. Each
linked repository must have GitHub Pages enabled for its path to resolve.

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

Do not edit `index.html` directly. Make structural changes in
`src/index.template.html`, style changes in `main.css`, and content changes in
`projects.yaml`.
