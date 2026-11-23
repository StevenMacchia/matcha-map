// POST /api/alerts: email + city sign-up. Stored as alert:<city>:<hash of email>, one row per email and city (repeats overwrite).
// No double opt-in and nothing sends mail yet: this only collects consented sign-ups (see docs/INTAKE.md).
import { validateAlert, sha256 } from "../_lib/validate.js";
import { storeForm, methodNot } from "../_lib/http.js";

export const onRequestPost = ({ request, env }) => storeForm({
  request, env, validate: validateAlert, prefix: "alert", ttl: 0, scope: "alerts",
  thanks: "You are on the list. We will write when a pop-up lands near you.",
  keyOf: async (c) => `alert:${c.city}:${(await sha256(c.email.toLowerCase())).slice(0, 24)}`,
});
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : methodNot("POST"));
