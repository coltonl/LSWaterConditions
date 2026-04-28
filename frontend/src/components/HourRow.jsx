import { ratingMeta } from "../lib/rating";
import { formatHour } from "../lib/time";

export default function HourRow({ hour, isCurrent, isPast }) {
  const meta = ratingMeta(hour.skiRating);

  let className = "hour";
  if (isPast) className += " hour--past";
  if (isCurrent) className += " hour--current";

  return (
    <div className={className} style={{ "--rating": meta.color }}>
      <span className="hour__time">{formatHour(hour.isoTime)}</span>
      <span className="hour__rating">
        <span className="hour__dot" />
        {hour.skiRating}
        <span className="hour__condition">{hour.condition}</span>
      </span>
      <span className="hour__wind">{hour.windMph} mph</span>
      <span className="hour__gust">G {hour.gustMph}</span>
    </div>
  );
}
