// The daily @matchamap.app outbox (tools/social): the plan (brand spacing, handles only from data, banned words, caption
// length, same date = same plan), the drawings (PNG sizes, 36px text floor, nothing cut or overlapping) and the publish
// step (a dry run makes no network call; a live run refuses without SOCIAL_PUBLISH=1, a token and Steven's pick).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, loadData, knownHandles, recordHistory, BANNED, CAPTION_MAX, timeWords, regionOf } from "../tools/social/plan.js";
import { renderPages, itemHtml, pngSize, chromePath, MIN_TEXT_PX } from "../tools/social/render.js";
import { publish, modeOf, refusal, parseArgs } from "../tools/social/publish.js";
import { addDays } from "../tools/gen-pages.js";

const DATA = loadData();
const days = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
const handlesIn = (s) => [...String(s).matchAll(/(?:^|[\s(])@([A-Za-z0-9._]+)/g)].map((m) => m[1].toLowerCase().replace(/\.$/, ""));

// a small world: two pop-ups the same day in one city, one with a banned word in its name, one with no handle
const city = (name, state, lat, lng) => ({ name, state, slug: name.toLowerCase().replace(/[^a-z]+/g, "-"), lat, lng, tz: "America/New_York" });
const ev = (o) => ({ status: "upcoming", kind: "popup", category: "matcha", confidence: "likely", tz: "America/New_York", all_day: false, menu: [], links: {}, posts: {}, series: null, ...o });
const FIX = {
  events: [
    ev({ id: "a1", brand: "Leaf Cart", handle: "leafcart", start: "2026-12-01T10:00:00-05:00", end: "2026-12-01T14:00:00-05:00", venue: "Corner Books", address: "1 Main St", city: "Durham", state: "NC", menu: ["iced matcha", "hojicha"] }),
    ev({ id: "a2", brand: "No Handle Matcha", handle: null, start: "2026-12-01T09:00:00-05:00", end: "2026-12-01T12:00:00-05:00", venue: "", address: "", city: "Durham", state: "NC" }),
    ev({ id: "a3", brand: "Cute Cup", handle: "cutecup", start: "2026-12-01T11:00:00-05:00", city: "Durham", state: "NC" }),
    ev({ id: "a4", brand: "Unsure Thing", handle: "unsure.thing", confidence: "unsure", start: "2026-12-01T11:00:00-05:00", city: "Raleigh", state: "NC" }),
    ev({ id: "a5", brand: "Weekly Whisk", handle: "weeklywhisk", start: "2026-12-02T08:00:00-05:00", end: "2026-12-02T11:00:00-05:00", venue: "Corner Books", city: "Raleigh", state: "NC", series: { weekdays: [3] } }),
  ],
  shops: [{ id: "s1", name: "Green Door", city: "Raleigh", state: "NC", address: "9 Oak St", instagram: "greendoor.tea", verified: true, tier: "serves", read: "2026-11-28", menu_matcha: [{ name: "Matcha Latte" }, { name: "Usucha" }, { name: "Strawberry Matcha" }, { name: "Hojicha Latte" }] }],
  brands: [], sources: [],
  hashtags: { always: ["matcha", "matchapopup", "matchamap"], city: ["matcha{city}", "{city}food"], rotating: ["a1", "b2", "c3", "d4"] },
  cities: [city("Durham", "NC", 35.99, -78.9), city("Raleigh", "NC", 35.78, -78.64)],
  hasCityPage: () => true,
};

test("plan: the same date and data give the same plan", () => {
  assert.deepEqual(plan({ date: "2026-11-24", data: DATA, history: {} }), plan({ date: "2026-11-24", data: DATA, history: {} }));
  assert.deepEqual(plan({ date: "2026-12-01", data: FIX }), plan({ date: "2026-12-01", data: FIX }));
});

test("plan: 2 to 3 feed posts, and stories in location groups of a title and one or two stories (2 groups, 6 stories at most)", () => {
  for (const date of ["2026-11-24", "2026-11-27", "2026-11-28"]) {
    const p = plan({ date, data: DATA, history: {} });
    const feed = p.items.filter((i) => i.slot === "feed").length, story = p.items.filter((i) => i.slot === "story").length;
    assert.ok(feed >= 2 && feed <= 3, `${date}: ${feed} feed`);
    assert.ok(story >= 2 && story <= 6, `${date}: ${story} stories`);
    const st = p.items.filter((i) => i.slot === "story"), keys = [...new Set(st.map((i) => i.group.key))];
    assert.ok(keys.length >= 1 && keys.length <= 2, `${date}: ${keys.length} groups`);
    for (const k of keys) {
      const g = st.filter((i) => i.group.key === k);
      assert.equal(g[0].kind, "location", "each group opens with its title story");
      assert.ok(g.length >= 2 && g.length <= 3, `${date} ${k}: ${g.length} stories`);
      assert.deepEqual(g.map((i) => i.time), [...g.map((i) => i.time)].sort(), "a group's stories go out in order");
      assert.ok(g.slice(1).every((i) => i.kind !== "location"));
    }
    assert.deepEqual(st.map((i) => i.group.key), keys.flatMap((k) => st.filter((i) => i.group.key === k).map((i) => i.group.key)), "stories are in group order");
  }
});

test("plan: no brand twice within 7 days over three weeks of runs", () => {
  let history = {};
  const seen = new Map();
  for (const date of days("2026-11-24", 21)) {
    const p = plan({ date, data: DATA, history });
    for (const b of p.featured.brands) {
      const last = seen.get(b);
      if (last) assert.ok(date >= addDays(last, 7), `${b} on ${last} and again on ${date}`);
      seen.set(b, date);
    }
    history = recordHistory(history, p);
  }
  assert.ok(seen.size > 10);
});

test("plan: a re-run of a date ignores its own history entry", () => {
  const p = plan({ date: "2026-11-24", data: DATA, history: {} });
  assert.deepEqual(plan({ date: "2026-11-24", data: DATA, history: recordHistory({}, p) }), p);
});

test("plan: every handle tagged or written comes from our data, never made up", () => {
  const known = knownHandles(DATA);
  let history = {};
  for (const date of days("2026-11-24", 14)) {
    const p = plan({ date, data: DATA, history });
    for (const it of p.items) {
      for (const h of [...it.mentions, ...it.user_tags.map((t) => t.username), ...handlesIn(it.caption)]) assert.ok(known.has(h), `${date} ${it.name}: @${h} is not in the data`);
      for (const t of it.user_tags) assert.deepEqual([t.x, t.y], [0.5, 0.5]);
      if (it.slot === "story") assert.equal(it.user_tags.length, 0);
    }
    history = recordHistory(history, p);
  }
  const f = plan({ date: "2026-12-01", data: FIX });
  const caps = f.items.map((i) => i.caption).join("\n");
  assert.ok(!/@nohandle/i.test(caps));
  for (const h of handlesIn(caps)) assert.ok(knownHandles(FIX).has(h), h);
});

test("plan: banned words never appear, captions stay under 2,200 characters, 5 to 8 hashtags, the city page link", () => {
  for (const t of [...DATA.hashtags.always, ...DATA.hashtags.city, ...DATA.hashtags.rotating]) assert.ok(!BANNED.test(t), t);
  let history = {};
  for (const date of days("2026-11-24", 14)) {
    const p = plan({ date, data: DATA, history });
    for (const it of p.items) {
      assert.ok(!BANNED.test(JSON.stringify(it)), `${date} ${it.name}`);
      assert.ok(it.caption.length <= CAPTION_MAX, `${it.name} ${it.caption.length}`);
      assert.ok(it.hashtags.length >= 5 && it.hashtags.length <= 8, `${it.name} ${it.hashtags.length}`);
      assert.match(it.caption, /https:\/\/matchamap\.app\/(city\/[a-z]{2}\/[a-z0-9-]+\/)?/);
    }
    history = recordHistory(history, p);
  }
  const f = plan({ date: "2026-12-01", data: FIX });
  assert.ok(!JSON.stringify(f).includes("Cute Cup"), "a brand name with a banned word is left out");
  assert.ok(!JSON.stringify(f).includes("Unsure Thing"), "unsure finds are left out");
  const top = f.items.find((i) => i.kind === "today");
  assert.equal(top.city, "Durham");
  assert.equal(top.link, "https://matchamap.app/city/nc/durham/");
  assert.ok(top.caption.includes("@leafcart"));
  assert.ok(f.items.some((i) => (i.kind === "shop" || i.kind === "featured-shop") && i.mentions.includes("greendoor.tea")));
  assert.ok(f.items.some((i) => i.kind === "series" && i.title === "Every Wednesday"));
  assert.equal(timeWords(FIX.events[0]), "10 am to 2 pm");
});

test("plan: Thursday and Friday add the weekend roundup", () => {
  const p = plan({ date: "2026-11-27", data: DATA, history: {} });
  assert.ok(p.items.some((i) => i.kind === "weekend" && /^This weekend in /.test(i.title)));
  assert.ok(!plan({ date: "2026-11-24", data: DATA, history: {} }).items.some((i) => i.kind === "weekend"));
});

const hasChrome = fs.existsSync(chromePath());
// The Triangle's week (Steven, 2026-11-23): a week with nothing from Raleigh, Durham, Chapel Hill, Cary or Apex gets one of
// its own as the second feed post and a story, built from what there is; a week that had one is not forced.
const TRI = {
  ...FIX,
  events: [
    ev({ id: "t1", brand: "Austin Whisk", handle: "austinwhisk", start: "2026-12-01T10:00:00-06:00", end: "2026-12-01T14:00:00-06:00", venue: "South Market", city: "Austin", state: "TX", tz: "America/Chicago" }),
    ev({ id: "t2", brand: "Lone Star Latte", handle: "lonestarlatte", start: "2026-12-01T09:00:00-06:00", end: "2026-12-01T12:00:00-06:00", venue: "East Hall", city: "Austin", state: "TX", tz: "America/Chicago" }),
    ev({ id: "t3", brand: "Hill Country Tea", handle: "hillcountrytea", start: "2026-12-01T11:00:00-06:00", end: "2026-12-01T13:00:00-06:00", venue: "North Yard", city: "Austin", state: "TX", tz: "America/Chicago" }),
    ev({ id: "t4", brand: "Dallas Dango", handle: "dallasdango", start: "2026-12-01T11:00:00-06:00", end: "2026-12-01T13:00:00-06:00", venue: "West Lot", city: "Dallas", state: "TX", tz: "America/Chicago" }),
    ev({ id: "t5", brand: "Saiko Matcha House", handle: "saikomatcha", start: "2026-12-09T10:00:00-05:00", end: "2026-12-09T14:00:00-05:00", venue: "Village District", city: "Raleigh", state: "NC" }),
  ],
  shops: [{ id: "x1", name: "Barton Springs Tea", city: "Austin", state: "TX", address: "2 Lamar Blvd", instagram: "bartontea", verified: true, tier: "shop", read: "2026-11-29", menu_matcha: [{ name: "Matcha Latte" }, { name: "Usucha" }, { name: "Koicha" }] }],
  cities: [city("Austin", "TX", 30.27, -97.74), city("Dallas", "TX", 32.78, -96.8), city("Raleigh", "NC", 35.78, -78.64)],
};
test("plan: a week with nothing from the Triangle gets one of its own, as the second feed post and a story", () => {
  assert.equal(regionOf("Chapel Hill", "NC"), "triangle");
  assert.equal(regionOf("Charlotte", "NC"), null);
  assert.equal(regionOf("Raleigh", "WV"), null);
  const p = plan({ date: "2026-12-01", data: TRI, history: {} });
  const feed = p.items.filter((i) => i.slot === "feed"), story = p.items.filter((i) => i.slot === "story");
  assert.ok(feed.length <= 2 && feed.every((i) => ["featured-shop", "featured-popup", "weekend", "city"].includes(i.kind)), "feed posts are featured pieces only");
  const own = story.find((i) => i.region === "triangle" && i.role !== "title");
  assert.equal(own.kind, "soon", "nothing today or this weekend and no shop there: the next pop-up within two weeks, as a story");
  assert.match(own.title, /^Coming up in Raleigh$/);
  assert.match(own.caption, /Saiko Matcha House \(@saikomatcha\) is popping up at Village District in Raleigh, NC, Wednesday/);
  assert.ok(story.length >= 2 && story.length <= 6);
  assert.deepEqual(p.featured.regions, { triangle: { feed: 0, story: 1 } });
  const h = recordHistory({}, p);
  assert.deepEqual(h["2026-12-01"].regions, { triangle: { feed: 0, story: 1 } });
  // the week had one: nothing forced (the only Triangle content is the same brand, blocked for 7 days anyway)
  const q = plan({ date: "2026-12-02", data: TRI, history: h });
  assert.ok(!q.items.some((i) => i.region === "triangle"));
  // the same date and history give the same plan
  assert.deepEqual(plan({ date: "2026-12-01", data: TRI, history: {} }), p);
});

test("plan: the feed is featured pieces only, 1 to 2 a day, never the same shop within 60 days, the metro rotates", () => {
  let history = {};
  const seen = new Set();
  let lastMetro = null;
  for (const date of days("2026-11-24", 30)) {
    const p = plan({ date, data: DATA, history });
    const feed = p.items.filter((i) => i.slot === "feed"), story = p.items.filter((i) => i.slot === "story");
    assert.ok(feed.length >= 1 && feed.length <= 2, `${date}: ${feed.length} feed posts`);
    assert.ok(feed.every((i) => i.why && ["featured shop", "featured pop-up", "weekend roundup", "city feature"].includes(i.why)), date);
    assert.ok(story.length <= 6 && story.every((i) => !["featured-shop", "weekend", "city"].includes(i.kind)), date);
    const fs1 = feed.find((i) => i.kind === "featured-shop");
    if (fs1) {
      assert.ok(fs1.shop.pour.items.length >= 3 && fs1.shop.pour.items.length <= 5, "3 to 5 drinks drawn");
      assert.ok(!seen.has(fs1.shopId), `${date}: ${fs1.title} featured again`); seen.add(fs1.shopId);
      assert.notEqual(fs1.metro, lastMetro, `${date}: the same metro two days running`); lastMetro = fs1.metro;
    }
    history = recordHistory(history, p);
  }
});

test("render: feed 1080x1350 and story 1080x1920 PNGs, text at least 36px, nothing cut or overlapping", { skip: !hasChrome && "no Chrome" }, async () => {
  const p = plan({ date: "2026-12-01", data: FIX });
  const pick = [p.items.find((i) => i.slot === "feed" && i.events.length > 1) || p.items.find((i) => i.slot === "feed"), p.items.find((i) => i.kind === "shop"), p.items.find((i) => i.slot === "story")].filter(Boolean);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-test-"));
  try {
    const res = await renderPages(pick.map((it) => ({ html: itemHtml(it), out: path.join(dir, it.name + ".png"), size: it.slot })));
    assert.equal(res.length, pick.length);
    res.forEach((r, i) => {
      assert.ok(r.ok && fs.existsSync(r.out), r.out);
      assert.deepEqual(pngSize(fs.readFileSync(r.out)), pick[i].slot === "story" ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 });
      assert.ok(r.check.min >= MIN_TEXT_PX - 0.5, `${pick[i].name}: smallest text ${r.check.min}px`);
      assert.deepEqual([r.check.small, r.check.off, r.check.cut, r.check.overlap], [[], [], [], []], pick[i].name);
    });
    assert.ok(!/instagram|cdninstagram|fbcdn/i.test(itemHtml(pick[0]).replace(/@[a-z0-9._]+/gi, "")), "no Instagram image in a post");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function outboxRoot(date) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "social-pub-"));
  const p = plan({ date: "2026-12-01", data: FIX });
  for (const it of p.items) it.image_url = `https://matchamap.app/social/${date}/${it.name}.png`;
  const dir = path.join(root, "tools", "brand", "outbox", date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(p));
  return { root, dir, p };
}

