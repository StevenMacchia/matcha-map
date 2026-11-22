// Bounding boxes [south, west, north, east] for the Overpass queries: the contiguous US in slices
// (one huge box would time out), then Alaska and Hawaii. Overlaps are fine; ids dedupe.
export const BOXES = [
  { name: "us-west", bbox: [31.0, -125.0, 49.5, -104.0] },
  { name: "us-south-central", bbox: [24.5, -104.0, 31.0, -88.0] },
  { name: "us-north-central", bbox: [31.0, -104.0, 49.5, -88.0] },
  { name: "us-east-south", bbox: [24.5, -88.0, 37.0, -75.0] },
  { name: "us-east-north", bbox: [37.0, -88.0, 47.6, -66.5] },
  { name: "alaska", bbox: [51.0, -170.0, 71.5, -130.0] },
  { name: "hawaii", bbox: [18.8, -160.7, 22.4, -154.7] },
];
