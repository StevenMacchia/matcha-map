// Tiny logger. Quiet by default; --verbose (or MATCHA_VERBOSE=1) shows debug lines.
let verbose = process.argv.includes("--verbose") || process.env.MATCHA_VERBOSE === "1";
export const setVerbose = (v) => { verbose = !!v; };
export const debug = (...a) => { if (verbose) console.error("  .", ...a); };
export const warn = (...a) => console.error("! ", ...a);
export const info = (...a) => console.log(...a);
const once = new Set();
// Print a warning only the first time per key (used for "off: no TOKEN").
export const warnOnce = (key, ...a) => { if (!once.has(key)) { once.add(key); warn(...a); } };
