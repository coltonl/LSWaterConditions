import { LEGEND } from "../lib/rating";

export default function Legend() {
  return (
    <div className="legend">
      {LEGEND.map(({ label, color, note }) => (
        <span key={label} className="legend__item" style={{ "--rating": color }}>
          <span className="legend__dot" />
          <span className="legend__label">{label}</span>
          <span className="legend__note">{note}</span>
        </span>
      ))}
    </div>
  );
}
