import test from "node:test";
import assert from "node:assert/strict";
import { prettyHandle, brandOf, placeOf, displayName, isHandleShaped, PLACEHOLDER_VENUE } from "../ingest/lib/names.js";

test("a handle is made readable: dots and underscores break words, a glued suffix is split", () => {
  assert.equal(prettyHandle("bujimatcha"), "Buji Matcha");
  assert.equal(prettyHandle("mrs.stript"), "Mrs Stript");
  assert.equal(prettyHandle("@the_tea_co"), "The Tea Co");
  assert.equal(prettyHandle("333.matcha"), "333 Matcha");
  assert.equal(prettyHandle(""), "");
});
test("a flyer's brand: brand, then auto_name, then the readable handle; never the raw handle", () => {
  assert.equal(brandOf({ brand: "Hidden Leaf", handle: "hiddenleaf", auto_name: "Hidden Leaf Tea" }), "Hidden Leaf");
  assert.equal(brandOf({ brand: "bujimatcha", handle: "bujimatcha", auto_name: "Buji Matcha Co" }), "Buji Matcha Co");
  assert.equal(brandOf({ brand: "bujimatcha", handle: "bujimatcha" }), "Buji Matcha");
  assert.equal(brandOf({ brand: "", handle: "mrs.stript" }), "Mrs Stript");
  assert.equal(brandOf({ brand: "BUJIMATCHA", handle: "bujimatcha" }), "Buji Matcha");
  assert.equal(displayName("Buji"), "Buji");
  assert.equal(displayName("bujimatcha"), "Buji Matcha");
  assert.ok(isHandleShaped("mrs.stript") && !isHandleShaped("Mrs Stript"));
});
test("a venue that is a handle or a placeholder is shown as the city", () => {
  const e = (venue) => ({ venue, city: "Austin", state: "TX", handle: "buji.matcha" });
  assert.equal(placeOf(e("Sunny Books")), "Sunny Books");
  assert.equal(placeOf(e("@sunnybooks")), "Austin, TX");
  assert.equal(placeOf(e("buji.matcha")), "Austin, TX");
  assert.equal(placeOf(e("some_cafe")), "Austin, TX");
  assert.equal(placeOf(e("Cafe of the day")), "Austin, TX");
  assert.equal(placeOf(e("")), "Austin, TX");
  assert.ok(PLACEHOLDER_VENUE.test("Spot of the Week") && !PLACEHOLDER_VENUE.test("Cafe of Dreams"));
});
