import { ArtifactType } from "../api";

interface Props {
  type: ArtifactType;
  size?: number;
}

export function TypeIcon({ type, size = 14 }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (type) {
    case "video":
      return (
        <svg {...common}>
          <rect x="2" y="3.5" width="9" height="9" rx="1.6" />
          <path d="M11 7l3-2v6l-3-2" />
        </svg>
      );
    case "photo":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="12" height="10" rx="1.6" />
          <circle cx="6" cy="6.4" r="1.1" />
          <path d="M3 11.6l3-3 2.2 2.2L10.6 8l2.4 3" />
        </svg>
      );
    case "evp":
      return (
        <svg {...common}>
          <path d="M2 8h1.6l1.2-4 1.7 8 1.4-6 1.3 4 1.2-2H14" />
        </svg>
      );
    case "sensor-log":
      return (
        <svg {...common}>
          <path d="M2 12V5M5 12V8M8 12V3M11 12V7M14 12V9" />
        </svg>
      );
    case "finding":
      return (
        <svg {...common}>
          <path d="M8 14s4.2-4.2 4.2-7A4.2 4.2 0 0 0 8 2.6 4.2 4.2 0 0 0 3.8 7c0 2.8 4.2 7 4.2 7Z" />
          <circle cx="8" cy="6.9" r="1.4" />
        </svg>
      );
    case "note":
      return (
        <svg {...common}>
          <path d="M3.5 2.5h6l3 3v8h-9z" />
          <path d="M9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}
