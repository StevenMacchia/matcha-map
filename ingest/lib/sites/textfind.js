// Shared by the text-reading sites (feeds, bluesky, embed captions): is this text a matcha pop-up announcement
// with a date in the future and a US place? Pure functions; the extractor does the reading.
import { extract } from "../extract.js";
import { STATES } from "../tz.js";
import { hasMatcha } from "../../adapters/mato.js";

export const POPUP_WORD = /\bpop[\s-]?ups?\b|\bpopups?\b|\bmatcha cart\b|\btakeover\b|\bcollab(?:oration)?\b|\bmatcha (?:bar|market|party|social|tasting|class|workshop|fair)\b|\bone[\s-]day only\b|\bresidency\b|\bhosts?\b|\bdebuts?\b|\bsells? out\b/i;

export const matchaPopup = (...parts) => {
  const t = parts.filter(Boolean).join(" | ");
  return hasMatcha(t) && POPUP_WORD.test(t);
};

// The best usable reading of a RawItem: a future (or today) dated candidate with a US city and state. -> candidate|null
export function usable(raw, source, now = new Date()) {
  const cands = extract(raw, { source, now });
  const day = 86400000;
  return cands.find((c) => c.city && c.state && STATES.includes(c.state) && Date.parse(c.start) >= now.getTime() - day) || null;
}

// Pseudo-sources are pop-up brands unless the title says class, workshop, meetup, tasting, 101 or club (the same rule as write.js matoKind).
const ORGANIZER = /\b(class(es)?|workshop|meet-?up|tasting|101|club)\b/i;
export function tagKinds(items) {
  for (const raw of items) if (raw.source_hint) { raw.source_hint.kind = ORGANIZER.test(raw.hints?.title || raw.text || "") ? "organizer" : "popup"; raw.source_hint.category = "matcha"; }
  return items;
}