test("publish: dry run is the default and makes no network call", async () => {
  assert.equal(modeOf(parseArgs([]), {}), "dry");
  assert.equal(modeOf(parseArgs(["--live", "--dry-run"]), { SOCIAL_PUBLISH: "1" }), "dry");
  assert.equal(modeOf(parseArgs([]), { SOCIAL_PUBLISH: "1" }), "live");
  const { root, dir, p } = outboxRoot("2026-12-01");
  try {
    let calls = 0;
    const lines = [];
    const out = await publish({ date: "2026-12-01", mode: "dry", env: { IG_ACCESS_TOKEN: "secret-token", IG_USER_ID: "1784" }, fetchImpl: () => { calls++; throw new Error("network"); }, root, log: (s) => lines.push(s) });
    assert.equal(calls, 0);
    assert.equal(out.length, p.items.length);
    assert.ok(!lines.join("\n").includes("secret-token"), "the token is never printed");
    assert.ok(lines.join("\n").includes("/media_publish"));
    assert.ok(lines.join("\n").includes("media_type=STORIES"));
    assert.ok(!fs.existsSync(path.join(dir, "published.json")));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("publish: a live run refuses without SOCIAL_PUBLISH=1, the token, the account id and a pick", async () => {
  assert.match(refusal("live", { IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }, ["01"]), /SOCIAL_PUBLISH/);
  assert.match(refusal("live", { SOCIAL_PUBLISH: "1", IG_USER_ID: "1" }, ["01"]), /IG_ACCESS_TOKEN/);
  assert.match(refusal("live", { SOCIAL_PUBLISH: "1", IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }, null), /--pick/);
  assert.equal(refusal("dry", {}, null), null);
  const { root } = outboxRoot("2026-12-01");
  try {
    let calls = 0;
    await assert.rejects(publish({ date: "2026-12-01", picks: ["01"], mode: "live", env: { IG_ACCESS_TOKEN: "t", IG_USER_ID: "1" }, fetchImpl: () => { calls++; }, root, log: () => {} }), /SOCIAL_PUBLISH/);
    assert.equal(calls, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("publish: live with a fake Graph API posts only the pick, with user tags, logs it, and never twice", async () => {
  const { root, dir, p } = outboxRoot("2026-12-01");
  const feed = p.items.find((i) => i.slot === "feed" && i.user_tags.length);
  const story = p.items.find((i) => i.slot === "story");
  const calls = [];
  const fake = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || "GET", body: opt.body ? Object.fromEntries(new URLSearchParams(opt.body)) : null });
    const j = opt.method === "HEAD" ? {} : url.includes("/media_publish") ? { id: "M" + calls.length } : url.endsWith("/media") ? { id: "C" + calls.length } : url.includes("fields=status_code") ? { status_code: "FINISHED" } : { permalink: "https://www.instagram.com/p/x/" };
    return { ok: true, status: 200, json: async () => j };
  };
  const env = { SOCIAL_PUBLISH: "1", IG_ACCESS_TOKEN: "tok", IG_USER_ID: "17841409304705072" };
  try {
    await publish({ date: "2026-12-01", picks: [feed.n, story.n], mode: "live", env, fetchImpl: fake, root, log: () => {}, wait: async () => {} });
    const creates = calls.filter((c) => c.method === "POST" && c.url.endsWith("/17841409304705072/media"));
    assert.equal(creates.length, 2);
    const fc = creates.find((c) => c.body.caption);
    assert.equal(fc.body.image_url, feed.image_url);
    assert.deepEqual(JSON.parse(fc.body.user_tags), feed.user_tags);
    assert.equal(creates.find((c) => !c.body.caption).body.media_type, "STORIES");
    assert.equal(calls.filter((c) => c.url.endsWith("/media_publish")).length, 2);
    assert.ok(calls.every((c) => !c.url.includes("tok") || c.method === "GET"), "the token goes in the body of a POST");
    const log = JSON.parse(fs.readFileSync(path.join(dir, "published.json"), "utf8"));
    assert.deepEqual(log.map((r) => r.name).sort(), [feed.name, story.name].sort());
    const before = calls.length;
    await publish({ date: "2026-12-01", picks: [feed.n], mode: "live", env, fetchImpl: fake, root, log: () => {}, wait: async () => {} });
    assert.equal(calls.length, before, "an item already published is skipped");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("outbox: the public index at /social/<date>/ addresses every asset from the root and stays out of search", async () => {
  const { socialIndexHtml } = await import("../tools/social/outbox.js");
  const html = socialIndexHtml("2026-12-01", [{ name: "01-feed-today-durham", title: "Today in <Durham>", time: "10:00", slot: "feed" }, { name: "02-story-shop-x", title: "X", time: "08:30", slot: "story" }]);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /src="\/social\/2026-12-01\/01-feed-today-durham\.png" alt="Today in &lt;Durham&gt;"/);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(/^(\/|https:\/\/)/.test(m[1]), "root or https: " + m[1]);
  assert.equal((html.match(/<figure/g) || []).length, 2);
});
