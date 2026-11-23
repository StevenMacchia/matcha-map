// Static pop-up pages (/e/<id>/, tools/gen-event-pages.js): the card is already in the HTML; this wires its Share
// button and the picture fallbacks. The page works without it.
import { wire } from "./cards.js";
document.querySelectorAll(".mm-card, .mm-brand").forEach((el) => wire(el));
