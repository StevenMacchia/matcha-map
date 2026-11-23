// Every request on a host other than the canonical one is answered with a permanent redirect to the same path on
// https://matchamap.app: the old matchamap-cu7.pages.dev address and www.matchamap.app. A _redirects file cannot do
// this (Pages serves host-based lines as plain text), so it runs here, before static assets and the API alike.
// Preview deployments (<hash>.matchamap-cu7.pages.dev) are left alone so a preview can still be looked at.
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

export async function onRequest(context) {
  return redirectFor(context.request) || context.next();
}
