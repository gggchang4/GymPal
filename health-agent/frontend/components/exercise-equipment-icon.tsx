"use client";

export function ExerciseEquipmentIcon({
  equipmentKey,
  className
}: {
  equipmentKey: string;
  className?: string;
}) {
  return (
    <span className={`exercise-equipment-icon ${className ?? ""}`.trim()} aria-hidden="true">
      {renderIcon(equipmentKey)}
    </span>
  );
}

function renderIcon(key: string) {
  switch (key) {
    case "dumbbell":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M8 19h4v10H8zM14 16h4v16h-4zM30 16h4v16h-4zM36 19h4v10h-4zM18 22h12v4H18z" />
        </svg>
      );
    case "kettlebell":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M16 18a8 8 0 1 1 16 0h-4a4 4 0 1 0-8 0z" />
          <path d="M13 20h22l4 20a4 4 0 0 1-4 5H13a4 4 0 0 1-4-5z" />
        </svg>
      );
    case "barbell":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M5 14h4v20H5zM11 10h4v28h-4zM17 18h3v12h-3zM28 18h3v12h-3zM33 10h4v28h-4zM39 14h4v20h-4zM20 22h8v4h-8z" />
        </svg>
      );
    case "cable":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M10 6h4v36h-4zM14 8h16v4H14zM28 10h10v4H28zM33 14h4v18h-4zM16 30h18v4H16zM20 34l-5 8h4l4-6zM28 34l5 8h-4l-4-6z" />
        </svg>
      );
    case "machine":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M10 8h4v32h-4zM34 8h4v32h-4zM14 12h20v4H14zM18 20h12v4H18zM18 28h12v4H18zM20 32h8v8h-8z" />
        </svg>
      );
    case "smith_machine":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M10 6h4v36h-4zM34 6h4v36h-4zM14 10h20v4H14zM16 22h16v4H16zM14 34h20v4H14z" />
        </svg>
      );
    case "pullup_bar":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M8 10h32v4H8zM10 14h4v8h-4zM34 14h4v8h-4zM18 14h4v14h-4zM26 14h4v14h-4zM16 30h16v4H16z" />
        </svg>
      );
    case "dip_bar":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M12 10h4v28h-4zM32 10h4v28h-4zM16 16h16v4H16zM16 32h16v4H16z" />
        </svg>
      );
    case "bodyweight":
      return (
        <svg viewBox="0 0 48 48">
          <circle cx="24" cy="10" r="4" />
          <path d="M18 18l6-4 6 4-2 4-4-2-4 2zM22 22h4v14h-4zM16 38l6-10 2 2-4 10zM32 38l-4-10 2-2 6 10zM12 26l8-6 2 3-8 6zM36 26l-8-6-2 3 8 6z" />
        </svg>
      );
    case "resistance_band":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M15 14c0-4 4-7 9-7s9 3 9 7c0 9-18 11-18 20 0 4 4 7 9 7s9-3 9-7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "landmine":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M8 38l3-3 7 7-3 3zM14 32l18-18 3 3-18 18zM32 14l6-6 4 4-6 6z" />
        </svg>
      );
    case "ez_bar":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M6 18h4v12H6zM38 18h4v12h-4zM10 22h8l3-3 6 6 3-3h8v4h-8l-3 3-6-6-3 3h-8z" />
        </svg>
      );
    case "trap_bar":
      return (
        <svg viewBox="0 0 48 48">
          <path d="M14 10h20l8 14-8 14H14L6 24z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
          <path d="M20 18h8v12h-8z" />
        </svg>
      );
    case "ab_wheel":
      return (
        <svg viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M8 24h8M32 24h8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "medicine_ball":
      return (
        <svg viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" strokeWidth="4" />
          <path d="M24 10c4 4 6 9 6 14s-2 10-6 14M24 10c-4 4-6 9-6 14s2 10 6 14M10 24h28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48">
          <rect x="10" y="14" width="28" height="20" rx="6" />
        </svg>
      );
  }
}
