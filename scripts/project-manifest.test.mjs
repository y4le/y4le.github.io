import assert from "node:assert/strict";
import test from "node:test";
import {
  compareByRecency,
  orderProjects,
  projectSlug,
  unmatchedOrderSlugs,
  validateOrder,
  validateProject,
  validateProjectList,
  validateSiteConfig,
} from "./project-manifest.mjs";

function project(slug, date, overrides = {}) {
  return {
    schema: 2,
    title: slug,
    description: `${slug} does one useful thing well.`,
    bullets: [`Explains the concrete value of ${slug}.`],
    date,
    link: `https://yalethom.as/${slug}/`,
    type: "tool",
    tags: ["testing"],
    skills: ["JavaScript"],
    svg: null,
    ...overrides,
  };
}

const ONGOING_NEW = project("ongoing-new", { start: "2026-08", end: "present" });
const ONGOING_OLD = project("ongoing-old", { start: "2015-09", end: "present" });
const FINISHED_RECENT = project("finished-recent", { start: "2019-01", end: "2024-06" });
const FINISHED_OLD = project("finished-old", { start: "2012-01", end: "2013-02" });
const UNDATED = project("undated", { start: null, end: "present" });

const SITE = {
  title: "YaleThom.as",
  description: "Projects by Yale Thomas.",
  link: "https://yalethom.as/",
};

test("pinned slugs lead in listed order and the rest follow by recency", () => {
  const projects = [ONGOING_NEW, FINISHED_OLD, ONGOING_OLD, FINISHED_RECENT];
  const ordered = orderProjects(projects, ["finished-old", "ongoing-old"]);

  assert.deepEqual(ordered.map(({ title }) => title), [
    "finished-old",
    "ongoing-old",
    "ongoing-new",
    "finished-recent",
  ]);
});

test("last-pinned slugs follow unordered projects in listed order", () => {
  const projects = [ONGOING_NEW, FINISHED_OLD, ONGOING_OLD, FINISHED_RECENT];
  const ordered = orderProjects(projects, ["finished-old"], ["ongoing-new", "ongoing-old"]);

  assert.deepEqual(ordered.map(({ title }) => title), [
    "finished-old",
    "finished-recent",
    "ongoing-new",
    "ongoing-old",
  ]);
});

test("recency ranks ongoing work first, then end date, then start date, then slug", () => {
  const ordered = orderProjects([FINISHED_OLD, ONGOING_OLD, FINISHED_RECENT, ONGOING_NEW, UNDATED]);

  assert.deepEqual(ordered.map(({ title }) => title), [
    "ongoing-new",
    "ongoing-old",
    "undated",
    "finished-recent",
    "finished-old",
  ]);
});

test("a bare year sorts as the earliest point in that year", () => {
  const bareYear = project("bare-year", { start: "2026", end: "present" });
  const withMonth = project("with-month", { start: "2026-01", end: "present" });

  assert.equal(compareByRecency(withMonth, bareYear) < 0, true);
  assert.equal(compareByRecency(bareYear, withMonth) > 0, true);
});

test("equal recency falls back to the slug", () => {
  const first = project("aaa", { start: "2026-01", end: "present" });
  const second = project("bbb", { start: "2026-01", end: "present" });

  assert.deepEqual(orderProjects([second, first]).map(({ title }) => title), ["aaa", "bbb"]);
});

test("ordering ignores unknown slugs and leaves the input array untouched", () => {
  const projects = [ONGOING_OLD, ONGOING_NEW];
  const order = ["retired", "ongoing-old"];
  const ordered = orderProjects(projects, order);

  assert.deepEqual(ordered.map(({ title }) => title), ["ongoing-old", "ongoing-new"]);
  assert.deepEqual(projects.map(({ title }) => title), ["ongoing-old", "ongoing-new"]);
  assert.deepEqual(unmatchedOrderSlugs(projects, order), ["retired"]);
});

test("an empty or absent order list leaves ordering entirely to recency", () => {
  const projects = [FINISHED_OLD, ONGOING_NEW];

  assert.deepEqual(orderProjects(projects, []).map(({ title }) => title), ["ongoing-new", "finished-old"]);
  assert.deepEqual(orderProjects(projects).map(({ title }) => title), ["ongoing-new", "finished-old"]);
});

