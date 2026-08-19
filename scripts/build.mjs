import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  isRecord,
  orderProjects,
  parseYamlMapping,
  unmatchedOrderSlugs,
  validateProjectList,
  validateSiteConfig,
} from "./project-manifest.mjs";

const ROOT_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const CONFIG_PATH = path.join(ROOT_DIRECTORY, "projects.yaml");
const SITE_CONFIG_PATH = path.join(ROOT_DIRECTORY, "site.yaml");
const TEMPLATE_PATH = path.join(ROOT_DIRECTORY, "src", "index.template.html");
const OUTPUT_PATH = path.join(ROOT_DIRECTORY, "index.html");
const IMAGE_DIRECTORY = path.join(ROOT_DIRECTORY, "images");
const CHECK_ONLY = process.argv.includes("--check");

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

async function validateProjectSvg(project, index) {
  if (project.svg === null) return project;
  const field = `projects[${index}].svg`;
  const segments = project.svg.split("/");
  assert(segments[0] === "images", `${field} must point to a copied file under images/`);

  const absolutePath = path.resolve(ROOT_DIRECTORY, project.svg);
  const relativeToImages = path.relative(IMAGE_DIRECTORY, absolutePath);
  assert(
    relativeToImages && !relativeToImages.startsWith("..") && !path.isAbsolute(relativeToImages),
    `${field} must point to a file under images/`,
  );

  let file;
  try {
    file = await stat(absolutePath);
  } catch {
    throw new Error(`${field} references a missing file: ${project.svg}`);
  }
  assert(file.isFile(), `${field} must reference a file: ${project.svg}`);
  return project;
}

function renderProject(project) {
  let content = `<span class="project-title">${escapeHtml(project.title)}</span>`;
  if (project.svg) {
    content = [
      `<object class="project-media project-svg" data="${escapeHtml(project.svg)}" type="image/svg+xml" aria-hidden="true" tabindex="-1">`,
      `  <span class="project-title">${escapeHtml(project.title)}</span>`,
      `</object>`,
    ].join("\n");
  }

  return [
    `<a class="project-card" href="${escapeHtml(project.link)}" data-category="${escapeHtml(project.type)}" aria-label="${escapeHtml(project.title)}">`,
    `  ${content.replaceAll("\n", "\n  ")}`,
    `</a>`,
  ].join("\n");
}

function replaceToken(template, name, value) {
  const token = `{{${name}}}`;
  const occurrences = template.split(token).length - 1;
  assert(occurrences > 0, `Template must contain ${token}`);
  return template.replaceAll(token, value);
}

async function loadSiteConfig() {
  const source = await readFile(SITE_CONFIG_PATH, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error("site.yaml is required; it holds the site mapping and the display order list");
    }
    throw error;
  });

  return validateSiteConfig(parseYamlMapping(source, "site.yaml"), "site.yaml");
}

async function loadConfig() {
  const [{ site, order }, source] = await Promise.all([
    loadSiteConfig(),
    readFile(CONFIG_PATH, "utf8"),
  ]);

  const config = parseYamlMapping(source, "projects.yaml");
  assert(isRecord(config), "projects.yaml must contain a mapping");
  assert(Array.isArray(config.projects), "projects must be a list");

  const unsupportedTopLevelFields = Object.keys(config).filter((field) => field !== "projects");
  assert(
    unsupportedTopLevelFields.length === 0,
    `projects.yaml has unsupported field(s): ${unsupportedTopLevelFields.join(", ")}`,
  );

  const declarations = validateProjectList(config.projects);
  const validated = await Promise.all(declarations.map(validateProjectSvg));
  const projects = orderProjects(validated, order);
  const unmatched = unmatchedOrderSlugs(validated, order);

  if (unmatched.length) {
    console.warn(`Notice: site.yaml order lists unknown project slug(s): ${unmatched.join(", ")}`);
  }

  return { site, projects };
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
  console.log("Built index.html from projects.yaml and site.yaml");
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
