// POST /api/report: "Report a problem" with a pop-up. Stored as report:<id> (90 days). Read it with /api/queue?kinds=report.
import { validateReport } from "../_lib/validate.js";
import { storeForm, methodNot } from "../_lib/http.js";

export const onRequestPost = ({ request, env }) => storeForm({ request, env, validate: validateReport, prefix: "report", ttl: 90 * 86400, scope: "report", thanks: "Thank you. Mattie will take a look." });
export const onRequest = ({ request, env }) => (request.method === "POST" ? onRequestPost({ request, env }) : methodNot("POST"));
