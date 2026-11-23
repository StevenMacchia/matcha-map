# Analytics (Cloudflare Web Analytics)

Privacy-respecting: no cookies, no fingerprinting, no personal data, nothing to consent to. It counts page views and referrers only.

## Turn it on

1. Cloudflare dashboard, Analytics and logs, **Web Analytics**, **Add a site**. Hostname `matchamap-cu7.pages.dev` (later the real domain). Pick "Manual" (not the automatic setup).
2. Copy the token it shows. The snippet is:

       <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "YOUR_TOKEN"}'></script>

3. Put it just before `</head>` in `site/index.html` and in the page shell of `tools/gen-pages.js` (city and brand pages). `tools/gen-event-pages.js` does not need it (it redirects at once). This waits for the design session: those files are not edited here.
4. The pages carry a Content-Security-Policy meta tag with `script-src 'self'`. Add `https://static.cloudflareinsights.com` to `script-src` and `https://cloudflareinsights.com` to `connect-src` wherever the snippet goes, or the beacon is blocked.
5. Pages that take an email (`/add/`, `/alerts/`, `/claim/`, `/report/`) can be left without it if you want zero third-party scripts there.
6. Mention it on `/privacy/` ("anonymous page-view counts from Cloudflare Web Analytics, no cookies").
