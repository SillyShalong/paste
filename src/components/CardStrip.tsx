import { useStore } from "../store/useStore";
import ClipboardCard from "./ClipboardCard";

export default function CardStrip() {
  const clips = useStore((s) => s.clips);
  const sel = useStore((s) => s.sel);
  const query = useStore((s) => s.query);

  if (clips.length === 0) {
    return (
      <div className="card-strip empty">
        <EmptyState query={query} />
      </div>
    );
  }

  return (
    <div className="card-strip">
      <div className="cards-row">
        {clips.map((clip, i) => (
          <ClipboardCard key={clip.id} clip={clip} index={i} selected={i === sel} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="empty-state">
      <ClipboardGlyph />
      <h2>{query ? "No matches found" : "Your clipboard history is empty"}</h2>
      <p>
        {query
          ? `Nothing in your history matches “${query}”.`
          : "Copy something anywhere in Windows and it will show up here instantly."}
      </p>
    </div>
  );
}

function ClipboardGlyph() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <rect x="9" y="2" width="6" height="4" rx="1.4" fill="currentColor" stroke="none" opacity="0.9" />
      <line x1="8.5" y1="10" x2="15.5" y2="10" strokeLinecap="round" />
      <line x1="8.5" y1="13.5" x2="15.5" y2="13.5" strokeLinecap="round" />
      <line x1="8.5" y1="17" x2="12.5" y2="17" strokeLinecap="round" />
    </svg>
  );
}
