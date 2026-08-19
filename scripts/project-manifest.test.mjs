import assert from "node:assert/strict";
import test from "node:test";
import {
  compareByRecency,
  orderProjects,
  unmatchedOrderSlugs,
  validateOrder,
  validateSiteConfig,
} from "./project-manifest.mjs";

function project(slug, date, overrides = {}) {
  return {
    schema: 1,
    title: slug,
    description: `${slug} does one useful thing well.`,
    bullets: [`Explains the concrete value of ${slug}.`],
    date,
    link: `https://yalethom.as/${slug}/`,
    type: "tool",
    tags: ["testing"],
    svg: null,
    ...overrides,
  };
}

const ONGOING_NEW = project("ongoing-new", { start: "2026-08", end: "present" });
const ONGOING_OLD = project("ongoing-old", { start: "2015-09", end: "present" });
const FINISHED_RECENT = project("finished-recent", { start: "2019-01", end: "2024-06" });
const FINISHED_OLD = project("finished-old", { start: "2012-01", end: "2013-02" });
const UNDATED = project("undated", { start: null, end: "present" });

const SITE = { title: "YaleThom.as", link: "https://yalethom.as" };

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

test("order entries must be unique lowercase kebab-case slugs", () => {
  assert.deepEqual(validateOrder(["graphtv", "txtop"]), ["graphtv", "txtop"]);
  assert.deepEqual(validateOrder(undefined), []);
  assert.deepEqual(validateOrder(null), []);
  assert.throws(() => validateOrder(["graphtv", "graphtv"]), /duplicate slug: graphtv/);
  assert.throws(() => validateOrder(["GraphTV"]), /kebab-case project slug/);
  assert.throws(() => validateOrder(["/graphtv/"]), /kebab-case project slug/);
  assert.throws(() => validateOrder("graphtv"), /must be a list/);
  assert.throws(() => validateOrder([3]), /must be a string/);
});

test("the site config requires site, accepts an optional order, and rejects extras", () => {
  assert.deepEqual(validateSiteConfig({ site: SITE, order: ["graphtv"] }), {
    site: SITE,
    order: ["graphtv"],
  });
  assert.deepEqual(validateSiteConfig({ site: SITE }), { site: SITE, order: [] });
  assert.deepEqual(validateSiteConfig({ site: SITE, order: null }), { site: SITE, order: [] });
  assert.throws(() => validateSiteConfig({ order: [] }), /site\.yaml\.site is required/);
  assert.throws(
    () => validateSiteConfig({ site: SITE, projects: [] }),
    /unsupported field\(s\): projects/,
  );
  assert.throws(() => validateSiteConfig([]), /must contain a mapping/);
});
