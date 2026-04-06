"use client";

import { useEffect, useMemo, useState } from "react";

interface ActivityRingItem {
  slug: string;
  label: string;
  value: number;
  note: string;
  accent: string;
}

const ringRadius = [78, 60, 42];
const hoverWidth = [28, 30, 34];

export function ActivityRings({
  rings,
  activeSlug,
  lockActiveSlug = false
}: {
  rings: ActivityRingItem[];
  activeSlug?: string;
  lockActiveSlug?: boolean;
}) {
  const [hoveredSlug, setHoveredSlug] = useState(rings[0]?.slug ?? "");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setProgress(1));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (activeSlug) {
      setHoveredSlug(activeSlug);
      return;
    }

    if (!rings.some((ring) => ring.slug === hoveredSlug)) {
      setHoveredSlug(rings[0]?.slug ?? "");
    }
  }, [activeSlug, hoveredSlug, rings]);

  const resolvedActiveSlug = activeSlug ?? hoveredSlug;

  const activeRing = useMemo(
    () => rings.find((ring) => ring.slug === resolvedActiveSlug) ?? rings[0],
    [resolvedActiveSlug, rings]
  );

  const handleRingEnter = (slug: string) => {
    if (lockActiveSlug || activeSlug) {
      return;
    }

    setHoveredSlug(slug);
  };

  const handleRingLeave = () => {
    if (lockActiveSlug || activeSlug) {
      return;
    }

    setHoveredSlug(rings[0]?.slug ?? "");
  };

  return (
    <div className="fitness-ring-panel activity-rings-widget">
      <div className="fitness-ring-layout">
        <div className="section-copy ring-intro">
          <span className="section-label">Activity</span>
          <h3>{activeRing.label}</h3>
          <p className="muted">{activeRing.note}</p>
        </div>

        <div className="ring-cluster" onMouseLeave={handleRingLeave}>
          <svg viewBox="0 0 220 220" className="fitness-ring" aria-hidden="true">
            {rings.map((ring, index) => {
              const radius = ringRadius[index];
              const circumference = 2 * Math.PI * radius;
              const currentOffset = circumference * (1 - (ring.value * progress) / 100);
              const isActive = activeRing.slug === ring.slug;

              return (
                <g
                  key={ring.slug}
                  className={`ring-layer ${ring.slug} ${isActive ? "is-active" : ""}`}
                >
                  <circle className="ring-track" cx="110" cy="110" r={radius} />
                  <circle
                    className="ring-progress interactive dynamic"
                    cx="110"
                    cy="110"
                    r={radius}
                    stroke={ring.accent}
                    strokeDasharray={circumference}
                    strokeDashoffset={currentOffset}
                    style={{
                      transitionDelay: `${index * 120}ms`
                    }}
                  />
                  <circle
                    className="ring-hover-target"
                    cx="110"
                    cy="110"
                    r={radius}
                    strokeWidth={hoverWidth[index]}
                    onMouseEnter={() => handleRingEnter(ring.slug)}
                  />
                </g>
              );
            })}
          </svg>

          <div
            className="ring-center-copy"
            aria-live="polite"
            aria-label={`${activeRing.label} ${activeRing.value}%`}
          >
            <strong>{activeRing.value}%</strong>
          </div>
        </div>
      </div>

      <div className="ring-legend" onMouseLeave={handleRingLeave}>
        {rings.map((ring) => {
          const isActive = activeRing.slug === ring.slug;

          return (
            <button
              key={ring.slug}
              type="button"
              className={`ring-legend-row ${ring.slug} ${isActive ? "active" : ""}`}
              onMouseEnter={() => handleRingEnter(ring.slug)}
            >
              <span className="ring-dot" style={{ backgroundColor: ring.accent }} />
              <div>
                <span className="metric-label">{ring.label}</span>
                <strong>{ring.note}</strong>
              </div>
              <span className="ring-value">{ring.value}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
