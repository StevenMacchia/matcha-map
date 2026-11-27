// Every request on a host other than the canonical one is answered with a permanent redirect to the same path on
// https://matchamap.app: the old matchamap-cu7.pages.dev address and www.matchamap.app. A _redirects file cannot do
// this (Pages serves host-based lines as plain text), so it runs here, before static assets and the API alike.
// Preview deployments (<hash>.matchamap-cu7.pages.dev) are left alone so a preview can still be looked at.
import { countable, recordPageview } from "./_lib/metrics.js";

export const CANONICAL_HOST = "matchamap.app";
export const OLD_HOSTS = ["matchamap-cu7.pages.dev", "www." + CANONICAL_HOST];

export function redirectFor(request) {
  const url = new URL(request.url);
  if (!OLD_HOSTS.includes(url.hostname)) return null;
  url.protocol = "https:";
  url.hostname = CANONICAL_HOST;
  url.port = "";
  return Response.redirect(url.toString(), 301);
}

// Page views are counted here, after the response is known, without delaying it (waitUntil). See docs/METRICS.md.
export async function onRequest(context) {
  const redirect = redirectFor(context.request);
  if (redirect) return redirect;
  const response = await context.next();
  try {
    const kv = context.env && context.env.INTAKE;
    if (kv && typeof kv.put === "function" && countable(context.request, response)) {
      const job = recordPageview(kv, context.request, context.env).catch(() => {});
      if (typeof context.waitUntil === "function") context.waitUntil(job);
    }
  } catch { /* counting never breaks a page */ }
  return response;
}
