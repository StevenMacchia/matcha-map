// Ingest hook for the drink illustrator: after events.json is written, draw art for any new drink on a menu
// and any event without a downloaded photo (tools/illustrate/run.js, the same renderer as `npm run art`).
// Never fails the ingest: any error becomes a warning and null.
import { warn } from "./log.js";

export async function renderMissingArt({ events, sources, root } = {}) {
  try {
    const { renderAll, summary } = await import("../../tools/illustrate/run.js");
    const o = await renderAll({ events, sources, root });
    return { ...o, line: summary(o.counts) };
  } catch (e) {
    warn(`art not rendered: ${e.message}`);
    return null;
  }
}
