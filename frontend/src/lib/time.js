// Time helpers. Open-Meteo gives us naive Pacific-local strings ("YYYY-MM-DDTHH:00").
// We never feed those to `new Date(...)` directly — that would be timezone-soup.

const TZ = "America/Los_Angeles";

export function parseLocalISO(isoStr) {
  const [datePart, timePart] = isoStr.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, m] = (timePart || "00:00").split(":").map(Number);
  return new Date(y, mo - 1, d, h, m);
}

export function formatHour(isoStr) {
  const d = parseLocalISO(isoStr);
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:00 ${ampm}`;
}

export function dayLabel(isoStr) {
  const d = parseLocalISO(isoStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString())    return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Format the server-side fetchedAt (UTC ISO) as a Pacific-local "h:mm AM/PM" string.
export function formatFetchedAt(fetchedAtIso) {
  if (!fetchedAtIso) return null;
  const d = new Date(fetchedAtIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
}
