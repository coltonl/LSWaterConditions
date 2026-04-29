export default function DayTabs({ days, active, onChange }) {
  if (!days || days.length <= 1) return null;

  return (
    <nav className="day-tabs" aria-label="Forecast days">
      {days.map((day) => (
        <button
          key={day}
          className={`day-tabs__btn${day === active ? " day-tabs__btn--active" : ""}`}
          onClick={() => onChange(day)}
          aria-pressed={day === active}
        >
          {day}
        </button>
      ))}
    </nav>
  );
}
