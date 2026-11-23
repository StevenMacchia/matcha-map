// npm run yelp: refused. Yelp's API terms (section 5: nothing stored past 24 hours, no listings database, non-commercial only) rule out
// card enrichment from Yelp. Yelp answers are leads only, through npm run shops:keyed -- --provider yelp. See docs/YELP-TERMS.md.
console.error("npm run yelp is off for good: Yelp content may not be stored or shown on cards under Yelp's API terms; see docs/YELP-TERMS.md");
process.exit(2);
