export default function DayTabs({ days, active, onChange }) {
  if (!days || days.length <= 1) return null;

  return (
    <div className="day-tabs">
      {days.map((day) => (
        <button
          key={day}
          className={`day-tabs__btn${day === active ? " day-tabs__btn--active" : ""}`}
          onClick={() => onChange(day)}
        >
          {day}
        </button>
      ))}
    </div>
  );
}
