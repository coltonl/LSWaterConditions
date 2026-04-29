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
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

// ---------- Open-Meteo ----------

async function fetchOpenMeteo() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  String(LAT));
  url.searchParams.set("longitude", String(LON));
  url.searchParams.set("hourly", "wind_speed_10m,wind_gusts_10m,precipitation,weather_code,temperature_2m,apparent_temperature,relative_humidity_2m");
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("temperature_unit", "fahrenheit");
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

// ---------- Ski rating ----------

function getSkiRating(windMph, gustMph, precipMm, weatherCode) {
  if (weatherCode >= 95) return "Dangerous";
  if (precipMm > 0.1 || (weatherCode >= 51 && weatherCode < 95)) return "Poor";
  if (windMph > 15 || gustMph > 20) return "Poor";
  if (windMph > 10 || gustMph > 15) return "Fair";
  if (windMph > 6  || gustMph > 10) return "Good";
  return "Excellent";
}

// ---------- Time helpers ----------

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

function currentPacificDate() {
  return currentPacificHour().slice(0, 10); // "YYYY-MM-DD"
}

// ---------- Build per-hour rows ----------

function buildHours(om) {
  const { time, wind_speed_10m, wind_gusts_10m, precipitation, weather_code,
          temperature_2m, apparent_temperature, relative_humidity_2m } = om.hourly;

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
      isoTime:    time[i],
      windMph:    wind,
      gustMph:    gust,
      precipMm:   precip,
      tempF:      round1(temperature_2m[i]),
      feelsLikeF: round1(apparent_temperature[i]),
      humidity:   Math.round(relative_humidity_2m[i]),
      condition:  wmoToCondition(code),
      skiRating:  getSkiRating(wind, gust, precip, code),
    });
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Claude helpers ----------

async function claudeCall(messages, maxTokens = 300) {
  const body = { model: CLAUDE_MODEL, max_tokens: maxTokens, messages };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
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

// Hourly outlook summary — only for daylight (skiable) hours
async function generateSummary(hours, timeframeLabel) {
  const snippet = hours
    .map((h) => `${h.isoTime.slice(11)} — ${h.tempF}°F, wind ${h.windMph} mph, gusts ${h.gustMph} mph, ${h.condition} (${h.skiRating})`)
    .join("\n");

  return claudeCall([{
    role: "user",
    content:
      "You are a local expert on Lake Stevens, Washington water ski conditions. " +
      `Given this forecast for skiable daylight hours (${timeframeLabel}), write a 2-3 sentence plain-English outlook. ` +
      "Mention the best windows for skiing and any warnings. Only recommend times within this daylight window. " +
      "Be direct, like a local would talk. " +
      "Do not include preamble or markdown — just the prose summary.\n\n" +
      `Forecast:\n${snippet}`,
  }]);
}

// Pro skier launch quip (called once per day)
async function generateProQuip(hours) {
  const bestRating = hours[0]?.skiRating ?? "Unknown";
  const avgWind = round1(hours.slice(0, 12).reduce((s, h) => s + h.windMph, 0) / Math.min(hours.length, 12));
  const tempRange = hours.slice(0, 12).reduce((acc, h) => {
    acc.min = Math.min(acc.min, h.tempF);
    acc.max = Math.max(acc.max, h.tempF);
    return acc;
  }, { min: 999, max: -999 });

  const response = await claudeCall([{
    role: "user",
    content:
      "Generate JSON (no markdown, just raw JSON) with these fields:\n" +
      "1. \"proName\": The full name of a famous professional water skier or wakeboarder (real person, pick a different one each time — e.g. Andy Mapple, Freddy Krueger, Dallas Friday, Shaun Murray, Parks Bonifay, Darin Shapiro, etc.)\n" +
      "2. \"proAccomplishment\": One sentence about their most notable professional accomplishment.\n" +
      "3. \"launchQuip\": A 1-2 sentence recommendation about whether to launch the boat today, written in the voice/personality of that pro skier. Based on these conditions: " +
      `overall rating is ${bestRating}, avg wind ${avgWind} mph, temps ${tempRange.min}–${tempRange.max}°F. ` +
      "Be colorful and in-character but honest about the conditions.\n\n" +
      "Respond with ONLY valid JSON like: {\"proName\": \"...\", \"proAccomplishment\": \"...\", \"launchQuip\": \"...\"}",
  }], 250);

  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { proName: "", proAccomplishment: "", launchQuip: "" };
  }
}

// ---------- Daylight helpers ----------

function getSunTimes(om) {
  // Open-Meteo daily returns arrays of ISO strings like "2026-04-29T05:45"
  const { sunrise, sunset } = om.daily;
  const dates = om.daily.time; // ["2026-04-29", "2026-04-30", ...]
  const result = {};
  for (let i = 0; i < dates.length; i++) {
    result[dates[i]] = { sunrise: sunrise[i], sunset: sunset[i] };
  }
  return result;
}

