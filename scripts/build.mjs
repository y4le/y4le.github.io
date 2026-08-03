import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const ROOT_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const CONFIG_PATH = path.join(ROOT_DIRECTORY, "projects.yaml");
const TEMPLATE_PATH = path.join(ROOT_DIRECTORY, "src", "index.template.html");
const OUTPUT_PATH = path.join(ROOT_DIRECTORY, "index.html");
const IMAGE_DIRECTORY = path.join(ROOT_DIRECTORY, "images");
const CHECK_ONLY = process.argv.includes("--check");

const PROJECT_FIELDS = ["title", "category", "link", "image"];
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, field) {
  assert(
    typeof value === "string" && value.trim(),
    `${field} must be a non-empty string`,
  );
  return value.trim();
}

function requireSafeLink(value, field) {
  const link = requireNonEmptyString(value, field);
  const protocol = /^[a-z][a-z\d+.-]*:/i.exec(link)?.[0].toLowerCase();

  assert(
    protocol === undefined || protocol === "http:" || protocol === "https:",
    `${field} must be an HTTP(S) URL or a site-relative path`,
  );
  assert(!link.startsWith("//"), `${field} must not be a protocol-relative URL`);

  return link;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderWordmark(title) {
  const dotIndex = title.indexOf(".");
  if (dotIndex === -1) {
    return escapeHtml(title);
  }

  const before = escapeHtml(title.slice(0, dotIndex));
  const after = escapeHtml(title.slice(dotIndex + 1));
  return `${before}<span class="wordmark-dot" aria-hidden="true"></span>${after}`;
}

async function validateImage(value, field) {
  if (value === null || value === "") {
    return null;
  }

  const image = requireNonEmptyString(value, field);
  const segments = image.split("/");

  assert(!path.isAbsolute(image), `${field} must be a relative path under images/`);
  assert(!image.includes("\\"), `${field} must use forward slashes`);
  assert(segments[0] === "images", `${field} must point to a file under images/`);
  assert(!segments.includes(".."), `${field} must not leave images/`);
  assert(
    SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(image).toLowerCase()),
    `${field} must be an SVG, AVIF, GIF, JPEG, PNG, or WebP file`,
  );

  const absolutePath = path.resolve(ROOT_DIRECTORY, image);
  const relativeToImages = path.relative(IMAGE_DIRECTORY, absolutePath);
  assert(
    relativeToImages && !relativeToImages.startsWith("..") && !path.isAbsolute(relativeToImages),
    `${field} must point to a file under images/`,
  );

  let file;
  try {
    file = await stat(absolutePath);
  } catch {
    throw new Error(`${field} references a missing file: ${image}`);
  }
  assert(file.isFile(), `${field} must reference a file: ${image}`);

  return image;
}

async function validateProject(project, index) {
  const prefix = `projects[${index}]`;
  assert(isRecord(project), `${prefix} must be a mapping`);

  for (const field of PROJECT_FIELDS) {
    assert(Object.hasOwn(project, field), `${prefix}.${field} is required`);
  }

  const unknownFields = Object.keys(project).filter((field) => !PROJECT_FIELDS.includes(field));
  assert(
    unknownFields.length === 0,
    `${prefix} has unsupported field(s): ${unknownFields.join(", ")}`,
  );

  return {
    title: requireNonEmptyString(project.title, `${prefix}.title`),
    category: requireNonEmptyString(project.category, `${prefix}.category`),
    link: requireSafeLink(project.link, `${prefix}.link`),
    image: await validateImage(project.image, `${prefix}.image`),
  };
}

function renderProject(project) {
  const content = project.image
    ? `<img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)}">`
    : `<span class="project-title">${escapeHtml(project.title)}</span>`;

  return [
    `<a class="project-card" href="${escapeHtml(project.link)}" data-category="${escapeHtml(project.category)}">`,
    `  ${content}`,
    `</a>`,
  ].join("\n");
}

function replaceToken(template, name, value) {
  const token = `{{${name}}}`;
  const occurrences = template.split(token).length - 1;
  assert(occurrences > 0, `Template must contain ${token}`);
  return template.replaceAll(token, value);
}

async function loadConfig() {
  const source = await readFile(CONFIG_PATH, "utf8");
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });

  if (document.errors.length) {
    throw new Error(document.errors.map((error) => error.message).join("\n"));
  }

  const config = document.toJS({ maxAliasCount: 0 });
  assert(isRecord(config), "projects.yaml must contain a mapping");
  assert(isRecord(config.site), "site must be a mapping");
  assert(Array.isArray(config.projects), "projects must be a list");

  const unsupportedTopLevelFields = Object.keys(config).filter(
    (field) => !["site", "projects"].includes(field),
  );
  assert(
    unsupportedTopLevelFields.length === 0,
    `projects.yaml has unsupported field(s): ${unsupportedTopLevelFields.join(", ")}`,
  );

  const siteFields = Object.keys(config.site);
  const unsupportedSiteFields = siteFields.filter((field) => !["title", "link"].includes(field));
  assert(
    unsupportedSiteFields.length === 0,
    `site has unsupported field(s): ${unsupportedSiteFields.join(", ")}`,
  );

  const title = requireNonEmptyString(config.site.title, "site.title");
  const link = requireSafeLink(config.site.link, "site.link");
  const projects = await Promise.all(config.projects.map(validateProject));

  return { site: { title, link }, projects };
}

async function render() {
  const [config, template] = await Promise.all([
    loadConfig(),
    readFile(TEMPLATE_PATH, "utf8"),
  ]);

  const projectCards = (
    config.projects.length
      ? config.projects.map(renderProject).join("\n")
      : '<p class="empty-state">Projects coming soon.</p>'
  ).replaceAll("\n", "\n          ");

  const replacements = {
    SITE_TITLE: escapeHtml(config.site.title),
    SITE_LINK: escapeHtml(config.site.link),
    WORDMARK: renderWordmark(config.site.title),
    PROJECT_CARDS: projectCards,
  };

  return Object.entries(replacements).reduce(
    (html, [name, value]) => replaceToken(html, name, value),
    template,
  );
}

async function main() {
  const html = await render();

  if (CHECK_ONLY) {
    const currentHtml = await readFile(OUTPUT_PATH, "utf8").catch(() => "");
    assert(
      currentHtml === html,
      "index.html is out of date; run `npm run build` and commit the result",
    );
    console.log("index.html is up to date");
    return;
  }

  await writeFile(OUTPUT_PATH, html);
  console.log("Built index.html from projects.yaml");
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
