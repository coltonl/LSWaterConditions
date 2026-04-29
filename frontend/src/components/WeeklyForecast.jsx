import { ratingMeta } from "../lib/rating";
import { formatShortDate } from "../lib/time";
import { conditionToIcon } from "../lib/weather-icons";

export default function WeeklyForecast({ dailyForecast = [], weeklySummary }) {
  if (!dailyForecast.length && !weeklySummary) return null;

  return (
    <section className="weekly" aria-labelledby="weekly-title">
      <div className="section-heading">
        <div>
          <div className="section-heading__eyebrow">Week ahead</div>
          <h2 id="weekly-title" className="section-heading__title">Launch forecast</h2>
        </div>
        {weeklySummary?.days && <div className="section-heading__meta">{weeklySummary.days}</div>}
      </div>

      {weeklySummary && (
        <div className="weekly__brief">
          <strong>{weeklySummary.headline}</strong>
          <span>{weeklySummary.text}</span>
        </div>
      )}

      <div className="weekly__grid">
        {dailyForecast.map((day) => {
          const meta = ratingMeta(day.bestRating);
          const icon = conditionToIcon(day.condition);
          return (
            <article key={day.date} className="daily-card" style={{ "--rating": meta.color }}>
              <div className="daily-card__top">
                <div>
                  <div className="daily-card__label">{day.label}</div>
                  <div className="daily-card__date">{formatShortDate(day.date)}</div>
                </div>
                <div className="daily-card__icon" aria-label={day.condition}>{icon}</div>
              </div>
              <div className="daily-card__temps">
                {day.tempHighF ?? "–"}° <span>/ {day.tempLowF ?? "–"}°</span>
              </div>
              <div className="daily-card__rating">
                <span className="daily-card__dot" />
                {day.bestRating}
              </div>
              {day.bestWindow && <div className="daily-card__window">{day.bestWindow}</div>}
              <div className="daily-card__details">
                <span>G {day.maxGustMph ?? "–"}</span>
                <span>{day.precipChance ?? "–"}% rain</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
