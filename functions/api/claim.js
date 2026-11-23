// POST /api/claim: a brand asks to claim its page. Stored as claim:<id> (no expiry; delete by hand once handled).
import { validateClaim } from "../_lib/validate.js";
import { storeForm, methodNot } from "../_lib/http.js";

export const onRequestPost = ({ request, env }) => storeForm({ request, env, validate: validateClaim, prefix: "claim", ttl: 0, scope: "claim", thanks: "Got it. We will check the proof and write back." });
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : methodNot("POST"));
