import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// A small JSON Schema checker (enough for data/schema/event.schema.json): type, enum, required,
// additionalProperties, anyOf, pattern, minimum, maximum, maxLength, maxItems, items, $ref.
function check(schema, v, root, at, errs) {
  if (schema.$ref) return check(root.$defs[schema.$ref.split("/").pop()], v, root, at, errs);
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => { const e = []; check(s, v, root, at, e); return !e.length; });
    if (!ok) errs.push(`${at}: matches none of anyOf`);
    return;
  }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${at}: not in enum`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) { errs.push(`${at}: type ${t}, wanted ${types}`); return; }
  }
  if (typeof v === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${at}: pattern`);
    if (schema.maxLength && v.length > schema.maxLength) errs.push(`${at}: too long`);
  }
  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) errs.push(`${at}: below minimum`);
    if (schema.maximum !== undefined && v > schema.maximum) errs.push(`${at}: above maximum`);
  }
  if (Array.isArray(v)) {
    if (schema.maxItems && v.length > schema.maxItems) errs.push(`${at}: too many items`);
    if (schema.items) v.forEach((x, i) => check(schema.items, x, root, `${at}[${i}]`, errs));
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${at}: missing ${k}`);
    for (const [k, x] of Object.entries(v)) {
      if (schema.properties?.[k]) check(schema.properties[k], x, root, `${at}.${k}`, errs);
      else if (schema.additionalProperties === false) errs.push(`${at}: extra key ${k}`);
    }
  }
}

test("data/events.json validates against event.schema.json, every key required", () => {
  const schema = JSON.parse(fs.readFileSync("data/schema/event.schema.json", "utf8"));
  const data = JSON.parse(fs.readFileSync("data/events.json", "utf8"));
  const errs = [];
  check(schema, data, schema, "$", errs);
  assert.deepEqual(errs.slice(0, 5), []);
  const site = JSON.parse(fs.readFileSync("site/data/events.json", "utf8"));
  assert.equal(site.events.length, data.events.length);
});
test("the checker rejects a bad image and a long menu item", () => {
  const schema = JSON.parse(fs.readFileSync("data/schema/event.schema.json", "utf8"));
  const e = JSON.parse(fs.readFileSync("data/events.json", "utf8")).events[0];
  const bad = { generated: "2026-11-22T00:00:00Z", events: [{ ...e, image: { url: "x" }, menu: ["a".repeat(41)] }] };
  const errs = []; check(schema, bad, schema, "$", errs);
  assert.ok(errs.length >= 2);
});
