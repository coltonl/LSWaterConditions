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
const FORECAST_DAYS = 7;
const WATER_TEMP_URL = "https://lakemonster.com/lake/WA/Lake%20Stevens-water-temperature-961";
const WATER_TEMP_SOURCE = "LakeMonster";
const WATER_TEMP_REFRESH_START_HOUR = 5;
const WATER_TEMP_REFRESH_END_HOUR = 10;

const RATING_SCORE = {
  Excellent: 5,
  Good: 4,
  Fair: 3,
  Poor: 2,
  Dangerous: 1,
  Unknown: 0,
};

// ---------- Open-Meteo ----------

async function fetchOpenMeteo() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude",  String(LAT));
  url.searchParams.set("longitude", String(LON));
  url.searchParams.set("hourly", "wind_speed_10m,wind_gusts_10m,precipitation,weather_code,temperature_2m,apparent_temperature,relative_humidity_2m");
  url.searchParams.set("daily", "sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
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

function currentPacificHourNumber() {
  return parseInt(currentPacificHour().slice(11, 13), 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- Build per-hour rows ----------

function buildHours(om, limit = HOURS_AHEAD) {
  const { time, wind_speed_10m, wind_gusts_10m, precipitation, weather_code,
           temperature_2m, apparent_temperature, relative_humidity_2m } = om.hourly;

  if (![time, wind_speed_10m, wind_gusts_10m, precipitation, weather_code, temperature_2m, apparent_temperature, relative_humidity_2m].every(Array.isArray)) {
    throw new Error("Open-Meteo response missing expected hourly arrays");
  }

  const startHour = currentPacificHour();
  let startIdx = time.findIndex((t) => t >= startHour);
  if (startIdx === -1) startIdx = 0;

  const end = Math.min(startIdx + limit, time.length);
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

function definedNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// ---------- Daily / weekly helpers ----------

function bestRatingForHours(hours) {
  return hours.reduce((best, hour) => {
    if (RATING_SCORE[hour.skiRating] > RATING_SCORE[best]) return hour.skiRating;
    return best;
  }, "Unknown");
}

function bestWindowForHours(hours) {
  if (!hours.length) return "";

  const bestRating = bestRatingForHours(hours);
  if (bestRating === "Unknown") return "";

  const bestHours = hours.filter((h) => h.skiRating === bestRating);
  let bestRun = [];
  let currentRun = [];

  for (const hour of bestHours) {
    const previous = currentRun[currentRun.length - 1];
    const previousHour = previous ? parseInt(previous.isoTime.slice(11, 13), 10) : null;
    const hourNumber = parseInt(hour.isoTime.slice(11, 13), 10);

    if (!previous || hourNumber === previousHour + 1) {
      currentRun.push(hour);
    } else {
      if (currentRun.length > bestRun.length) bestRun = currentRun;
      currentRun = [hour];
    }
  }
  if (currentRun.length > bestRun.length) bestRun = currentRun;

  const run = bestRun.length ? bestRun : bestHours.slice(0, 1);
  const start = run[0].isoTime;
  const lastHour = parseInt(run[run.length - 1].isoTime.slice(11, 13), 10);
  const end = `${run[run.length - 1].isoTime.slice(0, 11)}${String(Math.min(lastHour + 1, 23)).padStart(2, "0")}:00:00`;
  return `${formatTimeLabel(start)}-${formatTimeLabel(end)}`;
}

function formatDayLabel(date, today) {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d);
}

function buildDailyForecast(om, allHours) {
  const daily = om.daily;
  const dates = daily?.time;
  if (!Array.isArray(dates)) throw new Error("Open-Meteo response missing daily time array");

  const today = currentPacificDate();
  return dates.slice(0, FORECAST_DAYS).map((date, i) => {
    const dayHours = allHours.filter((h) => h.isoTime.startsWith(date));
    const bestRating = bestRatingForHours(dayHours);
    const bestWindow = bestWindowForHours(dayHours);
    const weatherCode = daily.weather_code?.[i];

    return {
      date,
      label: formatDayLabel(date, today),
      condition: wmoToCondition(weatherCode),
      weatherCode,
      tempHighF: definedNumber(daily.temperature_2m_max?.[i]) ? round1(daily.temperature_2m_max[i]) : null,
      tempLowF: definedNumber(daily.temperature_2m_min?.[i]) ? round1(daily.temperature_2m_min[i]) : null,
      precipChance: definedNumber(daily.precipitation_probability_max?.[i]) ? Math.round(daily.precipitation_probability_max[i]) : null,
      maxWindMph: definedNumber(daily.wind_speed_10m_max?.[i]) ? round1(daily.wind_speed_10m_max[i]) : null,
      maxGustMph: definedNumber(daily.wind_gusts_10m_max?.[i]) ? round1(daily.wind_gusts_10m_max[i]) : null,
      bestRating,
      bestWindow,
      summary: dailyForecastSummary(bestRating, bestWindow, daily.precipitation_probability_max?.[i], daily.wind_gusts_10m_max?.[i]),
    };
  });
}

function dailyForecastSummary(bestRating, bestWindow, precipChance, maxGustMph) {
  const windowText = bestWindow ? `Best ${bestWindow}.` : "No obvious glass window.";
  if (bestRating === "Dangerous") return "Dangerous weather risk. Keep the boat out of the plot.";
  if (bestRating === "Poor") return `${windowText} Conditions look more chore than sport.`;
  if (definedNumber(precipChance) && precipChance >= 60) return `${windowText} Rain may try to become the main character.`;
  if (definedNumber(maxGustMph) && maxGustMph >= 18) return `${windowText} Watch gusts before they start freelancing.`;
  if (bestRating === "Excellent") return `${windowText} Prime launch material.`;
  if (bestRating === "Good") return `${windowText} Worth a lap before the lake gets ideas.`;
  return `${windowText} Skiable if your standards are emotionally flexible.`;
}

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

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Response did not include JSON");
    return JSON.parse(match[0]);
  }
}

function fallbackOutlook(hours, timeframeLabel) {
  const bestRating = bestRatingForHours(hours);
  const bestWindow = bestWindowForHours(hours);
  const windier = hours.find((h) => h.gustMph > 15 || h.windMph > 10);
  const headlineByRating = {
    Excellent: "Go early before the lake remembers it has weather.",
    Good: "Launchable, with just enough texture to keep egos honest.",
    Fair: "Your call, captain. The lake has notes.",
    Poor: "Dock energy is the responsible aesthetic.",
    Dangerous: "Nope. The boat can stay on the trailer.",
    Unknown: "Forecast is thin, so keep one hand on common sense.",
  };
  const watchOut = windier
    ? `Gusts build around ${formatTimeLabel(windier.isoTime)}.`
    : "Nothing dramatic in the skiable window.";
  return {
    headline: headlineByRating[bestRating],
    bestWindow: bestWindow || timeframeLabel,
    watchOut,
  };
}

function normalizeOutlook(outlook, fallback) {
  return {
    headline: String(outlook.headline || fallback.headline || "").trim(),
    bestWindow: String(outlook.bestWindow || fallback.bestWindow || "").trim(),
    watchOut: String(outlook.watchOut || fallback.watchOut || "").trim(),
  };
}

function outlookToSummary(outlook) {
  return [outlook.headline, outlook.bestWindow ? `Best window: ${outlook.bestWindow}.` : "", outlook.watchOut]
    .filter(Boolean)
    .join(" ");
}

// Hourly outlook — only for daylight (skiable) hours
async function generateOutlook(hours, timeframeLabel) {
  const snippet = hours
    .map((h) => `${h.isoTime.slice(11)} — ${h.tempF}°F, wind ${h.windMph} mph, gusts ${h.gustMph} mph, ${h.condition} (${h.skiRating})`)
    .join("\n");
  const fallback = fallbackOutlook(hours, timeframeLabel);

  const response = await claudeCall([{
    role: "user",
    content:
      "You are a local expert on Lake Stevens, Washington water ski conditions. " +
      `Given this forecast for skiable daylight hours (${timeframeLabel}), write concise launch guidance. ` +
      "Return ONLY valid JSON with string fields: headline, bestWindow, watchOut. " +
      "headline must be one short readable line. bestWindow must be a compact time window or short phrase. " +
      "watchOut must be one short warning, or an empty string if nothing matters. " +
      "Be dry, direct, and useful. No markdown, no preamble, no long paragraph.\n\n" +
      `Forecast:\n${snippet}`,
  }], 220);

  return normalizeOutlook(parseJsonObject(response), fallback);
}

async function generateWeeklySummary(dailyForecast) {
  const snippet = dailyForecast
    .map((d) => `${d.label} ${d.date}: ${d.condition}, ${d.tempLowF ?? "?"}-${d.tempHighF ?? "?"}°F, wind ${d.maxWindMph ?? "?"} mph, gusts ${d.maxGustMph ?? "?"} mph, precip ${d.precipChance ?? "?"}%, best ${d.bestRating}${d.bestWindow ? ` ${d.bestWindow}` : ""}`)
    .join("\n");

  const fallback = fallbackWeeklySummary(dailyForecast);
  const response = await claudeCall([{
    role: "user",
    content:
      "You summarize a 7-day Lake Stevens water-ski weather forecast. " +
      "Return ONLY valid JSON with string fields: headline and text. " +
      "headline must be short. text must be one concise sentence that calls out the best day/window and major weather warning. " +
      "Useful first, lightly witty second. No markdown.\n\n" +
      `Forecast:\n${snippet}`,
  }], 220);

  const parsed = parseJsonObject(response);
  return {
    headline: String(parsed.headline || fallback.headline).trim(),
    days: dailyForecast.length ? `${dailyForecast[0].label}-${dailyForecast[dailyForecast.length - 1].label}` : "",
    text: String(parsed.text || fallback.text).trim(),
  };
}

function fallbackWeeklySummary(dailyForecast) {
  const bestDay = dailyForecast.reduce((best, day) => {
    if (RATING_SCORE[day.bestRating] > RATING_SCORE[best.bestRating]) return day;
    return best;
  }, dailyForecast[0] ?? { label: "This week", bestRating: "Unknown", bestWindow: "" });
  return {
    headline: "The week has a favorite.",
    days: dailyForecast.length ? `${dailyForecast[0].label}-${dailyForecast[dailyForecast.length - 1].label}` : "",
    text: `${bestDay.label}${bestDay.bestWindow ? ` ${bestDay.bestWindow}` : ""} looks like the best launch window. The rest of the week should submit a stronger resume.`,
  };
}

// Pro skier launch quip (called every hourly run)
async function generateExpertOpinion(hours, outlook) {
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
      "1. \"proName\": The full name of a famous professional water skier or wakeboarder (real person, pick a different one each time — e.g. Andy Mapple, Freddy Krueger, Dallas Friday, Shaun Murray, Parks Bonifay, Darin Shapiro, Regina Jaquess, Nate Smith, Whitney McClintock, etc.)\n" +
      "2. \"text\": A 1-2 line recommendation about whether to launch the boat, written as if this pro is your personal caddy/advisor. " +
      "Tone: dry, clever, intelligent-comedian funny, confident wit. NO puns, NO dad jokes, NO exclamation marks, NO forced enthusiasm. " +
      "You may be broadly inspired by weather and the mood of current events, but do not cite specific news unless provided. " +
      "The audience owns boats and appreciates sharp, understated humor. Be genuinely funny through observation and specificity. " +
      "If conditions are poor or dangerous, be absolutely clear that launching is a bad idea. " +
      "Based on conditions: " +
      `overall rating is ${bestRating}, avg wind ${avgWind} mph, temps ${tempRange.min}–${tempRange.max}°F, outlook headline: ${outlook?.headline ?? ""}.\n\n` +
      "Respond with ONLY valid JSON like: {\"proName\": \"...\", \"text\": \"...\"}",
  }], 200);

  try {
    return normalizeExpertOpinion(parseJsonObject(response), bestRating);
  } catch {
    return fallbackExpertOpinion(bestRating);
  }
}

