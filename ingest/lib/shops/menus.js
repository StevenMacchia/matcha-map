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

// Fields read from a shop's own site by `npm run shops:deepen` (data/shops-extra.json, by shop id): only fields the row lacks are filled.
export function attachExtras(shops, extra = {}) {
  return shops.map((s) => {
    const e = extra[s.id];
    if (!e) return s;
    const o = { ...s };
    for (const k of ["website", "opening_hours", "phone", "instagram", "image_url", "menu_url"]) if (!o[k] && e[k]) o[k] = e[k];
    if (e.image_url && o.image_url === e.image_url) { o.image_credit = o.image_credit || e.image_credit; o.source_url = o.source_url || e.source_url; o.read = o.read || e.read; }
    return o;
  });
}
