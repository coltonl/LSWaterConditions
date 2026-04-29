// Rating → presentation lookup. Pure data; the script computes which rating each
// hour gets, this just maps the label to a color CSS variable + emoji icon.

export const RATING_META = {
  Excellent: {
    color: "var(--rating-excellent)",
    icon: "🏄",
    verdict: "SEND IT",
    note: "Glassy enough to make you overconfident.",
    rank: 5,
  },
  Good: {
    color: "var(--rating-good)",
    icon: "🌊",
    verdict: "LAUNCHABLE",
    note: "Worth a lap before the lake gets ideas.",
    rank: 4,
  },
  Fair: {
    color: "var(--rating-fair)",
    icon: "〰️",
    verdict: "YOUR CALL, CAPTAIN",
    note: "Skiable if your standards are emotionally flexible.",
    rank: 3,
  },
  Poor: {
    color: "var(--rating-poor)",
    icon: "💨",
    verdict: "DOCK ENERGY",
    note: "Great day to organize life jackets.",
    rank: 2,
  },
  Dangerous: {
    color: "var(--rating-dangerous)",
    icon: "⚡",
    verdict: "NOPE",
    note: "The boat can stay on the trailer.",
    rank: 1,
  },
};

export const LEGEND = [
  { label: "Excellent", color: "var(--rating-excellent)", note: "< 6 mph" },
  { label: "Good",      color: "var(--rating-good)",      note: "6–10 mph" },
  { label: "Fair",      color: "var(--rating-fair)",      note: "10–15 mph" },
  { label: "Poor",      color: "var(--rating-poor)",      note: "> 15 / rain" },
];

export function ratingMeta(label) {
  return RATING_META[label] ?? RATING_META.Excellent;
}

export function bestRating(hours = []) {
  return hours.reduce((best, hour) => {
    const currentRank = ratingMeta(hour.skiRating).rank;
    const bestRank = ratingMeta(best).rank;
    return currentRank > bestRank ? hour.skiRating : best;
  }, "Dangerous");
}
