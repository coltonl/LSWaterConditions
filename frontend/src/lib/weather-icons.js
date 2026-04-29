// Maps weather condition strings (from WMO codes) to emoji icons.
// Supports day/night variants based on sunrise/sunset times.

const DAY_ICONS = {
  "Clear":            "☀️",
  "Mostly clear":     "🌤️",
  "Partly cloudy":    "⛅",
  "Overcast":         "☁️",
  "Fog":              "🌫️",
  "Drizzle":          "🌦️",
  "Freezing drizzle": "🌦️",
  "Rain":             "🌧️",
  "Freezing rain":    "🌧️",
  "Snow":             "❄️",
  "Snow grains":      "❄️",
  "Rain showers":     "🌦️",
  "Snow showers":     "🌨️",
  "Thunderstorm":     "⛈️",
};

const NIGHT_ICONS = {
  "Clear":            "🌙",
  "Mostly clear":     "🌙",
  "Partly cloudy":    "🌥️",
  "Overcast":         "☁️",
  "Fog":              "🌫️",
  "Drizzle":          "🌦️",
  "Freezing drizzle": "🌦️",
  "Rain":             "🌧️",
  "Freezing rain":    "🌧️",
  "Snow":             "❄️",
  "Snow grains":      "❄️",
  "Rain showers":     "🌦️",
  "Snow showers":     "🌨️",
  "Thunderstorm":     "⛈️",
};

/**
 * Get weather icon for a condition at a specific hour.
 * @param {string} condition - e.g. "Clear", "Rain"
 * @param {string} isoTime - hour's ISO time e.g. "2026-04-29T14:00"
 * @param {string} sunrise - e.g. "2026-04-29T05:45"
 * @param {string} sunset  - e.g. "2026-04-29T20:15"
 */
export function conditionToIcon(condition, isoTime, sunrise, sunset) {
  const isNight = isoTime && sunrise && sunset
    ? isoTime < sunrise || isoTime >= sunset
    : false;

  const icons = isNight ? NIGHT_ICONS : DAY_ICONS;
  return icons[condition] ?? (isNight ? "🌙" : "☀️");
}