test("project links and order entries allow case-sensitive slugs", () => {
  const bigO = project("bigO", { start: "2026-08", end: "present" });

  assert.equal(validateProject(bigO).link, "https://yalethom.as/bigO/");
  assert.equal(projectSlug(bigO), "bigO");
  assert.deepEqual(validateOrder(["bigO", "txtop"]), ["bigO", "txtop"]);
  assert.deepEqual(validateOrder(undefined), []);
  assert.deepEqual(validateOrder(null), []);
  assert.throws(() => validateOrder(["graphtv", "graphtv"]), /duplicate slug: graphtv/);
  assert.throws(() => validateOrder(["graph_tv"]), /alphanumeric project slug/);
  assert.throws(() => validateOrder(["/graphtv/"]), /alphanumeric project slug/);
  assert.throws(() => validateOrder("graphtv"), /must be a list/);
  assert.throws(() => validateOrder([3]), /must be a string/);
});

test("project slugs cannot differ only by case", () => {
  const uppercase = project("bigO", { start: "2026-08", end: "present" });
  const lowercase = project("bigo", { start: "2026-07", end: "present" }, {
    title: "another project",
  });

  assert.throws(
    () => validateProjectList([uppercase, lowercase]),
    /case-insensitive duplicate project slug: bigo/,
  );
});

test("project schema 2 separates subject tags from demonstrated skills", () => {
  const valid = project("typed", { start: "2026-08", end: "present" }, {
    skills: ["TypeScript", "JavaScript"],
  });

  assert.deepEqual(validateProject(valid).skills, ["TypeScript", "JavaScript"]);
  assert.throws(
    () => validateProject({ ...valid, skills: ["TypeScript"] }),
    /include javascript when it includes typescript/i,
  );
  assert.throws(
    () => validateProject({ ...valid, tags: ["JavaScript"] }),
    /tags and project\.skills must be case-insensitively disjoint/i,
  );
  assert.throws(
    () => validateProject({ ...valid, skills: ["JavaScript", "javascript"] }),
    /skills must be case-insensitively unique/i,
  );
});

test("project schema 1 remains valid without skills and rejects schema 2 fields", () => {
  const current = project("legacy", { start: "2015", end: "2020" });
  const { skills: _skills, ...legacy } = current;
  legacy.schema = 1;

  assert.equal(Object.hasOwn(validateProject(legacy), "skills"), false);
  assert.throws(
    () => validateProject({ ...legacy, skills: [] }),
    /unsupported field\(s\): skills/,
  );
  assert.throws(
    () => validateProject({ ...current, skills: undefined }),
    /skills must be a list/,
  );
});

test("the site config requires site, accepts optional leading and trailing order, and rejects extras", () => {
  assert.deepEqual(validateSiteConfig({ site: SITE, order: ["graphtv"], last: ["resume"] }), {
    site: SITE,
    order: ["graphtv"],
    last: ["resume"],
  });
  assert.deepEqual(validateSiteConfig({ site: SITE }), { site: SITE, order: [], last: [] });
  assert.deepEqual(validateSiteConfig({ site: SITE, order: null, last: null }), {
    site: SITE,
    order: [],
    last: [],
  });
  assert.throws(
    () => validateSiteConfig({ site: SITE, order: ["resume"], last: ["resume"] }),
    /lists slug in both order and last: resume/,
  );
  assert.throws(() => validateSiteConfig({ order: [] }), /site\.yaml\.site is required/);
  assert.throws(
    () => validateSiteConfig({ site: SITE, projects: [] }),
    /unsupported field\(s\): projects/,
  );
  assert.throws(() => validateSiteConfig([]), /must contain a mapping/);
  assert.throws(
    () => validateSiteConfig({ site: { title: SITE.title, link: SITE.link } }),
    /site\.description is required/,
  );
  assert.throws(
    () => validateSiteConfig({ site: { ...SITE, description: "x".repeat(161) } }),
    /site\.description must be at most 160 characters/,
  );
});
