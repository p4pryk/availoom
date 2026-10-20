import type { Provider } from "../domain";
export const colors: Record<Provider, string> = {
  Codex: "#92cdb7",
  Claude: "#d5a58c",
  Gemini: "#a4b5eb",
  Grok: "#c0c4cc",
};
export function AvailoomMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect
        x="8"
        y="3"
        width="16"
        height="26"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <rect x="11" y="17" width="10" height="9" rx="1.8" fill="currentColor" />
      <path
        d="M12 7h8"
        stroke="currentColor"
        strokeOpacity=".48"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function ProviderMark({ provider }: { provider: Provider }) {
  return (
    <span
      className={`provider-mark mark-${provider.toLowerCase()}`}
      aria-hidden="true"
    >
      {provider === "Codex" ? (
        <svg viewBox="0 0 24 24">
          <path d="m9 6-5 6 5 6m6-12 5 6-5 6" />
        </svg>
      ) : provider === "Claude" ? (
        <svg viewBox="0 0 24 24">
          {Array.from({ length: 10 }, (_, i) => (
            <path key={i} d="M12 3v5" transform={`rotate(${i * 36} 12 12)`} />
          ))}
        </svg>
      ) : provider === "Gemini" ? (
        <svg viewBox="0 0 24 24">
          <path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M18 5 6 19m-1-8a7 7 0 0 1 11-6m3 6a7 7 0 0 1-11 8" />
        </svg>
      )}
    </span>
  );
}
export function Gauge({
  value,
  color,
}: {
  value: number | null;
  color: string;
}) {
  const c = 2 * Math.PI * 52;
  return (
    <svg className="gauge" viewBox="0 0 128 128" aria-hidden="true">
      <circle className="gauge-track" cx="64" cy="64" r="52" />
      {value !== null && value > 0 && (
        <circle
          cx="64"
          cy="64"
          r="52"
          stroke={color}
          strokeDasharray={`${(value / 100) * c} ${c}`}
          transform="rotate(-90 64 64)"
        />
      )}
      <circle className="gauge-inner" cx="64" cy="64" r="42" />
    </svg>
  );
}
