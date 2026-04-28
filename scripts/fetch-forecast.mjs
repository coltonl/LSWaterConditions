/**
 * Hourly fetch: Open-Meteo + Claude → current-forecast.json in Blob Storage.
 * Run by .github/workflows/fetch-forecast.yml. Also runnable locally.
 *
 * Required env: ANTHROPIC_API_KEY, AZURE_STORAGE_CONNECTION_STRING.
 */
import { BlobServiceClient } from "@azure/storage-blob";

const LAT = 47.998;
const LON = -122.139;
const TZ  = "America/Los_Angeles";
const CONTAINER = "forecast";
const BLOB_NAME = "current-forecast.json";
const HOURS_AHEAD = 36;
const SUMMARY_HOURS = 12;

// ---------- Open-Meteo ----------

async function fetchOpenMeteo() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  String(LAT));
  url.searchParams.set("longitude", String(LON));
  // wind_gusts_10m — confirmed correct field name (handoff doc had this wrong).
  url.searchParams.set("hourly", "wind_speed_10m,wind_gusts_10m,precipitation,weather_code");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("timezone", TZ);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- WMO weather code → human label ----------

function wmoToCondition(code) {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code >= 45 && code <= 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 56 && code <= 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 66 && code <= 67) return "Freezing rain";
  if (code >= 71 && code <= 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Unknown";
}

// ---------- Ski rating (handoff's logic, with weather_code precedence) ----------

function getSkiRating(windMph, gustMph, precipMm, weatherCode) {
  if (weatherCode >= 95) return "Dangerous";
  if (precipMm > 0.1 || (weatherCode >= 51 && weatherCode < 95)) return "Poor";
  if (windMph > 15 || gustMph > 20) return "Poor";
  if (windMph > 10 || gustMph > 15) return "Fair";
  if (windMph > 6  || gustMph > 10) return "Good";
  return "Excellent";
}

// ---------- Time helpers (Pacific-local "YYYY-MM-DDTHH:00") ----------

function currentPacificHour() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  let hh = get("hour");
  if (hh === "24") hh = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:00`;
}

// ---------- Build per-hour rows ----------

function buildHours(om) {
  const { time, wind_speed_10m, wind_gusts_10m, precipitation, weather_code } = om.hourly;

  if (![wind_speed_10m, wind_gusts_10m, precipitation, weather_code].every(Array.isArray)) {
    throw new Error("Open-Meteo response missing expected hourly arrays");
  }

  const startHour = currentPacificHour();
  let startIdx = time.findIndex((t) => t >= startHour);
  if (startIdx === -1) startIdx = 0;

  const end = Math.min(startIdx + HOURS_AHEAD, time.length);
  const out = [];
  for (let i = startIdx; i < end; i++) {
    const code  = weather_code[i];
    const wind  = round1(wind_speed_10m[i]);
    const gust  = round1(wind_gusts_10m[i]);
    const precip = round2(precipitation[i]);
    out.push({
      isoTime:  time[i],
      windMph:  wind,
      gustMph:  gust,
      precipMm: precip,
      condition: wmoToCondition(code),
      skiRating: getSkiRating(wind, gust, precip, code),
    });
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Claude outlook summary ----------

async function callClaude(hours) {
  const snippet = hours
    .slice(0, SUMMARY_HOURS)
    .map((h) => `${h.isoTime.slice(11)} — wind ${h.windMph} mph, gusts ${h.gustMph} mph, ${h.condition} (${h.skiRating})`)
    .join("\n");

  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{
      role: "user",
      content:
        "You are a local expert on Lake Stevens, Washington water ski conditions. " +
        "Given this hourly forecast for the next 12 hours, write a 2-3 sentence plain-English outlook. " +
        "Mention the best windows for skiing and any warnings. Be direct, like a local would talk. " +
        "Do not include preamble or markdown — just the prose summary.\n\n" +
        `Forecast:\n${snippet}`,
    }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---------- Blob upload ----------

async function uploadBlob(payload) {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING not set");

  const json = JSON.stringify(payload);
  const svc       = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();   // safe; first run creates it (set public access in portal)
  const blob = container.getBlockBlobClient(BLOB_NAME);

  await blob.upload(json, Buffer.byteLength(json, "utf8"), {
    blobHTTPHeaders: {
      blobContentType:  "application/json",
      blobCacheControl: "public, max-age=300",
    },
  });
}

// ---------- main ----------

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  console.log(`[fetch-forecast] Open-Meteo for ${LAT},${LON}…`);
  const om = await fetchOpenMeteo();

  const hours = buildHours(om);
  if (!hours.length) throw new Error("No hours produced from Open-Meteo response");
  console.log(`[fetch-forecast] ${hours.length} hours, starting ${hours[0].isoTime}`);

  let summary = "";
  try {
    summary = await callClaude(hours);
    console.log(`[fetch-forecast] summary: ${summary.slice(0, 80)}…`);
  } catch (err) {
    // Claude failure is non-fatal — frontend hides the outlook section if empty.
    console.warn(`[fetch-forecast] Claude failed: ${err.message}`);
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    summary,
    hours,
  };

  await uploadBlob(payload);
  console.log(`[fetch-forecast] uploaded ${CONTAINER}/${BLOB_NAME}`);
}

main().catch((err) => {
  console.error(`[fetch-forecast] FAILED: ${err.message}`);
  process.exit(1);
});
