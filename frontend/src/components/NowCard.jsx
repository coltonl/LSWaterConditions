import { ratingMeta } from "../lib/rating";
import { formatHour, formatFetchedAt } from "../lib/time";
import { conditionToIcon } from "../lib/weather-icons";

export default function NowCard({ hour, summary, fetchedAt, proName, launchQuip, summaryTimeframe, sunrise, sunset }) {
  if (!hour) return null;
  const meta = ratingMeta(hour.skiRating);
  const weatherIcon = conditionToIcon(hour.condition, hour.isoTime, sunrise, sunset);

  return (
    <section
      className="now"
      style={{ "--now-tint": `${meta.color}11`, "--rating": meta.color }}
    >
      <div className="now__top">
        <div>
          <div className="now__eyebrow">Right Now</div>
          <div className="now__weather-icon">{weatherIcon}</div>
          <div className="now__rating" style={{ color: meta.color }}>
            {hour.skiRating}
          </div>
          <div className="now__condition">{hour.condition}</div>
        </div>
        <div className="now__stats">
          <div className="now__stat">
            <div className="now__stat-label">Temp</div>
            <div className="now__stat-value">{hour.tempF}°F</div>
          </div>
          <div className="now__stat">
            <div className="now__stat-label">Feels Like</div>
            <div className="now__stat-value">{hour.feelsLikeF}°F</div>
          </div>
          <div className="now__stat">
            <div className="now__stat-label">Wind</div>
            <div className="now__stat-value">{hour.windMph} mph</div>
          </div>
          <div className="now__stat">
            <div className="now__stat-label">Gusts</div>
            <div className="now__stat-value">{hour.gustMph} mph</div>
          </div>
        </div>
      </div>

      {summary ? (
        <div className="now__outlook">
          <div className="now__outlook-eyebrow">
            Outlook{summaryTimeframe ? ` · ${summaryTimeframe}` : ""}
          </div>
          <p className="now__outlook-text">{summary}</p>
        </div>
      ) : (
        <div className="now__outlook">
          <p className="now__outlook-text now__outlook-text--muted">
            AI outlook temporarily unavailable
          </p>
        </div>
      )}

      {launchQuip && (
        <div className="now__pro-quip">
          {proName && (
            <div className="now__pro-header">
              <span className="now__pro-name">{proName} says:</span>
            </div>
          )}
          <p className="now__pro-quote">"{launchQuip}"</p>
        </div>
      )}

      {fetchedAt && (
        <div className="now__outlook-eyebrow" style={{ marginTop: "12px" }}>
          Updated {formatFetchedAt(fetchedAt)}
        </div>
      )}
    </section>
  );
}
