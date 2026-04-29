import { LEGEND } from "../lib/rating";

export default function Legend() {
  return (
    <aside className="legend" aria-label="Rating legend">
      <div className="legend__title">How we judge questionable choices</div>
      {LEGEND.map(({ label, color, note }) => (
        <span key={label} className="legend__item" style={{ "--rating": color }}>
          <span className="legend__dot" />
          <span className="legend__label">{label}</span>
          <span className="legend__note">{note}</span>
        </span>
      ))}
    </aside>
  );
}
