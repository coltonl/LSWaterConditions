// Rating → presentation lookup. Pure data; the script computes which rating each
// hour gets, this just maps the label to a color CSS variable + emoji icon.

export const RATING_META = {
  Excellent: { color: "var(--rating-excellent)", icon: "🏄" },
  Good:      { color: "var(--rating-good)",      icon: "🌊" },
  Fair:      { color: "var(--rating-fair)",      icon: "〰️" },
  Poor:      { color: "var(--rating-poor)",      icon: "💨" },
  Dangerous: { color: "var(--rating-dangerous)", icon: "⚡" },
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
