// Attach a storefront's public menu (data/menus.json, written by `npm run menus`) to shop rows by the host of their website.
export const hostOf = (url) => {
  try { return new URL(/^https?:/i.test(url) ? url : "https://" + url).host.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};

// Returns the shops with `menu` set (or removed) from `menus` ({host: {items, source_url, read, kind, note?}}). A shop with no match has no menu field.
export function attachMenus(shops, menus) {
  return shops.map((s) => {
    const { menu: _old, ...rest } = s;
    const m = s.website ? menus[hostOf(s.website)] : null;
    if (!m || !Array.isArray(m.items) || !m.items.length) return rest;
    return { ...rest, menu: { items: m.items, source_url: m.source_url, read: m.read, kind: m.kind || "html", ...(m.note ? { note: m.note } : {}) } };
  });
}
