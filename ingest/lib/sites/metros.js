// The 40 biggest US metros the social and news crawlers rotate through (reddit, mastodon, gnews, bluesky, yelp-events).
// City names are data/cities.json names; `sub` is the metro's subreddit (hand-mapped: most are not the city slug), `label` the
// words a search query uses ("Orange County" is the metro, Irvine its listed city).
export const METROS = [
  ["New York", "NY", "nyc"], ["Los Angeles", "CA", "LosAngeles"], ["San Francisco", "CA", "bayarea", "Bay Area"], ["Seattle", "WA", "Seattle"],
  ["Chicago", "IL", "chicago"], ["Houston", "TX", "houston"], ["Dallas", "TX", "Dallas"], ["Austin", "TX", "Austin"], ["San Antonio", "TX", "sanantonio"],
  ["Atlanta", "GA", "Atlanta"], ["Miami", "FL", "Miami"], ["Orlando", "FL", "orlando"], ["Boston", "MA", "boston"], ["Philadelphia", "PA", "philadelphia"],
  ["Washington", "DC", "washingtondc", "Washington DC"], ["Denver", "CO", "Denver"], ["Phoenix", "AZ", "phoenix"], ["San Diego", "CA", "sandiego"],
  ["Portland", "OR", "Portland"], ["Minneapolis", "MN", "Minneapolis"], ["Detroit", "MI", "Detroit"], ["Nashville", "TN", "nashville"],
  ["Charlotte", "NC", "Charlotte"], ["Tampa", "FL", "tampa"], ["Sacramento", "CA", "sacramento"], ["Las Vegas", "NV", "LasVegas"],
  ["Pittsburgh", "PA", "pittsburgh"], ["Columbus", "OH", "Columbus"], ["Raleigh", "NC", "raleigh"], ["St. Louis", "MO", "StLouis"],
  ["Baltimore", "MD", "baltimore"], ["Kansas City", "MO", "kansascity"], ["Salt Lake City", "UT", "SaltLakeCity"], ["Indianapolis", "IN", "indianapolis"],
  ["Cincinnati", "OH", "cincinnati"], ["Cleveland", "OH", "Cleveland"], ["Milwaukee", "WI", "milwaukee"], ["New Orleans", "LA", "NewOrleans"],
  ["Honolulu", "HI", "honolulu"], ["Irvine", "CA", "orangecounty", "Orange County"],
].map(([city, state, sub, label]) => ({ city, state, sub, label: label || city }));

// The `perRun` metros for this run: a window that moves one step every `slotHours` (6 h = one discover cycle), so four runs a
// day walk the list without a cursor file. `salt` offsets crawlers so they do not all ask about the same cities at once.
export function rotate(list, now = new Date(), perRun = 8, { slotHours = 6, salt = 0 } = {}) {
  if (!list.length || perRun <= 0) return [];
  const slot = Math.floor(new Date(now).getTime() / (slotHours * 3600000)) + salt;
  const start = (slot * perRun) % list.length;
  return Array.from({ length: Math.min(perRun, list.length) }, (_, i) => list[(start + i) % list.length]);
}

// A metro named in a subreddit -> the metro, or null.
export const metroOfSub = (sub) => METROS.find((m) => m.sub.toLowerCase() === String(sub || "").toLowerCase()) || null;
