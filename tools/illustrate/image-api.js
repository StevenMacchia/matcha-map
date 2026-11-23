// Optional image-API adapter for the drink illustrator. Off by default and forever optional: the SVG drawn
// by drink.js stays the default because it is free, offline and always on-model. When OPENAI_API_KEY or
// STABILITY_API_KEY is set AND `npm run art -- --image-api` is run, this draws a PNG for a drink from its spec,
// saved beside the SVG (site/art/drinks/<slug>.png) and recorded in site/art/index.json. Never called by tests
// or by the ingest loop. At most MAX_PER_RUN images a run (env IMAGE_API_MAX overrides).
//   OpenAI:    https://platform.openai.com/api-keys, model gpt-image-1, 1024x1024, quality "low" (about $0.01 to
//              $0.02 an image; "medium" about $0.04). Pricing: https://openai.com/api/pricing
//   Stability: https://platform.stability.ai/account/keys, Stable Image Core (3 credits, about $0.03 an image).
//              Pricing: https://platform.stability.ai/pricing
export const MAX_PER_RUN = 5;
export const STYLE = "Cute flat cartoon sticker illustration of a single drink, thick dark brown rounded outlines, " +
  "soft pastel matcha cafe palette (cream, matcha green, sakura pink), simple shading, slight tilt, centred on a plain cream background, " +
  "no text, no letters, no logo, no people.";

export function imageProvider(env = process.env) {
  if (env.OPENAI_API_KEY) return { name: "openai", key: env.OPENAI_API_KEY };
  if (env.STABILITY_API_KEY) return { name: "stability", key: env.STABILITY_API_KEY };
  return null;
}

const VESSEL = { tall: "a tall clear glass", short: "a short clear glass", cup: "a paper to-go cup with a lid", mug: "a ceramic mug",
  bowl: "a matcha bowl (chawan) with frothy whisked matcha", bottle: "a small glass bottle", can: "a drink can", cone: "a waffle cone",
  scoop: "a small paper dessert cup", coupe: "a short glass", plate: "a small dessert plate", kakigori: "a footed glass bowl" };

// A prompt from the spec: what is in it, bottom to top, and what is on it. Text only, no network.
export function buildPrompt(spec) {
  const parts = [`${spec.label || spec.name}: ${VESSEL[spec.vessel] || "a glass"}`];
  if (spec.kind === "drink") {
    parts.push(`${spec.temp} drink`);
    if (spec.layers && spec.layers.length) parts.push(`${spec.blend === "layered" ? "distinct layers" : "softly blended"}, bottom to top: ${spec.layers.map((l) => `${l.n} (${l.c})`).join(", ")}`);
    if (spec.ice) parts.push(`${spec.ice} ice cubes`);
    if (spec.top) parts.push(`${spec.top.type} on top`);
    if (spec.straw) parts.push(`a ${spec.straw.c} striped straw`);
  } else parts.push(`${spec.item}, colours ${spec.colors.join(", ")}`);
  if (spec.toppings && spec.toppings.length) parts.push(`toppings: ${spec.toppings.join(", ")}`);
  if (spec.garnish && spec.garnish.length) parts.push(`garnish: ${spec.garnish.map((g) => g.type).join(", ")}`);
  return `${STYLE} ${parts.join("; ")}.`;
}

// -> Buffer (PNG). Throws on any failure; the caller keeps the SVG.
export async function renderImage(spec, { env = process.env, fetchFn = globalThis.fetch } = {}) {
  const prov = imageProvider(env);
  if (!prov) throw new Error("no image API key set");
  const prompt = buildPrompt(spec), signal = AbortSignal.timeout(90000);
  if (prov.name === "openai") {
    const r = await fetchFn("https://api.openai.com/v1/images/generations", {
      method: "POST", signal, headers: { authorization: `Bearer ${prov.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality: "low", n: 1 }),
    });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    const j = await r.json(), b64 = j && j.data && j.data[0] && j.data[0].b64_json;
    if (!b64) throw new Error("openai: no image in the reply");
    return Buffer.from(b64, "base64");
  }
  const form = new FormData();
  form.append("prompt", prompt); form.append("output_format", "png"); form.append("aspect_ratio", "1:1");
  form.append("negative_prompt", "text, letters, watermark, photo, realistic, people");
  const r = await fetchFn("https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST", signal, headers: { authorization: `Bearer ${prov.key}`, accept: "image/*" }, body: form,
  });
  if (!r.ok) throw new Error(`stability ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