// Filter hours to only daylight (dawn-1h to dusk+1h). If current time is after
// today's dusk+1h, return tomorrow's daylight hours instead.
function getDaylightHours(hours, sunTimes) {
  const now = currentPacificHour();
  const today = now.slice(0, 10);
  const todaySun = sunTimes[today];

  if (todaySun) {
    const dawnHour = parseInt(todaySun.sunrise.slice(11, 13), 10) - 1;
    const duskHour = parseInt(todaySun.sunset.slice(11, 13), 10) + 1;
    const currentHr = parseInt(now.slice(11, 13), 10);

    // If it's still within today's usable window, filter today's hours
    if (currentHr <= duskHour) {
      const filtered = hours.filter((h) => {
        const date = h.isoTime.slice(0, 10);
        const hr = parseInt(h.isoTime.slice(11, 13), 10);
        if (date !== today) return false;
        return hr >= Math.max(dawnHour, currentHr) && hr <= duskHour;
      });
      if (filtered.length > 0) {
        return {
          hours: filtered,
          isNextDay: false,
          sunrise: todaySun.sunrise,
          sunset: todaySun.sunset,
        };
      }
    }
  }

  // After dark or no today hours left — use tomorrow
  const tomorrow = new Date(new Date(today + "T12:00:00").getTime() + 86400000)
    .toISOString().slice(0, 10);
  const tmrwSun = sunTimes[tomorrow];
  if (!tmrwSun) {
    // Fallback: return first 12 hours
    return { hours: hours.slice(0, SUMMARY_HOURS), isNextDay: false,
             sunrise: todaySun?.sunrise ?? "", sunset: todaySun?.sunset ?? "" };
  }

  const dawnHour = parseInt(tmrwSun.sunrise.slice(11, 13), 10) - 1;
  const duskHour = parseInt(tmrwSun.sunset.slice(11, 13), 10) + 1;

  const filtered = hours.filter((h) => {
    const date = h.isoTime.slice(0, 10);
    const hr = parseInt(h.isoTime.slice(11, 13), 10);
    if (date !== tomorrow) return false;
    return hr >= dawnHour && hr <= duskHour;
  });

  return {
    hours: filtered.length > 0 ? filtered : hours.slice(0, SUMMARY_HOURS),
    isNextDay: true,
    sunrise: tmrwSun.sunrise,
    sunset: tmrwSun.sunset,
  };
}

function formatTimeLabel(isoTime) {
  const hr = parseInt(isoTime.slice(11, 13), 10);
  const min = isoTime.slice(14, 16);
  const suffix = hr >= 12 ? "PM" : "AM";
  const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${h12}:${min} ${suffix}`;
}

// ---------- Blob read/upload ----------

function getBlobClient() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING not set");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  return { container, blob: container.getBlockBlobClient(BLOB_NAME) };
}

async function readExistingBlob() {
  try {
    const { blob } = getBlobClient();
    const response = await blob.download(0);
    const chunks = [];
    for await (const chunk of response.readableStreamBody) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

async function uploadBlob(payload) {
  const { container, blob } = getBlobClient();
  await container.createIfNotExists();
  const json = JSON.stringify(payload);
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

  // Extract sunrise/sunset data
  const sunTimes = getSunTimes(om);
  const daylight = getDaylightHours(hours, sunTimes);
  console.log(`[fetch-forecast] daylight hours: ${daylight.hours.length}, nextDay: ${daylight.isNextDay}`);

  // Build timeframe label
  const timeframePrefix = daylight.isNextDay ? "Tomorrow" : "Today";
  const sunriseLabel = formatTimeLabel(daylight.sunrise);
  const sunsetLabel = formatTimeLabel(daylight.sunset);
  const summaryTimeframe = `${timeframePrefix} · ${sunriseLabel} – ${sunsetLabel}`;

  // Read existing blob to check MOTD date
  const existing = await readExistingBlob();
  const today = currentPacificDate();

  // Generate outlook summary (every hour) — only for daylight hours
  let summary = "";
  try {
    summary = await generateSummary(daylight.hours, summaryTimeframe);
    console.log(`[fetch-forecast] summary: ${summary.slice(0, 80)}…`);
  } catch (err) {
    console.warn(`[fetch-forecast] Claude summary failed: ${err.message}`);
  }

  // Generate pro skier quip only once per day
  let proName = "";
  let proAccomplishment = "";
  let launchQuip = "";
  let quipDate = today;

  if (existing?.quipDate === today && existing?.launchQuip) {
    proName = existing.proName || "";
    proAccomplishment = existing.proAccomplishment || "";
    launchQuip = existing.launchQuip || "";
    console.log(`[fetch-forecast] reusing today's pro quip`);
  } else {
    try {
      const quipResult = await generateProQuip(hours);
      proName = quipResult.proName || "";
      proAccomplishment = quipResult.proAccomplishment || "";
      launchQuip = quipResult.launchQuip || "";
      console.log(`[fetch-forecast] new pro quip from ${proName}`);
    } catch (err) {
      console.warn(`[fetch-forecast] Claude pro quip failed: ${err.message}`);
    }
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    summary,
    summaryTimeframe,
    sunrise: daylight.sunrise,
    sunset: daylight.sunset,
    proName,
    proAccomplishment,
    launchQuip,
    quipDate,
    hours,
  };

  await uploadBlob(payload);
  console.log(`[fetch-forecast] uploaded ${CONTAINER}/${BLOB_NAME}`);
}

main().catch((err) => {
  console.error(`[fetch-forecast] FAILED: ${err.message}`);
  process.exit(1);
});
