import { ratingMeta } from "../lib/rating";
import { formatHour } from "../lib/time";
import { conditionToIcon } from "../lib/weather-icons";

export default function HourRow({ hour, isCurrent, isPast, isBest, sunrise, sunset }) {
  const meta = ratingMeta(hour.skiRating);
  const icon = conditionToIcon(hour.condition, hour.isoTime, sunrise, sunset);

  let className = "hour";
  if (isPast) className += " hour--past";
  if (isCurrent) className += " hour--current";
  if (isBest) className += " hour--best";

  return (
    <li className={className} style={{ "--rating": meta.color }}>
      <div className="hour__time">{formatHour(hour.isoTime)}</div>
      <div className="hour__weather" aria-label={hour.condition}>{icon}</div>
      <div className="hour__primary">
        <div className="hour__rating">
          <span className="hour__dot" />
          {hour.skiRating}
          {isBest && <span className="hour__badge">Best glass</span>}
        </div>
        <div className="hour__condition">{hour.condition}</div>
      </div>
      <div className="hour__temp">{hour.tempF}°</div>
      <div className="hour__wind">
        <span>{hour.windMph} mph</span>
        <span className="hour__gust">G {hour.gustMph}</span>
      </div>
    </li>
  );
}
