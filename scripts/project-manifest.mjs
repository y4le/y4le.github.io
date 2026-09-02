import path from "node:path";
import { parseDocument, visit } from "yaml";

export const PROJECT_FIELDS_V1 = [
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

export const PROJECT_FIELDS_V2 = [
  ...PROJECT_FIELDS_V1.slice(0, -1),
  "skills",
  "svg",
];

const DATE_PATTERN = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/;
const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

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
  const unknown = fields.filter((key) => !["title", "description", "link"].includes(key));
  assert(unknown.length === 0, `${field} has unsupported field(s): ${unknown.join(", ")}`);
  assert(Object.hasOwn(value, "title"), `${field}.title is required`);
  assert(Object.hasOwn(value, "description"), `${field}.description is required`);
  assert(Object.hasOwn(value, "link"), `${field}.link is required`);

  const title = requireSingleLine(value.title, `${field}.title`);
  const description = requireSingleLine(value.description, `${field}.description`, {
    maxLength: 160,
  });
  const link = requireSingleLine(value.link, `${field}.link`);
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`${field}.link must be an absolute URL`);
  }
  assert(url.protocol === "https:", `${field}.link must use HTTPS`);
  assert(!url.username && !url.password && !url.search && !url.hash, `${field}.link must not include credentials, a query, or a fragment`);

  return { title, description, link };
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
  assert(
    /^\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\/$/.test(url.pathname),
    `${field} must contain one case-sensitive alphanumeric project path and a trailing slash`,
  );
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
  assert(isRecord(value), `${field} must be a mapping`);
  assert(Object.hasOwn(value, "schema"), `${field} is missing field(s): schema`);
  assert(value.schema === 1 || value.schema === 2, `${field}.schema must be 1 or 2`);
  requireExactFields(
    value,
    value.schema === 1 ? PROJECT_FIELDS_V1 : PROJECT_FIELDS_V2,
    field,
  );

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

  let skills;
  if (value.schema === 2) {
    assert(Array.isArray(value.skills), `${field}.skills must be a list`);
    skills = value.skills.map((skill, index) =>
      requireSingleLine(skill, `${field}.skills[${index}]`),
    );
    const normalizedSkills = skills.map((skill) => skill.toLocaleLowerCase("en-US"));
    assert(
      new Set(normalizedSkills).size === skills.length,
      `${field}.skills must be case-insensitively unique`,
    );

    const tagSet = new Set(normalizedTags);
    const overlap = skills.filter((_, index) => tagSet.has(normalizedSkills[index]));
    assert(
      overlap.length === 0,
      `${field}.tags and ${field}.skills must be case-insensitively disjoint: ${overlap.join(", ")}`,
    );

    const skillSet = new Set(normalizedSkills);
    const requiredCompanions = new Map([
      ["typescript", "javascript"],
      ["ruby on rails", "ruby"],
      ["sqlite", "sql"],
    ]);
    for (const [skill, companion] of requiredCompanions) {
      assert(
        !skillSet.has(skill) || skillSet.has(companion),
        `${field}.skills must include ${companion} when it includes ${skill}`,
      );
    }
  }

  return {
    schema: value.schema,
    title,
    description,
    bullets,
    date,
    link,
    type,
    tags,
    ...(skills === undefined ? {} : { skills }),
    svg: validateSvg(value.svg, `${field}.svg`),
  };
}

export function validateProjectList(values, field = "projects") {
  assert(Array.isArray(values), `${field} must be a list`);
  const projects = values.map((project, index) => validateProject(project, `${field}[${index}]`));
  const titles = new Set();
  const links = new Set();
  const slugs = new Set();

  for (const project of projects) {
    const title = project.title.toLocaleLowerCase("en-US");
    const slug = projectSlug(project).toLocaleLowerCase("en-US");
    assert(!titles.has(title), `${field} contains duplicate title: ${project.title}`);
    assert(!links.has(project.link), `${field} contains duplicate link: ${project.link}`);
    assert(
      !slugs.has(slug),
      `${field} contains a case-insensitive duplicate project slug: ${projectSlug(project)}`,
    );
    titles.add(title);
    links.add(project.link);
    slugs.add(slug);
  }

  return projects;
}

export function projectSlug(project) {
  return new URL(project.link).pathname.split("/")[1];
}

export const SITE_CONFIG_FIELDS = ["site", "order", "last"];

export function validateOrder(value, field = "order") {
  if (value === undefined || value === null) return [];
  assert(Array.isArray(value), `${field} must be a list`);

  const slugs = value.map((entry, index) => {
    const slug = requireSingleLine(entry, `${field}[${index}]`);
    assert(PROJECT_SLUG_PATTERN.test(slug), `${field}[${index}] must be a case-sensitive alphanumeric project slug`);
    return slug;
  });

  const seen = new Set();
  for (const slug of slugs) {
    assert(!seen.has(slug), `${field} contains duplicate slug: ${slug}`);
    seen.add(slug);
  }

  return slugs;
}

export function validateSiteConfig(value, field = "site.yaml") {
  assert(isRecord(value), `${field} must contain a mapping`);
  const unknown = Object.keys(value).filter((key) => !SITE_CONFIG_FIELDS.includes(key));
  assert(unknown.length === 0, `${field} has unsupported field(s): ${unknown.join(", ")}`);
  assert(Object.hasOwn(value, "site"), `${field}.site is required`);

  const order = validateOrder(value.order, `${field}.order`);
  const last = validateOrder(value.last, `${field}.last`);
  const leading = new Set(order);
  const duplicated = last.find((slug) => leading.has(slug));
  assert(duplicated === undefined, `${field} lists slug in both order and last: ${duplicated}`);

  return {
    site: validateSite(value.site, `${field}.site`),
    order,
    last,
  };
}

function comparableMonth(value) {
  return value.includes("-") ? value : `${value}-00`;
}

function recencyKey(project) {
  const { start, end } = project.date;
  return {
    ongoing: end === "present",
    end: end === "present" ? "" : comparableMonth(end),
    start: start === null ? "" : comparableMonth(start),
  };
}

export function compareByRecency(left, right) {
  const first = recencyKey(left);
  const second = recencyKey(right);

  if (first.ongoing !== second.ongoing) return first.ongoing ? -1 : 1;
  if (first.end !== second.end) return first.end < second.end ? 1 : -1;
  if (first.start !== second.start) return first.start < second.start ? 1 : -1;
  return projectSlug(left).localeCompare(projectSlug(right), "en");
}

export function orderProjects(projects, order = [], last = []) {
  const leadingRank = new Map(order.map((slug, index) => [slug, index]));
  const trailingRank = new Map(last.map((slug, index) => [slug, index]));

  return [...projects].sort((left, right) => {
    const leftSlug = projectSlug(left);
    const rightSlug = projectSlug(right);
    const leftGroup = leadingRank.has(leftSlug) ? 0 : trailingRank.has(leftSlug) ? 2 : 1;
    const rightGroup = leadingRank.has(rightSlug) ? 0 : trailingRank.has(rightSlug) ? 2 : 1;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;

    if (leftGroup === 0) return leadingRank.get(leftSlug) - leadingRank.get(rightSlug);
    if (leftGroup === 2) return trailingRank.get(leftSlug) - trailingRank.get(rightSlug);
    return compareByRecency(left, right);
  });
}

export function unmatchedOrderSlugs(projects, ...orders) {
  const present = new Set(projects.map(projectSlug));
  return orders.flat().filter((slug) => !present.has(slug));
}
