// A handful of lucide icons (ISC licence), inlined so the app has no icon dependency.

const paths: Record<string, string> = {
  copy: 'M8 8h12v12H8z|M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3',
  check: 'M20 6 9 17l-5-5',
  volume: 'M11 5 6 9H2v6h4l5 4V5z|M15.54 8.46a5 5 0 0 1 0 7.07|M19.07 4.93a10 10 0 0 1 0 14.14',
  volumeLow: 'M11 5 6 9H2v6h4l5 4V5z|M15.54 8.46a5 5 0 0 1 0 7.07',
  mute: 'M11 5 6 9H2v6h4l5 4V5z|m22 9-6 6|m16 9 6 6',
  tv: 'M2 7h20v14H2z|m17 2-5 5-5-5',
  book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z|M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z',
  leave: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9',
  bot: 'M12 8V4H8|M4 8h16v12H4z|M2 14h2|M20 14h2|M15 13v2|M9 13v2',
  x: 'M18 6 6 18|m6 6 12 12',
  plus: 'M12 5v14|M5 12h14',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71|M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  wifiOff: 'M12 20h.01|M8.5 16.43a5 5 0 0 1 7 0|M2 8.82a15 15 0 0 1 4.17-2.65|M10.66 5c4.01-.36 8.14.9 11.34 3.76|M16.85 11.25a10 10 0 0 1 2.22 1.68|M5 13a10 10 0 0 1 5.24-2.76|m2 2 20 20',
  arrowLeft: 'm12 19-7-7 7-7|M19 12H5',
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  const d = paths[name] ?? '';
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/** The mark: three stacked tiles, one column of the game grid */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size * 0.6} height={size} viewBox="0 0 12 20" aria-hidden="true" className="mark">
      <rect x="0" y="0" width="12" height="5.6" rx="1.6" fill="currentColor" opacity="0.45" />
      <rect x="0" y="7.2" width="12" height="5.6" rx="1.6" fill="currentColor" opacity="0.7" />
      <rect x="0" y="14.4" width="12" height="5.6" rx="1.6" fill="var(--accent)" />
    </svg>
  );
}
