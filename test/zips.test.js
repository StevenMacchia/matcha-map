import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { parseZips, readZipEntry } from "../tools/gen-zips.js";

test("parseZips keeps 5-digit zips with 2-decimal centroids", () => {
  const z = parseZips("US\t27601\tRaleigh\tNorth Carolina\tNC\tWake\t183\t\t\t35.7721\t-78.6386\t4\nUS\tbad\tX\t\t\t\t\t\t\t1\t2\t4\n");
  assert.deepEqual(z, { "27601": [35.77, -78.64] });
});
test("readZipEntry reads a stored and a deflated entry", () => {
  const mk = (name, data, method) => {
    const raw = method === 8 ? zlib.deflateRawSync(data) : data, n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const local = Buffer.concat([lh, n, raw]);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28);
    return { local, central: Buffer.concat([ch, n]) };
  };
  const a = mk("a.txt", Buffer.from("alpha"), 0), b = mk("US.txt", Buffer.from("beta beta beta"), 8);
  b.central.writeUInt32LE(a.local.length, 42);
  const cd = Buffer.concat([a.central, b.central]), eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(2, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(a.local.length + b.local.length, 16);
  const zip = Buffer.concat([a.local, b.local, cd, eo]);
  assert.equal(readZipEntry(zip, "a.txt").toString(), "alpha");
  assert.equal(readZipEntry(zip, "US.txt").toString(), "beta beta beta");
});
test("site/data/zips.json has Raleigh and valid pairs", () => {
  const z = JSON.parse(fs.readFileSync("site/data/zips.json", "utf8"));
  assert.ok(z["27601"]);
  assert.ok(Object.keys(z).length > 40000);
});
