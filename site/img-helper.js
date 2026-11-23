// Thumbnails (N7b). tools/shrink-images.js writes a 400 px copy of every event picture to img/events/thumbs/<name>.
// thumbFor("img/events/ab12.jpg") -> "img/events/thumbs/ab12.jpg". Anything else (remote urls, null, art) comes back
// unchanged, so it is safe to wrap any image src. Use it for list rows and "also nearby" mini rows; keep the full file
// for cards and the lightbox. Pair it with onerror to fall back to the full file if a thumb is missing.
export function thumbFor(p) {
  if (typeof p !== "string") return p;
  const m = /^(.*\/img\/events\/|img\/events\/)([^/]+\.(?:jpe?g|png|webp))$/i.exec(p);
  return m ? `${m[1]}thumbs/${m[2]}` : p;
}
if (typeof window !== "undefined") window.thumbFor = thumbFor;
