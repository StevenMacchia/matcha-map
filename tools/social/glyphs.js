// The matcha-type glyphs, drawn in the mascot's hand: 64x64 viewBox, azuki 2-unit outline, round joins, cream and pastel fills
// (site/characters.svg uses the same stroke and fills). glyphSvg(id) returns an <svg> string for the daily graphics; each
// glyph is one of the ids in data/drink-types.json. Drawn art only: nothing here is traced from a photo or a logo.
const INK = "#4B3426", CREAM = "#FFFBF0", FOAM = "#DCEBC9", MATCHA = "#BFDDA9", PINK = "#F6B7C7", HOJI = "#C9996B", ICE = "#E3F2F4", CONE = "#F8C9A2";
const o = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
const P = (d, fill = "none") => `<path ${o} fill="${fill}" d="${d}"/>`;
const E = (cx, cy, rx, ry, fill) => `<ellipse ${o} fill="${fill}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
const eyes = (x, y) => `<circle cx="${x - 5}" cy="${y}" r="1.6" fill="${INK}"/><circle cx="${x + 5}" cy="${y}" r="1.6" fill="${INK}"/>`;
const cheeks = (x, y) => `<ellipse cx="${x - 8}" cy="${y + 3}" rx="2.6" ry="1.7" fill="#F6A3B8" opacity=".8"/><ellipse cx="${x + 8}" cy="${y + 3}" rx="2.6" ry="1.7" fill="#F6A3B8" opacity=".8"/>`;
const straw = (x1, y1, x2, y2) => `<path ${o} fill="none" stroke-width="2.4" d="M${x1} ${y1}L${x2} ${y2}"/>`;
const cube = (x, y, r) => `<rect ${o} fill="${CREAM}" x="${x}" y="${y}" width="9" height="9" rx="2.2" transform="rotate(${r} ${x + 4.5} ${y + 4.5})"/>`;
const strawberry = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${P("M0 2c-6 0-9 5-7 10 1.6 4 5 7 7 8 2-1 5.4-4 7-8 2-5-1-10-7-10z", "#F28FA6")}${P("M-4 2l4 3 4-3-2-4h-4z", MATCHA)}<circle cx="-2.5" cy="9" r=".9" fill="${INK}"/><circle cx="2.5" cy="11" r=".9" fill="${INK}"/><circle cx="0" cy="15" r=".9" fill="${INK}"/></g>`;
const steam = `<path ${o} fill="none" d="M22 6c-3 3 3 5 0 9M32 4c-3 3 3 5 0 9M42 6c-3 3 3 5 0 9"/>`;

const G = {
  // a chawan: wide bowl, whisked green surface
  bowl: () => P("M6 26h52c0 17-9 29-26 29S6 43 6 26z", CREAM) + P("M24 55h16v4H24z", CREAM) + E(32, 26, 26, 7, MATCHA) + `<path ${o} fill="none" d="M20 26q4-3 8 0m8 0q4-3 8 0"/>` + eyes(32, 41) + cheeks(32, 41),
  // matcha latte in a mug with a handle, green over milk
  latte: () => P("M45 24h4a7 7 0 0 1 0 15h-5") + P("M13 16h33v24a13 13 0 0 1-13 13h-7A13 13 0 0 1 13 40z", CREAM) + `<path ${o} fill="${MATCHA}" d="M13 16h33v10c-8 5-24 5-33 0z"/>` + E(29.5, 16, 16.5, 4, FOAM) + eyes(29.5, 38) + cheeks(29.5, 38),
  // a tall glass of iced matcha with ice and a straw
  iced: () => straw(38, 3, 33, 28) + P("M14 10h36l-4.5 46h-27z", ICE) + `<path ${o} fill="${MATCHA}" d="M15.5 26h33l-3 30H18.5z"/>` + cube(19, 14, -8) + cube(33, 12, 10) + cube(27, 29, 4),
  // iced, with a strawberry layer and a berry on top
  strawberry: () => straw(42, 3, 37, 22) + P("M14 14h36l-4.5 42h-27z", ICE) + `<path ${o} fill="${PINK}" d="M16.2 38h31.6l-2.3 18h-27z"/>` + `<path ${o} fill="${MATCHA}" d="M15.3 26h33.4l-.9 12H16.2z"/>` + strawberry(23, 1, .85) + cube(34, 17, 8),
  // roasted-brown hojicha in a mug, steam
  hojicha: () => steam + P("M46 28h3a7 7 0 0 1 0 14h-4") + P("M12 25h35v15a13 13 0 0 1-13 13h-9A13 13 0 0 1 12 40z", CREAM) + E(29.5, 25, 17.5, 4.5, HOJI) + eyes(29.5, 40) + cheeks(29.5, 40),
  // a matcha soft-serve cone
  dessert: () => P("M20 35h24L32 60z", CONE) + `<path ${o} fill="none" d="M24 43l8 12M31 38l5 9M38 43l-8 12M26 38l5 9"/>` + P("M15 36c-3 0-5-3-4-6 1-2 3-4 5-4 0-6 5-10 10-10 1-4 3-6 6-6 3 0 5 2 5 5 4 1 7 4 7 8 2 1 4 3 4 5 0 2-2 4-4 4z", FOAM) + `<path ${o} fill="none" d="M18 33q14 4 28 0"/>` + eyes(32, 29) + cheeks(32, 29),
  // plant milk: a carton with a leaf
  plantmilk: () => P("M14 22l8-12h20l8 12z", FOAM) + P("M14 22h36v32a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z", CREAM) + P("M24 49c-1-9 5-15 15-15 0 9-5 15-15 15z", MATCHA) + `<path ${o} fill="none" d="M26 47l9-9"/>`,
  // plain matcha: tea leaves on a whisked-green disc
  matcha: () => E(32, 40, 23, 15, MATCHA) + E(32, 36, 23, 15, FOAM) + P("M15 24c0-9 8-15 20-15 0 11-7 17-20 15z", MATCHA) + `<path ${o} fill="none" d="M18 23l11-9"/>` + P("M33 50c-1-7 3-12 12-12 0 8-4 12-12 12z", MATCHA),
};
export const GLYPH_IDS = Object.keys(G);
export function glyphSvg(id, cls = "gl") {
  const g = G[id] || G.matcha;
  return `<svg class="${cls}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${g()}</svg>`;
}
