import { ratingMeta } from "../lib/rating";
import { formatHour, formatFetchedAt } from "../lib/time";
import { conditionToIcon } from "../lib/weather-icons";

export default function NowCard({
  hour,
  outlook,
  summary,
  fetchedAt,
  expertOpinion,
  proName,
  launchQuip,
  summaryTimeframe,
  sunrise,
  sunset,
  waterTemp,
}) {
  if (!hour) return null;
  const meta = ratingMeta(hour.skiRating);
  const weatherIcon = conditionToIcon(hour.condition, hour.isoTime, sunrise, sunset);
  const headline = outlook?.headline || summary || meta.note;
  const bestWindow = outlook?.bestWindow || summaryTimeframe;
  const watchOut = outlook?.watchOut;
  const expertName = expertOpinion?.proName || proName;
  const expertText = expertOpinion?.text || launchQuip;
  const updatedAt = formatFetchedAt(fetchedAt);
  const waterTempLabel = waterTemp?.tempF
    ? `${waterTemp.tempF}°F${waterTemp.stale ? " stale" : ""}`
    : "Daily AM";

  return (
    <section
      className="verdict-card"
      style={{ "--now-tint": `${meta.color}11`, "--rating": meta.color }}
      aria-label="Launch verdict"
    >
      <div className="verdict-card__top">
        <div className="verdict-card__decision">
          <div className="verdict-card__eyebrow">Launch Verdict</div>
          <div className="verdict-card__verdict">{meta.verdict}</div>
          <div className="verdict-card__rating">
            <span className="verdict-card__dot" />
            {hour.skiRating}
          </div>
        </div>
        <div className="verdict-card__weather" aria-label={hour.condition}>
          <div className="verdict-card__weather-icon">{weatherIcon}</div>
          <div className="verdict-card__condition">{hour.condition}</div>
          <div className="verdict-card__time">{formatHour(hour.isoTime)}</div>
        </div>
      </div>

      <div className="verdict-card__outlook">
        <div className="verdict-card__outlook-label">Captain's brief</div>
        <p className="verdict-card__headline">{headline}</p>
        <div className="verdict-card__microgrid">
          {bestWindow && (
            <span className="verdict-card__microcopy">
              <strong>Best:</strong> {bestWindow}
            </span>
          )}
          {watchOut && (
            <span className="verdict-card__microcopy verdict-card__microcopy--warn">
              {watchOut}
            </span>
          )}
        </div>
      </div>

      <div className="verdict-card__stats" aria-label="Current conditions">
        <Stat label="Wind" value={`${hour.windMph} mph`} />
        <Stat label="Gusts" value={`${hour.gustMph} mph`} emphasis={hour.gustMph > 15} />
        <Stat label="Air" value={`${hour.tempF}°F`} />
        <Stat label="Water" value={waterTempLabel} muted={!waterTemp?.tempF} />
      </div>

      {expertText && (
        <aside className="verdict-card__expert" aria-label="Expert opinion">
          {expertName && (
            <div className="verdict-card__expert-name">
              {expertName} says:
            </div>
          )}
          <p className="verdict-card__expert-quote">"{expertText}"</p>
        </aside>
      )}

      {updatedAt && (
        <div className="verdict-card__updated">
          Updated {updatedAt} · Outlook and expert opinion refresh hourly
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, emphasis = false, muted = false }) {
  let className = "verdict-card__stat";
  if (emphasis) className += " verdict-card__stat--emphasis";
  if (muted) className += " verdict-card__stat--muted";

  return (
    <div className={className}>
      <div className="verdict-card__stat-label">{label}</div>
      <div className="verdict-card__stat-value">{value}</div>
    </div>
  );
}