function normalizeExpertOpinion(opinion, rating) {
  const fallback = fallbackExpertOpinion(rating);
  return {
    proName: String(opinion.proName || fallback.proName).trim(),
    text: String(opinion.text || opinion.launchQuip || fallback.text).trim(),
  };
}

function fallbackExpertOpinion(rating) {
  const textByRating = {
    Excellent: "Launch it. If you wait, someone with worse form is taking the good water.",
    Good: "Worth a pull. Not perfect, but neither was your last dock start.",
    Fair: "Possible, if your standards packed a lunch and lowered themselves.",
    Poor: "Leave it on the trailer unless the plan is to inventory every loose item in the boat.",
    Dangerous: "Hard no. Even bad ideas deserve better weather.",
    Unknown: "The forecast is being coy. Make coffee before making decisions.",
  };
  return { proName: "The Dock Committee", text: textByRating[rating] ?? textByRating.Unknown };
}

// ---------- Water temperature ----------

async function fetchWaterTemp(existing) {
  const today = currentPacificDate();
  const hour = currentPacificHourNumber();
  const existingTemp = existing?.waterTemp ?? null;
  const existingDate = existingTemp?.date ?? existingTemp?.fetchedAt?.slice(0, 10) ?? existingTemp?.observedAt?.slice(0, 10);

  if (existingDate === today) {
    return { ...existingTemp, stale: false };
  }

  const isMorningWindow = hour >= WATER_TEMP_REFRESH_START_HOUR && hour <= WATER_TEMP_REFRESH_END_HOUR;
  if (!isMorningWindow) {
    return existingTemp ? { ...existingTemp, stale: true } : null;
  }

  try {
    const res = await fetch(WATER_TEMP_URL, {
      headers: {
        "User-Agent": "LSWaterConditions/1.0 (+https://github.com/coltonl/LSWaterConditions)",
        "Accept": "text/html,text/plain",
      },
    });
    if (!res.ok) throw new Error(`LakeMonster ${res.status}: ${await res.text()}`);
    const html = await res.text();
    const tempF = parseLakeMonsterWaterTemp(html);
    return {
      tempF,
      source: WATER_TEMP_SOURCE,
      date: today,
      observedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  } catch (err) {
    console.warn(`[fetch-forecast] water temp failed: ${err.message}`);
    return existingTemp ? { ...existingTemp, stale: true } : null;
  }
}

function parseLakeMonsterWaterTemp(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&deg;/g, "°")
    .replace(/\s+/g, " ")
    .trim();

  const patterns = [
    /Water\s+(\d{2,3})\s*°/i,
    /Water\s+Temperature\s+(\d{2,3})\s*°/i,
    /"waterTemp(?:erature)?"\s*:\s*(\d{2,3})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern) || html.match(pattern);
    if (match) return Number(match[1]);
  }
  throw new Error("Could not parse LakeMonster water temp");
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
  const fetchedAt = new Date().toISOString();

  console.log(`[fetch-forecast] Open-Meteo for ${LAT},${LON}…`);
  const om = await fetchOpenMeteo();

  const allHours = buildHours(om, 24 * FORECAST_DAYS);
  const hours = allHours.slice(0, HOURS_AHEAD);
  if (!hours.length) throw new Error("No hours produced from Open-Meteo response");
  console.log(`[fetch-forecast] ${hours.length} hours, starting ${hours[0].isoTime}`);

  const dailyForecast = buildDailyForecast(om, allHours);

  // Extract sunrise/sunset data
  const sunTimes = getSunTimes(om);
  const daylight = getDaylightHours(hours, sunTimes);
  console.log(`[fetch-forecast] daylight hours: ${daylight.hours.length}, nextDay: ${daylight.isNextDay}`);

  // Build timeframe label
  const timeframePrefix = daylight.isNextDay ? "Tomorrow" : "Today";
  const sunriseLabel = formatTimeLabel(daylight.sunrise);
  const sunsetLabel = formatTimeLabel(daylight.sunset);
  const summaryTimeframe = `${timeframePrefix} · ${sunriseLabel} – ${sunsetLabel}`;

  // Read existing blob for water-temp reuse
  const existing = await readExistingBlob();
  const today = currentPacificDate();

  // Generate outlook (every hour) — only for daylight hours
  let outlook = fallbackOutlook(daylight.hours, summaryTimeframe);
  try {
    outlook = await generateOutlook(daylight.hours, summaryTimeframe);
    console.log(`[fetch-forecast] outlook: ${outlook.headline.slice(0, 80)}…`);
  } catch (err) {
    console.warn(`[fetch-forecast] Claude outlook failed: ${err.message}`);
  }

  let weeklySummary = fallbackWeeklySummary(dailyForecast);
  try {
    weeklySummary = await generateWeeklySummary(dailyForecast);
    console.log(`[fetch-forecast] weekly summary: ${weeklySummary.headline.slice(0, 80)}…`);
  } catch (err) {
    console.warn(`[fetch-forecast] Claude weekly summary failed: ${err.message}`);
  }

  // Generate pro skier quip every hourly run
  let expertOpinion = fallbackExpertOpinion(hours[0]?.skiRating ?? "Unknown");
  try {
    expertOpinion = await generateExpertOpinion(hours, outlook);
    console.log(`[fetch-forecast] expert opinion from ${expertOpinion.proName}`);
  } catch (err) {
    console.warn(`[fetch-forecast] Claude expert opinion failed: ${err.message}`);
  }

  const waterTemp = await fetchWaterTemp(existing);

  const payload = {
    fetchedAt,
    summary: outlookToSummary(outlook),
    summaryTimeframe,
    outlook: {
      ...outlook,
      updatedAt: fetchedAt,
    },
    sunrise: daylight.sunrise,
    sunset: daylight.sunset,
    proName: expertOpinion.proName,
    launchQuip: expertOpinion.text,
    quipDate: today,
    expertOpinion: {
      ...expertOpinion,
      updatedAt: fetchedAt,
    },
    dailyForecast,
    weeklySummary: {
      ...weeklySummary,
      updatedAt: fetchedAt,
    },
    waterTemp,
    hours,
  };

  await uploadBlob(payload);
  console.log(`[fetch-forecast] uploaded ${CONTAINER}/${BLOB_NAME}`);
}

main().catch((err) => {
  console.error(`[fetch-forecast] FAILED: ${err.message}`);
  process.exit(1);
});
