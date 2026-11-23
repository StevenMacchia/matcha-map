// Display names. An Instagram handle is not a brand name: "bujimatcha" reads as "Buji Matcha", "mrs.stript" as "Mrs Stript".
// Shared by the watcher (account names), the hashtag harvest (brands found in captions) and tools/flyers.js.

// Words a handle often glues onto the brand ("bujimatcha"); split off when they end (or start) a longer handle.
const GLUED = ["matcha", "cafe", "coffee", "tea", "teas", "bar", "co", "club", "shop", "studio", "kitchen", "bakery", "popup", "cart", "collective"];

export const cleanHandle = (h) => String(h || "").replace(/^@/, "").trim();

// True when a string is a handle rather than a written name: no spaces, and only handle characters.
export const isHandleShaped = (s) => /^[A-Za-z0-9._]{2,30}$/.test(String(s || "").trim()) && !/\s/.test(String(s || ""));

// A handle -> "Title Case Words". Dots, underscores and digit runs break words; a glued suffix such as matcha or cafe is split off.
export function prettyHandle(handle) {
  let h = cleanHandle(handle).toLowerCase();
  if (!h) return "";
  h = h.replace(/[._]+/g, " ").replace(/(\d+)/g, " $1 ").replace(/\s+/g, " ").trim();
  const words = h.split(" ").flatMap((w) => {
    for (const g of GLUED) if (w.length > g.length + 2 && w.endsWith(g)) return [w.slice(0, -g.length), g];
    return [w];
  });
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// The name to show for a brand: a written name as it is, a handle-shaped one prettified.
export const displayName = (name) => (isHandleShaped(name) && !/[A-Z].*[a-z]|\d/.test(name) ? prettyHandle(name) : String(name || "").trim());

// brand, then auto_name (the account's own name from the Graph API), then the handle made readable.
export function brandOf(o = {}) {
  const brand = String(o.brand || "").trim();
  const handle = cleanHandle(o.handle || o.instagram);
  const handleLike = !brand || brand.toLowerCase() === handle.toLowerCase();
  if (!handleLike) return brand;
  return String(o.auto_name || "").trim() || prettyHandle(brand || handle);
}

// A venue that is really a handle, or a placeholder such as "Cafe of the day", is not a place.
export const PLACEHOLDER_VENUE = /^(cafe|restaurant|bar|spot|shop) of the (day|week|month)$/i;
export function placeOf(e) {
  const v = String(e.venue || "").trim();
  const bad = !v || PLACEHOLDER_VENUE.test(v) || v.startsWith("@") || (isHandleShaped(v) && /[._]/.test(v)) || v.toLowerCase() === cleanHandle(e.handle).toLowerCase();
  return bad ? [e.city, e.state].filter(Boolean).join(", ") : v;
}
