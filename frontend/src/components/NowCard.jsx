import { ratingMeta } from "../lib/rating";
import { formatHour, formatFetchedAt } from "../lib/time";

export default function NowCard({ hour, summary, fetchedAt }) {
  if (!hour) return null;
  const meta = ratingMeta(hour.skiRating);

  return (
    <section
      className="now"
      style={{ "--now-tint": `${meta.color}11`, "--rating": meta.color }}
    >
      <div className="now__top">
        <div>
          <div className="now__eyebrow">Right Now</div>
          <div className="now__icon">{meta.icon}</div>
          <div className="now__rating" style={{ color: meta.color }}>
            {hour.skiRating}
          </div>
          <div className="now__condition">{hour.condition}</div>
        </div>
        <div className="now__stats">
          <div className="now__stat">
            <div className="now__stat-label">Wind</div>
            <div className="now__stat-value">{hour.windMph} mph</div>
          </div>
          <div className="now__stat">
            <div className="now__stat-label">Gusts</div>
            <div className="now__stat-value">{hour.gustMph} mph</div>
          </div>
          <div className="now__stat">
            <div className="now__stat-label">Precip</div>
            <div className="now__stat-value">{hour.precipMm} mm</div>
          </div>
        </div>
      </div>

      {summary && (
        <div className="now__outlook">
          <div className="now__outlook-eyebrow">Outlook</div>
          <p className="now__outlook-text">{summary}</p>
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
