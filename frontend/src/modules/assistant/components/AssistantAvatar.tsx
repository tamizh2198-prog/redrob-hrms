// A friendly, humanized face for the assistant bubble — deliberately not
// the company logo, so the bubble reads as "someone to talk to" rather
// than a branding mark. Fully inline SVG, no external image asset.
export function AssistantAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="AI Assistant">
      <defs>
        <linearGradient id="assistant-face-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#assistant-face-bg)" />
      {/* cheeks */}
      <circle cx="16" cy="38" r="5" fill="#ffffff" opacity="0.25" />
      <circle cx="48" cy="38" r="5" fill="#ffffff" opacity="0.25" />
      {/* eyes */}
      <circle cx="23" cy="28" r="4.2" fill="#0b1220" />
      <circle cx="41" cy="28" r="4.2" fill="#0b1220" />
      <circle cx="24.3" cy="26.5" r="1.3" fill="#ffffff" />
      <circle cx="42.3" cy="26.5" r="1.3" fill="#ffffff" />
      {/* smile */}
      <path
        d="M21 40c3.5 5 8 7.5 11 7.5s7.5-2.5 11-7.5"
        fill="none"
        stroke="#0b1220"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
