// tools/social/styles.js: ten visual styles for the daily cards, applied as themes over the layouts in render.js.
// A style is a named token set: CSS variables (ground colour and pattern, panel and tile fills, border weight, corner radius,
// type face and weight, badge shape), a little extra CSS, an optional Mattie pose swap, and decorations drawn in code (SVG
// shapes only: no photo, no logo, no words). The layout, the copy and the 36px floor never change with the style; the gate
// (test/social-gate.test.js) renders every template in every style. Pick one with `--style <name>` or a `style` field on a plan item.
// Decorations stay in the 60px margins and the free bands above and below the content; under the text, never over it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STYLE_CONFIG = path.join(ROOT, "data", "social-styles.json");

const mul = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const uri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const f = (n) => Math.round(n * 10) / 10;

// ---- shapes (all drawn from paths; sizes in px) ----
const at = (x, y, s, rot, inner) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(s / 20)}) translate(-10 -10)">${inner}</g>`;
const heart = (x, y, s, c, r = 0) => at(x, y, s, r, `<path d="M10 18C-3 9 1 0 6 1.5 8.5 2.2 10 4.5 10 5.5 10 4.5 11.5 2.2 14 1.5 19 0 23 9 10 18Z" fill="${c}"/>`);
const star4 = (x, y, s, c, r = 0) => at(x, y, s, r, `<path d="M10 0C11 6 14 9 20 10 14 11 11 14 10 20 9 14 6 11 0 10 6 9 9 6 10 0Z" fill="${c}"/>`);
const star5 = (x, y, s, c, r = 0, line) => at(x, y, s, r, `<path d="M10 0.5l2.9 6.4 6.9.7-5.2 4.6 1.5 6.8L10 15.5 3.9 19l1.5-6.8L.2 7.6l6.9-.7Z" fill="${c}"${line ? ` stroke="${line}" stroke-width="1.2" stroke-linejoin="round"` : ""}/>`);
const dot = (x, y, s, c) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s / 2)}" fill="${c}"/>`;
const ring = (x, y, s, c, w = 3) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s / 2)}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
const leaf = (x, y, s, c, r = 0, vein) => at(x, y, s, r, `<path d="M0 10C6 0 16 0 20 10 16 20 6 20 0 10Z" fill="${c}"/>${vein ? `<path d="M2 10H17" stroke="${vein}" stroke-width="1.1" fill="none"/>` : ""}`);
const flake = (x, y, s, c, w = 2.4, r = 0) => at(x, y, s, r, [0, 60, 120].map((a) => `<g transform="rotate(${a} 10 10)"><path d="M10 0V20M7 3L10 6 13 3M7 17L10 14 13 17" stroke="${c}" stroke-width="${w * 20 / s * 0.5 + 0.6}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`).join(""));
const piece = (x, y, s, c, r, k) => k === 0 ? `<rect x="${f(x - s / 2)}" y="${f(y - s / 4)}" width="${f(s)}" height="${f(s / 2)}" rx="3" fill="${c}" transform="rotate(${f(r)} ${f(x)} ${f(y)})"/>`
  : k === 1 ? dot(x, y, s * 0.7, c)
  : k === 2 ? at(x, y, s, r, `<path d="M10 1L19 18H1Z" fill="${c}" stroke-linejoin="round"/>`)
  : `<path d="M${f(x - s / 2)} ${f(y)}q${f(s / 4)} ${f(-s / 3)} ${f(s / 2)} 0t${f(s / 2)} 0" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" transform="rotate(${f(r)} ${f(x)} ${f(y)})"/>`;

// positions around the 60px margins of a W x H canvas, and in the free bands (stories only) above and below the content
function around(r, W, H, n, pad, draw) {
  const P = 2 * (W + H), out = [];
  for (let i = 0; i < n; i++) {
    let p = ((i + 0.15 + r() * 0.7) / n) * P, x, y;
    if (p < W) { x = p; y = pad; } else if ((p -= W) < H) { x = W - pad; y = p; } else if ((p -= H) < W) { x = W - p; y = H - pad; } else { p -= W; x = pad; y = H - p; }
    out.push(draw(x + (r() - 0.5) * 6, y + (r() - 0.5) * 6, i));
  }
  return out.join("");
}
function bands(r, c, n, draw) {     // stories keep 232px at the top and 244px at the bottom clear of text: room for larger pieces
  if (!c.story) return "";
  let o = "";
  for (let i = 0; i < n; i++) {
    const top = i % 2 === 0, y = top ? 30 + r() * 170 : c.H - 200 + r() * 170, x = 70 + ((i + r() * 0.8) / n) * (c.W - 140);
    o += draw(x, y, i, top);
  }
  return o;
}
const svg = (c, inner, defs = "") => `<svg class="deco" width="${c.W}" height="${c.H}" viewBox="0 0 ${c.W} ${c.H}" xmlns="http://www.w3.org/2000/svg">${defs ? `<defs>${defs}</defs>` : ""}${inner}</svg>`;
const pick = (r, a) => a[Math.floor(r() * a.length)];

