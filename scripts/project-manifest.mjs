import path from "node:path";
import { parseDocument, visit } from "yaml";

export const PROJECT_FIELDS = [
  "schema",
  "title",
  "description",
  "bullets",
  "date",
  "link",
  "type",
  "tags",
  "svg",
];

const DATE_PATTERN = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/;
const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseYamlMapping(source, label) {
  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
    version: "1.2",
  });

  if (document.errors.length) {
    throw new Error(`${label}: ${document.errors.map((error) => error.message).join("\n")}`);
  }

  visit(document, {
    Alias() {
      throw new Error(`${label}: YAML aliases are not supported`);
    },
    Node(_key, node) {
      assert(!node.anchor, `${label}: YAML anchors are not supported`);
      assert(!node.tag?.startsWith("!"), `${label}: custom YAML tags are not supported`);
    },
  });

  let value;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }

  assert(isRecord(value), `${label} must contain a mapping`);
  return value;
}

export function requireSingleLine(value, field, { maxLength } = {}) {
  assert(typeof value === "string", `${field} must be a string`);
  assert(value.length > 0 && value === value.trim(), `${field} must be nonempty and trimmed`);
  assert(!/[\r\n]/.test(value), `${field} must be a single-line string`);
  if (maxLength !== undefined) {
    assert(Array.from(value).length <= maxLength, `${field} must be at most ${maxLength} characters`);
  }
  return value;
}

export function validateSite(value, field = "site") {
  assert(isRecord(value), `${field} must be a mapping`);
  const fields = Object.keys(value);
  const unknown = fields.filter((key) => !["title", "link"].includes(key));
  assert(unknown.length === 0, `${field} has unsupported field(s): ${unknown.join(", ")}`);
  assert(Object.hasOwn(value, "title"), `${field}.title is required`);
  assert(Object.hasOwn(value, "link"), `${field}.link is required`);

  const title = requireSingleLine(value.title, `${field}.title`);
  const link = requireSingleLine(value.link, `${field}.link`);
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`${field}.link must be an absolute URL`);
  }
  assert(url.protocol === "https:", `${field}.link must use HTTPS`);
  assert(!url.username && !url.password && !url.search && !url.hash, `${field}.link must not include credentials, a query, or a fragment`);

  return { title, link };
}

function requireExactFields(value, fields, field) {
  assert(isRecord(value), `${field} must be a mapping`);
  const missing = fields.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  assert(missing.length === 0, `${field} is missing field(s): ${missing.join(", ")}`);
  assert(unknown.length === 0, `${field} has unsupported field(s): ${unknown.join(", ")}`);
}

function validateDate(value, field) {
  requireExactFields(value, ["start", "end"], field);

  const start = value.start;
  const end = value.end;
  assert(start === null || typeof start === "string", `${field}.start must be null, YYYY, or YYYY-MM`);
  assert(typeof end === "string", `${field}.end must be YYYY, YYYY-MM, or present`);

  const startMatch = start === null ? null : DATE_PATTERN.exec(start);
  const endMatch = end === "present" ? null : DATE_PATTERN.exec(end);
  assert(start === null || startMatch, `${field}.start must be null, YYYY, or YYYY-MM`);
  assert(end === "present" || endMatch, `${field}.end must be YYYY, YYYY-MM, or present`);

  if (startMatch && endMatch) {
    const startYear = Number(startMatch[1]);
    const endYear = Number(endMatch[1]);
    assert(startYear <= endYear, `${field}.start must not follow ${field}.end`);
    if (startMatch[2] && endMatch[2] && startYear === endYear) {
      assert(Number(startMatch[2]) <= Number(endMatch[2]), `${field}.start must not follow ${field}.end`);
    }
  }

  return { start, end };
}

function validateLink(value, field) {
  const link = requireSingleLine(value, field);
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`${field} must be a canonical HTTPS yalethom.as URL`);
  }

  assert(url.protocol === "https:", `${field} must use HTTPS`);
  assert(url.hostname === "yalethom.as" && !url.port, `${field} must use yalethom.as`);
  assert(!url.username && !url.password && !url.search && !url.hash, `${field} must not include credentials, a query, or a fragment`);
  assert(/^\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(url.pathname), `${field} must contain one lowercase kebab-case project path and a trailing slash`);
  return link;
}

function validateSvg(value, field) {
  if (value === null) return null;
  const svg = requireSingleLine(value, field);
  const segments = svg.split("/");
  assert(!path.isAbsolute(svg), `${field} must be repository-relative`);
  assert(!svg.includes("\\"), `${field} must use forward slashes`);
  assert(!segments.some((segment) => !segment || segment === "." || segment === ".."), `${field} must not contain empty, current-directory, or parent-directory segments`);
  assert(path.posix.extname(svg).toLowerCase() === ".svg", `${field} must reference an SVG file`);
  return svg;
}

export function validateProject(value, field = "project") {
  requireExactFields(value, PROJECT_FIELDS, field);
  assert(value.schema === 1, `${field}.schema must be 1`);

  const title = requireSingleLine(value.title, `${field}.title`);
  const description = requireSingleLine(value.description, `${field}.description`, { maxLength: 140 });

  assert(Array.isArray(value.bullets), `${field}.bullets must be a list`);
  assert(value.bullets.length >= 1 && value.bullets.length <= 6, `${field}.bullets must contain one to six items`);
  const bullets = value.bullets.map((bullet, index) =>
    requireSingleLine(bullet, `${field}.bullets[${index}]`),
  );

  const date = validateDate(value.date, `${field}.date`);
  const link = validateLink(value.link, `${field}.link`);
  const type = requireSingleLine(value.type, `${field}.type`);
  assert(LABEL_PATTERN.test(type), `${field}.type must be lowercase kebab-case`);

  assert(Array.isArray(value.tags), `${field}.tags must be a list`);
  const tags = value.tags.map((tag, index) =>
    requireSingleLine(tag, `${field}.tags[${index}]`),
  );
  const normalizedTags = tags.map((tag) => tag.toLocaleLowerCase("en-US"));
  assert(new Set(normalizedTags).size === tags.length, `${field}.tags must be case-insensitively unique`);

  return {
    schema: 1,
    title,
    description,
    bullets,
    date,
    link,
    type,
    tags,
    svg: validateSvg(value.svg, `${field}.svg`),
  };
}

export function validateProjectList(values, field = "projects") {
  assert(Array.isArray(values), `${field} must be a list`);
  const projects = values.map((project, index) => validateProject(project, `${field}[${index}]`));
  const titles = new Set();
  const links = new Set();

  for (const project of projects) {
    const title = project.title.toLocaleLowerCase("en-US");
    assert(!titles.has(title), `${field} contains duplicate title: ${project.title}`);
    assert(!links.has(project.link), `${field} contains duplicate link: ${project.link}`);
    titles.add(title);
    links.add(project.link);
  }

  return projects;
}

export function projectSlug(project) {
  return new URL(project.link).pathname.split("/")[1];
}
