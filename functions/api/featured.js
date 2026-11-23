// POST /api/featured: a host asks for a Featured slot. Stored as featured:<id> (90 days), with paid:false until a payment is confirmed.
import { validateFeatured } from "../_lib/validate.js";
import { storeForm, methodNot } from "../_lib/http.js";

export const onRequestPost = ({ request, env }) => storeForm({ request, env, validate: validateFeatured, prefix: "featured", ttl: 90 * 86400, scope: "featured", thanks: "Got it. We will check the pop-up and write back." });
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : methodNot("POST"));
