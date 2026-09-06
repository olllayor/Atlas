import React, { useId } from 'react';

export function ComputerUseAppIcon({ className }: { className?: string }) {
  const gradientId = `${useId().replaceAll(':', '')}-computer-use-app-gradient`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="2" y1="2" x2="22" y2="22">
          <stop offset="0" stopColor="#00dff0" />
          <stop offset="0.42" stopColor="#3b9cff" />
          <stop offset="0.72" stopColor="#b044f5" />
          <stop offset="1" stopColor="#ff78b6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="5" fill={`url(#${gradientId})`} />
      <path
        d="m7.2 6.2 10.5 4.1-4.2 2.1-2 4.7z"
        fill="white"
        stroke="#315cff"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
