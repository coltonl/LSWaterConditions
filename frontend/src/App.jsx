import { useState, useEffect, useCallback } from "react";
import { dayLabel, parseLocalISO } from "./lib/time";
import { ratingMeta } from "./lib/rating";
import NowCard from "./components/NowCard";
import DayTabs from "./components/DayTabs";
import HourRow from "./components/HourRow";
import Legend from "./components/Legend";

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dayFilter, setDayFilter] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(import.meta.env.VITE_FORECAST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Forecast unavailable (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive decorated hours
  const hours = data?.hours?.map((h) => {
    const label = dayLabel(h.isoTime);
    const d = parseLocalISO(h.isoTime);
    const now = new Date();
    const isPast = d.getTime() < now.getTime() - 30 * 60_000;
    const isCurrent =
      d.getHours() === now.getHours() &&
      d.toDateString() === now.toDateString();
    return { ...h, dayLabel: label, isPast, isCurrent };
  }) ?? [];

  // Unique day labels for tabs
  const days = [...new Set(hours.map((h) => h.dayLabel))];
  const activeDay = dayFilter ?? days[0] ?? "Today";

  // Filter hours by active tab
  const visibleHours = hours.filter((h) => h.dayLabel === activeDay);

  // Current hour for the NowCard (first non-past hour, or the current-flagged one)
  const currentHour = hours.find((h) => h.isCurrent) ?? hours.find((h) => !h.isPast) ?? hours[0];

  // Only show "current" highlight when viewing Today
  const isToday = activeDay === "Today";

  return (
    <div className="app">
      <div className="app__noise" />
      <div className="app__inner">
        <header className="header">
          <div className="header__eyebrow">Lake Stevens, WA</div>
          <h1 className="header__title">Should I Launch the Boat?</h1>
          <p className="header__sub">Hourly wind & forecast</p>
        </header>

        {loading && (
          <div className="state-loading">
            <div className="state-loading__icon">🌊</div>
            <div className="state-loading__msg">Loading forecast…</div>
          </div>
        )}

        {error && (
          <div className="state-error">
            <div className="state-error__msg">{error}</div>
            <button className="state-error__retry" onClick={load}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <NowCard
              hour={currentHour}
              summary={data.summary}
              fetchedAt={data.fetchedAt}
              proName={data.proName}
              launchQuip={data.launchQuip}
              summaryTimeframe={data.summaryTimeframe}
              sunrise={data.sunrise}
              sunset={data.sunset}
            />

            <DayTabs days={days} active={activeDay} onChange={setDayFilter} />

            <div className="hours">
              {visibleHours.map((h) => (
                <HourRow
                  key={h.isoTime}
                  hour={h}
                  isCurrent={isToday && h.isCurrent}
                  isPast={isToday && h.isPast}
                />
              ))}
            </div>

            <Legend />

            <footer className="footer">
              Data from Open-Meteo • Outlook by Claude
              <div>
                <button className="footer__refresh" onClick={load}>
                  ↻ Refresh
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
