// Writes site/data/zips.json: {"27601":[35.78,-78.64], ...} for every US 5-digit zip, 2-decimal centroids, keys sorted.
// Source: GeoNames postal codes, https://download.geonames.org/export/zip/US.zip, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
// There is no plain US.txt on the server, so this reads the zip with a minimal stored/deflate entry reader (node:zlib has none).
// JSON has no comments, so the attribution and date live under the key "_" as a string; the site ignores it.
// Run: node tools/gen-zips.js
import fs from "node:fs";
import zlib from "node:zlib";

const URL_ZIP = "https://download.geonames.org/export/zip/US.zip";

// Finds one entry by name through the central directory and returns its bytes.
export function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), fname = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (fname === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error("unsupported zip method " + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(name + " not in zip");
}

// GeoNames rows: country, postal code, place, admin1 name, admin1 code, ..., lat, lng, accuracy (tab separated).
export function parseZips(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 11 || !/^\d{5}$/.test(f[1])) continue;
    const lat = parseFloat(f[9]), lng = parseFloat(f[10]);
    if (isNaN(lat) || isNaN(lng)) continue;
    out[f[1]] = [+lat.toFixed(2), +lng.toFixed(2)];
  }
  return out;
}

async function main() {
  const res = await fetch(URL_ZIP);
  if (!res.ok) throw new Error("download failed: " + res.status);
  const text = readZipEntry(Buffer.from(await res.arrayBuffer()), "US.txt").toString("utf8");
  const zips = parseZips(text);
  const keys = Object.keys(zips).sort();
  const date = new Date().toISOString().slice(0, 10);
  const body = "{\n\"_\":" + JSON.stringify("Zip centroids: GeoNames postal codes, CC BY 4.0, https://www.geonames.org. Generated " + date + " by tools/gen-zips.js.") +
    ",\n" + keys.map((k) => JSON.stringify(k) + ":" + JSON.stringify(zips[k])).join(",\n") + "\n}\n";
  fs.mkdirSync("site/data", { recursive: true });
  fs.writeFileSync("site/data/zips.json", body);
  console.log(keys.length + " zips, " + Buffer.byteLength(body) + " bytes, " + zlib.gzipSync(body).length + " gzipped");
}
if (import.meta.url === new URL(process.argv[1], "file:///").href || process.argv[1]?.endsWith("gen-zips.js")) main();
