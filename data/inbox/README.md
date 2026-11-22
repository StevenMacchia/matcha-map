# Inbox

Drop one pasted post per file as `data/inbox/<anything>.txt`, then run `npm run ingest -- --inbox`.

Format: first line is the post URL (optional), the rest is the caption. A line starting with `image:` and a photo URL sets the card image.

    https://www.instagram.com/p/XXXXXXXX/
    Pop-up this Saturday 11am-3pm at @sunnybooks, 123 Main St, Los Angeles, CA 90012

The post is matched to a source by the handle in the URL or an @handle in the caption. No match means it is skipped, so add the brand to data/sources.json first. A public TikTok URL is enriched through TikTok oEmbed. Instagram needs INSTAGRAM_OEMBED_TOKEN, otherwise paste the caption.

Only real, public posts. No made-up events.