// ---- the ten styles ----
const NEON_GLOW = '<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
const kaw = ["#FF9CC2", "#FFD0E2", "#FFF08A", "#C9B8FF", "#B8E6FF"];
const party = ["#FF6FAE", "#35C9B6", "#FFB703", "#8E7CFF", "#FF7B54", "#3FA7FF"];
const checker = (c, y, h, a, b) => { let o = ""; const s = h / 2; for (let row = 0; row < 2; row++) for (let i = 0; i * s < c.W; i++) o += `<rect x="${i * s}" y="${y + row * s}" width="${s}" height="${s}" fill="${(i + row) % 2 ? a : b}"/>`; return o; };

export const STYLES = {
  pastel: { word: "soft", note: "the original: cream, matcha green, blush petals", vars: {}, css: "", fonts: "", pose: {}, deco: () => "" },

  kawaii: { word: "sticker", note: "kawaii sticker sheet: pink polka ground, die-cut white edges, stitched tiles, hearts and stars",
    vars: { "--low": "#FFE6F0", "--az": "#5A3248", "--az2": "#8A5A74", "--cream": "#FFFFFF", "--top": "#FFD3E4", "--strong": "#FFB5D2", "--edge": "#FF9CC2", "--sun": "#FFF08A",
      "--canvas": `#FFE6F0 ${uri('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><circle cx="18" cy="18" r="6.5" fill="#fff" fill-opacity=".75"/><circle cx="54" cy="54" r="6.5" fill="#fff" fill-opacity=".75"/><circle cx="54" cy="18" r="2.5" fill="#FF9CC2" fill-opacity=".5"/><circle cx="18" cy="54" r="2.5" fill="#FF9CC2" fill-opacity=".5"/></svg>')}`,
      "--tile-edge": "#FF9CC2", "--r-tile": "40px", "--r-row": "38px", "--r-art": "44px", "--r-mochi": "30px",
      "--tile-shadow": "0 0 0 7px #fff, 0 12px 14px 6px rgba(214,100,150,.28)", "--pill-shadow": "0 0 0 5px #fff, 0 9px 10px 4px rgba(214,100,150,.25)",
      "--row-shadow": "0 0 0 6px #fff, 0 12px 14px 6px rgba(214,100,150,.28)", "--line": "#FF9CC2", "--wm-line": "#FF9CC2", "--wm-shadow": "0 0 0 6px #fff, 0 10px 12px 4px rgba(214,100,150,.28)",
      "--tag-bg": "#FFF08A", "--tag-line": "#FF9CC2", "--tag-rot": "-3deg", "--tag-shadow": "0 0 0 6px #fff, 0 10px 12px 4px rgba(214,100,150,.3)",
      "--head-stroke": "14px", "--head-shadow": "0 6px 0 rgba(255,156,194,.7)", "--head-ink": "#5A3248", "--foot-ink": "#8A5A74",
      "--dots-ink": "rgba(255,156,194,.8)", "--dots-style": "dashed", "--mt-filter": "drop-shadow(0 0 0 #fff) drop-shadow(0 4px 0 rgba(255,255,255,.9))" },
    css: ".st-kawaii .tile{border-style:dashed;border-width:5px}.st-kawaii .pr,.st-kawaii .pill{border-style:dashed}.st-kawaii .shopart{border-style:solid}",
    fonts: "", pose: { "m-wave": "m-excited" },
    deco: (c) => { const r = mul(c.seed); return svg(c, around(r, c.W, c.H, c.story ? 34 : 26, 30, (x, y, i) => i % 3 === 0 ? heart(x, y, 24 + r() * 10, pick(r, kaw), (r() - 0.5) * 40) : i % 3 === 1 ? star4(x, y, 22 + r() * 12, pick(r, kaw), r() * 30) : dot(x, y, 8 + r() * 8, pick(r, kaw)))
      + bands(r, c, 12, (x, y, i) => i % 3 === 0 ? heart(x, y, 44 + r() * 26, pick(r, kaw), (r() - 0.5) * 40) : i % 3 === 1 ? star4(x, y, 40 + r() * 22, pick(r, kaw), r() * 30) : dot(x, y, 18 + r() * 16, pick(r, kaw)))); } },

  neon: { word: "night", note: "night market neon on dark: indigo ground, pink and cyan tube light, glowing frames, paper lanterns",
    vars: { "--low": "#150E32", "--az": "#FFF4FF", "--az2": "#C9B8FF", "--cream": "#241A55", "--top": "#2B1F66", "--strong": "#3F2E93", "--edge": "#2FE6FF", "--sun": "#FFE94D",
      "--canvas": "radial-gradient(circle at 8% 6%,rgba(255,60,170,.38),transparent 42%),radial-gradient(circle at 94% 96%,rgba(47,230,255,.3),transparent 44%),#150E32",
      "--line": "#FF3CAA", "--panel": "#241A55", "--tile-edge": "#2FE6FF", "--tile-bg": "radial-gradient(circle at 50% 36%,#7561D8 0,#3B2C8C 48%,#211759 100%)",
      "--tile-shadow": "0 0 14px rgba(47,230,255,.65), inset 0 0 14px rgba(47,230,255,.28)", "--pill-shadow": "0 0 12px rgba(47,230,255,.5)", "--row-shadow": "0 0 16px rgba(255,60,170,.6), inset 0 0 12px rgba(255,60,170,.22)",
      "--wm-line": "#2FE6FF", "--wm-shadow": "0 0 14px rgba(47,230,255,.7)", "--tag-bg": "#FFE94D", "--tag-ink": "#24104A", "--tag-line": "#FFE94D", "--tag-shadow": "0 0 20px rgba(255,233,77,.75)", "--tag-rot": "-2deg",
      "--head-shadow": "0 0 4px #FF3CAA, 0 0 14px rgba(255,60,170,.85)", "--foot-ink": "#C9B8FF", "--dots-ink": "#FF3CAA", "--dots-style": "solid", "--dots-bw": "3px", "--dots-shadow": "0 0 14px #FF3CAA, inset 0 0 14px rgba(255,60,170,.45)",
      "--mt-filter": "drop-shadow(0 0 3px #fff) drop-shadow(0 0 12px rgba(47,230,255,.8))" },
    css: ".st-neon .pg svg,.st-neon .mochi svg{filter:drop-shadow(0 0 5px rgba(255,255,255,.55))}.st-neon .shopart{background:#2B1F66}.st-neon .shopart .blob{background:#4A3AA8}",
    fonts: "", pose: { "m-wave": "m-excited" },
    deco: (c) => { const r = mul(c.seed), cols = ["#FF3CAA", "#2FE6FF", "#FFE94D", "#B07BFF"];
      let o = ""; const n = c.story ? 8 : 9;      // lanterns on a sagging string across the top
      for (let i = 0; i < n; i++) { const x = 70 + i * ((c.W - 140) / (n - 1)), sag = 10 * Math.sin((i / (n - 1)) * Math.PI), col = cols[i % 4], ly = 6 + sag, h = c.story ? 56 : 30;
        o += `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${f(ly + 6)}" stroke="${col}" stroke-width="2" opacity=".8"/><rect x="${f(x - h * .42)}" y="${f(ly + 6)}" width="${f(h * .84)}" height="${f(h)}" rx="${f(h * .38)}" fill="${col}" opacity=".9"/><rect x="${f(x - h * .22)}" y="${f(ly + h + 6)}" width="${f(h * .44)}" height="6" rx="3" fill="${col}"/>`; }
      o = `<g filter="url(#gl)">${o}</g>`;
      o += `<g filter="url(#gl)">` + around(r, c.W, c.H, c.story ? 30 : 22, 34, (x, y, i) => i % 3 === 0 ? star4(x, y, 24 + r() * 10, pick(r, cols), r() * 30) : i % 3 === 1 ? ring(x, y, 14 + r() * 8, pick(r, cols), 3) : `<path d="M${f(x - 12)} ${f(y)}q6 -10 12 0t12 0" stroke="${pick(r, cols)}" stroke-width="4" fill="none" stroke-linecap="round" transform="rotate(${f(r() * 160)} ${f(x)} ${f(y)})"/>`) + bands(r, c, 10, (x, y, i) => i % 2 ? star4(x, y, 56 + r() * 30, pick(r, cols), r() * 30) : ring(x, y, 40 + r() * 30, pick(r, cols), 5)) + `</g>`;
      return svg(c, o, NEON_GLOW); } },

  diner: { word: "retro", note: "retro diner: cream ground, red and teal, checkerboard bands, chunky outlines and hard shadows",
    vars: { "--low": "#FFF3DC", "--az": "#2B2430", "--az2": "#5B4F5B", "--cream": "#FFFFFF", "--top": "#BFEDE6", "--strong": "#8FDCD0", "--edge": "#19B5A5", "--sun": "#FFD23F",
      "--canvas": "#FFF3DC", "--bw": "5px", "--bw-art": "6px", "--r-pill": "14px", "--r-tile": "16px", "--r-row": "16px", "--r-art": "20px", "--r-mochi": "12px",
      "--tile-edge": "#2B2430", "--t1": "#D7263D", "--t2": "#19B5A5", "--t3": "#19B5A5", "--t4": "#D7263D",
      "--tile-shadow": "6px 7px 0 #2B2430", "--pill-shadow": "4px 5px 0 #2B2430", "--row-shadow": "6px 7px 0 #2B2430", "--wm-r": "16px", "--wm-bw": "5px", "--wm-shadow": "4px 5px 0 #D7263D",
      "--tag-bg": "#D7263D", "--tag-ink": "#FFF3DC", "--tag-r": "10px", "--tag-rot": "-3deg", "--tag-bw": "5px", "--tag-shadow": "5px 6px 0 #2B2430",
      "--head-font": '"Lilita One","M PLUS Rounded 1c",sans-serif', "--head-weight": "400", "--head-ls": "0px", "--head-ink": "#D7263D", "--head-shadow": "4px 4px 0 #2B2430", "--foot-ink": "#2B2430", "--dots-inset": "46px", "--dots-style": "none", "--dots-bw": "0px" },
    css: ".st-diner .shopart{background:#BFEDE6}.st-diner .shopart .blob{background:#FFD23F}.st-diner .tn,.st-diner .pn{font-weight:800}",
    fonts: "family=Lilita+One", pose: { "m-wave": "m-whisk" },
    deco: (c) => { const r = mul(c.seed), b = 38;
      let o = checker(c, 0, b, "#D7263D", "#FFF8EA") + checker(c, c.H - b, b, "#19B5A5", "#FFF8EA") + `<rect x="0" y="${b}" width="${c.W}" height="5" fill="#2B2430"/><rect x="0" y="${c.H - b - 5}" width="${c.W}" height="5" fill="#2B2430"/>`;
      o += around(r, c.W, c.H, 0, 30, () => "");
      for (let i = 0; i < (c.story ? 9 : 0); i++) { const x = 90 + r() * (c.W - 180), top = i % 2 === 0, y = top ? 70 + r() * 130 : c.H - 200 + r() * 130; o += star5(x, y, 38 + r() * 40, i % 2 ? "#FFD23F" : "#19B5A5", r() * 30, "#2B2430"); }
      for (let i = 0; i < 10; i++) { const left = i % 2 === 0, x = left ? 30 : c.W - 30, y = 90 + (i / 10) * (c.H - 220) + r() * 20; o += star5(x, y, 22 + r() * 8, i % 4 < 2 ? "#FFD23F" : "#19B5A5", r() * 30, "#2B2430"); }
      return svg(c, o); } },

  washi: { word: "tea", note: "washi paper and tea house: kraft paper grain, indigo ink, vermilion stamp, tape strips and wave band",
    vars: { "--low": "#F3EAD6", "--az": "#2B3445", "--az2": "#566074", "--cream": "#FBF6EA", "--top": "#E8DFC6", "--strong": "#D9CDAA", "--edge": "#8A7A57", "--sun": "#B33A2E",
      "--canvas": "#F3EAD6", "--bw": "3px", "--bw-art": "3px", "--r-pill": "8px", "--r-tile": "6px", "--r-row": "8px", "--r-art": "8px", "--r-mochi": "6px", "--tile-edge": "#2B3445",
      "--tile-shadow": "inset 0 0 0 5px #FBF6EA, inset 0 0 0 7px rgba(43,52,69,.4)", "--row-shadow": "4px 5px 0 rgba(43,52,69,.22)", "--wm-r": "8px", "--wm-bw": "3px", "--wm-shadow": "none", "--wm-pad": "6px 24px 6px 10px",
      "--tag-bg": "#B33A2E", "--tag-ink": "#FBF6EA", "--tag-line": "#8E2A20", "--tag-r": "8px", "--tag-bw": "3px", "--tag-rot": "-2deg", "--tag-shadow": "0 0 0 4px #F3EAD6, 0 0 0 6px #B33A2E",
      "--head-font": '"Shippori Mincho","M PLUS Rounded 1c",serif', "--head-weight": "800", "--head-ls": "-1.5px", "--dots-ink": "rgba(43,52,69,.45)", "--dots-style": "solid", "--dots-bw": "2px", "--dots-r": "4px", "--dots-inset": "26px" },
    css: ".st-washi .shopart .blob{background:#D9CDAA}.st-washi .tn,.st-washi .pn,.st-washi .rb{font-weight:800}",
    fonts: "family=Shippori+Mincho:wght@700;800", pose: { "m-wave": "m-pour" },
    deco: (c) => { const r = mul(c.seed), cols = ["#F5B5C8", "#A9CF92", "#8FB2D9", "#F2D07A"];
      const tape = (x, y, rot, col) => `<g transform="translate(${x} ${y}) rotate(${rot})"><polygon points="-70,-17 70,-17 64,-8 70,0 64,8 70,17 -70,17 -64,8 -70,0 -64,-8" fill="${col}" fill-opacity=".78"/><path d="M-60 -9H60M-60 9H60" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-dasharray="4 8"/></g>`;
      let o = `<rect width="${c.W}" height="${c.H}" filter="url(#pp)" opacity=".5"/>`;
      o += tape(56, 38, -38, cols[0]) + tape(c.W - 56, 38, 38, cols[1]) + tape(60, c.H - 44, 38, cols[2]) + tape(c.W - 60, c.H - 44, -38, cols[3]);
      const sb = c.H - 40, rowsN = 2; let wv = "";
      for (let row = 0; row < rowsN; row++) for (let i = -1; i * 40 < c.W + 40; i++) { const cx = i * 40 + (row % 2 ? 20 : 0), cy = sb + 20 + row * 14; wv += [18, 12, 6].map((rr) => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#F3EAD6" stroke="#2B3445" stroke-opacity=".38" stroke-width="2"/>`).join(""); }
      o += `<clipPath id="cb"><rect x="0" y="${sb}" width="${c.W}" height="40"/></clipPath><g clip-path="url(#cb)">${wv}</g>`;
      for (let i = 0; i < (c.story ? 7 : 0); i++) { const x = 110 + r() * (c.W - 220), top = i % 2 === 0, y = top ? 60 + r() * 130 : c.H - 190 + r() * 110; o += `<g opacity=".8">${star4(x, y, 40 + r() * 30, i % 3 === 0 ? "#B33A2E" : "#2B3445", r() * 20)}</g>`; }
      return svg(c, o, '<filter id="pp" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9 .035" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 .55  0 0 0 0 .45  0 0 0 0 .3  0 0 0 .55 -.12"/></filter>'); } },

  comic: { word: "pop", note: "comic pop: yellow ground with halftone dots, bold black outlines, hard shadows, starbursts",
    vars: { "--low": "#FFE14D", "--az": "#141414", "--az2": "#3A2F2F", "--cream": "#FFFFFF", "--top": "#8DE0F2", "--strong": "#FF7AA8", "--edge": "#141414", "--sun": "#FF4D6D",
      "--canvas": "#FFE14D", "--bw": "6px", "--bw-art": "7px", "--r-pill": "14px", "--r-tile": "12px", "--r-row": "14px", "--r-art": "16px", "--r-mochi": "10px", "--tile-edge": "#141414",
      "--t1": "#141414", "--tile-shadow": "8px 8px 0 #141414", "--pill-shadow": "5px 5px 0 #141414", "--row-shadow": "8px 8px 0 #141414",
      "--wm-r": "14px", "--wm-bw": "6px", "--wm-shadow": "5px 5px 0 #FF4D6D", "--tag-bg": "#FF4D6D", "--tag-ink": "#FFFFFF", "--tag-r": "8px", "--tag-bw": "6px", "--tag-rot": "-4deg", "--tag-shadow": "6px 6px 0 #141414",
      "--head-font": 'Bangers,"M PLUS Rounded 1c",sans-serif', "--head-weight": "400", "--head-ls": "3px", "--head-ink": "#FFFFFF", "--head-stroke": "8px", "--head-stroke-ink": "#141414", "--head-shadow": "5px 5px 0 #FF4D6D",
      "--foot-ink": "#141414", "--dots-inset": "0px", "--dots-bw": "10px", "--dots-style": "solid", "--dots-ink": "#141414", "--dots-r": "0px" },
    css: ".st-comic .shopart .blob{background:#FFE14D}.st-comic .head{padding:4px 12px 8px 6px;margin:-4px 0 -8px -6px;width:972px}.st-comic .tn,.st-comic .pn,.st-comic .rb{font-weight:800}",
    fonts: "family=Bangers", pose: { "m-wave": "m-excited", "m-happy": "m-excited" },
    deco: (c) => { const r = mul(c.seed);
      const burst = (x, y, s, col, rot) => { const pts = []; for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, rr = (i % 2 ? 0.55 : 1) * s / 2; pts.push(`${f(x + Math.cos(a) * rr)},${f(y + Math.sin(a) * rr)}`); } return `<polygon points="${pts.join(" ")}" fill="${col}" stroke="#141414" stroke-width="4" stroke-linejoin="round" transform="rotate(${f(rot)} ${f(x)} ${f(y)})"/>`; };
      let o = `<defs/><rect width="${c.W}" height="${c.H}" fill="url(#ht)"/>`;
      o += around(r, c.W, c.H, c.story ? 16 : 11, 28, (x, y, i) => burst(x, y, 30 + r() * 8, i % 3 === 0 ? "#fff" : i % 3 === 1 ? "#FF7AA8" : "#8DE0F2", r() * 40)) + bands(r, c, 8, (x, y, i) => burst(x, y, 90 + r() * 70, i % 3 === 0 ? "#fff" : i % 3 === 1 ? "#FF7AA8" : "#8DE0F2", r() * 40));
      return svg(c, o, `<radialGradient id="hg" cx=".5" cy=".5" r=".75"><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></radialGradient><mask id="hm"><rect width="${c.W}" height="${c.H}" fill="url(#hg)"/></mask><pattern id="ht" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="14" cy="14" r="6.5" fill="#FF7AA8" fill-opacity=".85"/></pattern>`).replace('fill="url(#ht)"', 'fill="url(#ht)" mask="url(#hm)"'); } },

  garden: { word: "botanical", note: "garden botanical: sage ground, deep green ink, leaf-shaped tiles, vines in the margins",
    vars: { "--low": "#EAF1DF", "--az": "#2F4A2C", "--az2": "#587455", "--cream": "#FBFDF5", "--top": "#D8E7C6", "--strong": "#BCD6A2", "--edge": "#6FA35E", "--sun": "#F6E6A6",
      "--canvas": "#EAF1DF", "--bw": "3px", "--bw-art": "4px", "--r-tile": "46px 10px 46px 10px", "--r-row": "40px 10px 40px 10px", "--r-art": "46px 10px 46px 10px", "--r-mochi": "22px 6px 22px 6px", "--r-pill": "22px 6px 22px 6px",
      "--tile-edge": "#6FA35E", "--tile-shadow": "0 6px 0 rgba(47,74,44,.14)", "--row-shadow": "0 6px 0 rgba(47,74,44,.14)", "--wm-r": "26px 6px 26px 6px", "--wm-shadow": "0 5px 0 rgba(47,74,44,.14)", "--wm-bw": "3px",
      "--tag-bg": "#F6E6A6", "--tag-r": "28px 6px 28px 6px", "--tag-bw": "3px", "--tag-rot": "-2deg", "--tag-shadow": "0 5px 0 rgba(47,74,44,.18)",
      "--head-font": 'Fraunces,"M PLUS Rounded 1c",serif', "--head-weight": "800", "--head-ls": "-.5px", "--dots-ink": "rgba(111,163,94,.6)", "--dots-style": "dashed", "--dots-r": "34px 8px 34px 8px" },
    css: ".st-garden .shopart{background:#D8E7C6}.st-garden .tn,.st-garden .pn{font-weight:800}",
    fonts: "family=Fraunces:wght@700;800", pose: { "m-wave": "m-whisk" },
    deco: (c) => { const r = mul(c.seed), greens = ["#6FA35E", "#8CBF7A", "#4F8A4C"];
      const vine = (x, amp, flip) => { let d = `M${x} -10`, o = ""; const seg = 90; for (let y = -10, k = 0; y < c.H + 10; y += seg, k++) { const dx = (k % 2 ? -amp : amp); d += `Q${f(x + dx)} ${y + seg / 2} ${x} ${y + seg}`; const lx = x + (k % 2 ? 1 : -1) * 6 * flip; o += leaf(lx + (k % 2 ? 14 : -14) * flip, y + seg * 0.4, 30 + r() * 8, pick(r, greens), (k % 2 ? -35 : 215) + (flip < 0 ? 0 : 0), "#2F4A2C") + leaf(lx + (k % 2 ? -12 : 12) * flip, y + seg * 0.85, 24 + r() * 6, pick(r, greens), (k % 2 ? 215 : -35), "#2F4A2C"); } return `<path d="${d}" stroke="#4F8A4C" stroke-width="4" fill="none" stroke-linecap="round"/>` + o; };
      let o = vine(26, 10, 1) + vine(c.W - 26, 10, -1);
      for (let i = 0; i < 12; i++) { const x = 80 + (i / 11) * (c.W - 160), top = i % 2 === 0; o += leaf(x, top ? 24 : c.H - 24, 22 + r() * 8, pick(r, greens), r() * 360, "#2F4A2C"); }
      o += bands(r, c, 10, (x, y, i) => leaf(x, y, 50 + r() * 40, pick(r, greens), r() * 360, "#2F4A2C"));
      return svg(c, o); } },

  confetti: { word: "festival", note: "confetti festival: white ground, bunting, scattered confetti, a different bright border on every tile",
    vars: { "--low": "#FFFDF7", "--az": "#3B2A4A", "--az2": "#6B5A7B", "--cream": "#FFFFFF", "--top": "#FFE3F0", "--strong": "#FFC4DE", "--edge": "#B39DFF", "--sun": "#FFD23F",
      "--canvas": "#FFFDF7", "--bw": "5px", "--bw-art": "6px", "--r-tile": "30px", "--r-row": "30px", "--r-art": "40px", "--tile-edge": "#8E7CFF",
      "--t1": "#FF6FAE", "--t2": "#35C9B6", "--t3": "#FFB703", "--t4": "#8E7CFF", "--tb1": "#FFEAF3", "--tb2": "#E6FAF6", "--tb3": "#FFF4D6", "--tb4": "#EFEBFF",
      "--tile-shadow": "0 7px 0 rgba(59,42,74,.16)", "--row-shadow": "0 7px 0 rgba(59,42,74,.2)", "--pill-shadow": "0 5px 0 rgba(59,42,74,.15)", "--line": "#3B2A4A",
      "--wm-shadow": "0 0 0 6px #FFD23F", "--tag-bg": "#FFD23F", "--tag-r": "12px", "--tag-rot": "-4deg", "--tag-shadow": "0 0 0 5px #fff, 5px 7px 0 5px #FF6FAE",
      "--head-font": 'Fredoka,"M PLUS Rounded 1c",sans-serif', "--head-weight": "700", "--head-ls": "0px", "--head-shadow": "4px 4px 0 #FFC4DE", "--dots-style": "dashed", "--dots-ink": "rgba(142,124,255,.6)", "--dots-inset": "26px" },
    css: ".st-confetti .shopart{background:#FFE3F0}.st-confetti .shopart .blob{background:#FFC4DE}.st-confetti .row:nth-child(odd){border-color:#FF6FAE}.st-confetti .row:nth-child(even){border-color:#35C9B6}",
    fonts: "family=Fredoka:wght@600;700", pose: { "m-wave": "m-excited" },
    deco: (c) => { const r = mul(c.seed);
      let o = ""; const flags = c.story ? 12 : 17, fw = c.W / flags;       // bunting across the top, in the band above the wordmark
      o += `<path d="M0 6Q${c.W / 2} 22 ${c.W} 6" stroke="#3B2A4A" stroke-width="3" fill="none"/>`;
      for (let i = 0; i < flags; i++) { const x = i * fw, t = (x + fw / 2) / c.W, sag = 6 + (c.story ? 16 : 10) * (1 - Math.pow(2 * t - 1, 2)); o += `<polygon points="${f(x + 4)},${f(sag)} ${f(x + fw - 4)},${f(sag)} ${f(x + fw / 2)},${f(sag + (c.story ? 56 : 26))}" fill="${party[i % party.length]}" stroke="#3B2A4A" stroke-width="2.5" stroke-linejoin="round"/>`; }
      o += around(r, c.W, c.H, c.story ? 40 : 30, 36, (x, y) => { if (y < 70) y += 34; return piece(x, y, 16 + r() * 12, pick(r, party), r() * 180, Math.floor(r() * 4)); });
      o += bands(r, c, 36, (x, y) => piece(x, y, 24 + r() * 26, pick(r, party), r() * 180, Math.floor(r() * 4)));
      return svg(c, o); } },

  editorial: { word: "clean", note: "clean editorial: white page, ink black, hairline rules, a serif headline, one matcha green accent",
    vars: { "--low": "#FFFFFF", "--az": "#161616", "--az2": "#5A5A5A", "--cream": "#FFFFFF", "--top": "#F1F5EC", "--strong": "#DCE6D0", "--edge": "#161616", "--sun": "#FFFFFF",
      "--canvas": "#FFFFFF", "--bw": "2px", "--bw-art": "2px", "--r-pill": "0px", "--r-tile": "0px", "--r-row": "0px", "--r-art": "0px", "--r-mochi": "0px", "--tile-edge": "#161616", "--tile-bg": "#FFFFFF", "--row-shadow": "none",
      "--wm-bg": "transparent", "--wm-bw": "0px", "--wm-shadow": "none", "--wm-pad": "0 0", "--wm-r": "0px",
      "--tag-bg": "transparent", "--tag-line": "#5E8C4A", "--tag-bw": "0px", "--tag-r": "0px", "--tag-rot": "0deg", "--tag-shadow": "none", "--tag-pad": "4px 0",
      "--head-font": '"Playfair Display","M PLUS Rounded 1c",serif', "--head-weight": "800", "--head-ls": "-1px", "--foot-ink": "#5A5A5A", "--dots-style": "none", "--dots-bw": "0px" },
    css: ".st-editorial .tag{text-transform:uppercase;letter-spacing:3px;font-weight:800;border-bottom:4px solid #5E8C4A}.st-editorial .wm{letter-spacing:.5px}.st-editorial .shopart{background:#F1F5EC}.st-editorial .shopart .blob{background:#DCE6D0}.st-editorial .tn,.st-editorial .pn,.st-editorial .rb{font-weight:700}.st-editorial .foot{letter-spacing:1px}",
    fonts: "family=Playfair+Display:wght@700;800", pose: { "m-wave": "m-happy" },
    deco: (c) => { const g = c.g; return svg(c, `<rect width="${c.W}" height="16" fill="#5E8C4A"/><rect x="60" y="${g.head - 14}" width="960" height="2" fill="#161616"/><rect x="60" y="${c.story ? 1626 : 1236}" width="960" height="2" fill="#161616"/><rect x="60" y="${c.story ? 1620 : 1230}" width="64" height="8" fill="#5E8C4A"/>`); } },

  frost: { word: "winter", note: "frosted winter: icy blue ground, frosted-glass panels, snowflakes, sparkles and icicles",
    vars: { "--low": "#E3F0FA", "--az": "#223B5E", "--az2": "#4E6A8E", "--cream": "rgba(255,255,255,.74)", "--top": "#DCEBF8", "--strong": "#BFD8EE", "--edge": "#FFFFFF", "--sun": "#FFFFFF",
      "--canvas": "linear-gradient(180deg,#F0F8FE 0%,#D6E8F7 55%,#C4DCF1 100%)", "--line": "#FFFFFF", "--panel": "rgba(255,255,255,.74)", "--tile-bg": "rgba(255,255,255,.74)", "--tile-edge": "#FFFFFF", "--bw": "4px", "--bw-art": "5px",
      "--tile-shadow": "0 10px 24px rgba(52,96,150,.24), inset 0 0 0 2px rgba(150,190,230,.55)", "--pill-shadow": "0 8px 18px rgba(52,96,150,.2)", "--row-shadow": "0 10px 24px rgba(52,96,150,.24), inset 0 0 0 2px rgba(150,190,230,.55)",
      "--wm-bg": "rgba(255,255,255,.8)", "--wm-line": "#FFFFFF", "--wm-shadow": "0 8px 18px rgba(52,96,150,.22)", "--tag-bg": "#FFFFFF", "--tag-line": "#8FBCE6", "--tag-rot": "-2deg", "--tag-shadow": "0 8px 18px rgba(52,96,150,.25)",
      "--head-font": 'Quicksand,"M PLUS Rounded 1c",sans-serif', "--head-weight": "700", "--head-ls": "-.5px", "--head-shadow": "0 4px 0 rgba(255,255,255,.9)", "--dots-ink": "rgba(255,255,255,.95)", "--dots-style": "solid", "--dots-bw": "5px", "--dots-shadow": "0 0 0 3px rgba(143,188,230,.5)" },
    css: ".st-frost .shopart{background:rgba(255,255,255,.55)}.st-frost .shopart .blob{background:#CFE4F6}.st-frost .tn,.st-frost .pn,.st-frost .rb{font-weight:700}",
    fonts: "family=Quicksand:wght@600;700", pose: { "m-wave": "m-happy" },
    deco: (c) => { const r = mul(c.seed), cols = ["#FFFFFF", "#FFFFFF", "#9CC7EE"];
      let o = ""; for (let i = 0; i < 9; i++) o += `<circle cx="${f(r() * c.W)}" cy="${f(r() * c.H)}" r="${f(50 + r() * 110)}" fill="#fff" fill-opacity=".22"/>`;   // soft bokeh behind everything
      const n = c.story ? 18 : 15; for (let i = 0; i < n; i++) { const x = (i + 0.5) * (c.W / n), len = 20 + r() * 26; o += `<path d="M${f(x - 12)} 0H${f(x + 12)}L${f(x)} ${f(len)}Z" fill="#fff" fill-opacity=".92" stroke="#9CC7EE" stroke-width="2"/>`; }   // icicles
      o += around(r, c.W, c.H, c.story ? 30 : 22, 32, (x, y, i) => (y < 52 ? "" : i % 3 === 0 ? star4(x, y, 18 + r() * 10, "#fff", r() * 30) : i % 3 === 1 ? dot(x, y, 6 + r() * 6, "#fff") : flake(x, y, 28 + r() * 10, pick(r, ["#7FB2E0", "#fff"]), 2.4, r() * 60)));
      o += bands(r, c, 12, (x, y, i) => i % 3 === 0 ? flake(x, y, 70 + r() * 40, pick(r, ["#7FB2E0", "#fff"]), 3, r() * 60) : i % 3 === 1 ? star4(x, y, 36 + r() * 24, "#fff", r() * 30) : dot(x, y, 14 + r() * 12, "#fff"));
      return svg(c, o); } },
};

for (const [k, v] of Object.entries(STYLES)) v.name = k;
export const STYLE_NAMES = Object.keys(STYLES);
export const DEFAULT_STYLE = "pastel";
export const styleOf = (name) => STYLES[name] || STYLES[DEFAULT_STYLE];

// the CSS for one style: its tokens on the body class, then its own rules
export function styleCss(name) {
  const s = styleOf(name), n = STYLES[name] ? name : DEFAULT_STYLE;
  const vars = Object.entries(s.vars).map(([k, v]) => `${k}:${v}`).join(";");
  return `body.st-${n}{${vars}}\n${s.css}`;
}
export const styleFontLink = (name) => { const q = styleOf(name).fonts; return q ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=block">` : ""; };
export const stylePose = (name) => styleOf(name).pose || {};
// the decoration SVG for a card: `ctx` = { W, H, story, g (the layout geometry), seed }
export const styleDeco = (name, ctx) => styleOf(name).deco(ctx);

// styles switched off in data/social-styles.json ({ "off": ["comic"] }); never all of them
export function activeStyles(file = STYLE_CONFIG) {
  let off = [];
  try { off = JSON.parse(fs.readFileSync(file, "utf8")).off || []; } catch { /* no config: every style is on */ }
  const on = STYLE_NAMES.filter((n) => !off.includes(n));
  return on.length ? on : [DEFAULT_STYLE];
}
