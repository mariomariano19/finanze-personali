// Icone a tratto, disegnate a mano (nessuna libreria esterna).
const PATHS: Record<string, string> = {
  home: 'M4 10.5L12 4l8 6.5V20h-5v-6h-6v6H4z',
  income: 'M17 7L7 17M7 9v8h8',
  expense: 'M7 17L17 7M9 7h8v8',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  report: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  radar: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l6-6M12 12h.01',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  repeat: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  food: 'M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M17 3c-2 2-2 6 0 9v9',
  car: 'M5 16V11l2-5h10l2 5v5M5 16h14M7 19v-3M17 19v-3M8 13h.01M16 13h.01',
  health: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  bag: 'M6 8h12l-1 12H7zM9 8V6a3 3 0 0 1 6 0v2',
  ticket: 'M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 1 0-4V4H4zM10 4v12',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c.7-3 3-5 6-5s5.3 2 6 5M16 5a3 3 0 0 1 0 6M18 15c1.6.6 2.7 2.4 3 5',
  bank: 'M4 9l8-5 8 5M5 9v9M9 9v9M15 9v9M19 9v9M3 20h18',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  briefcase: 'M3 7h18v13H3zM8 7V5h8v2',
  star: 'M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z',
  laptop: 'M5 6h14v9H5zM3 18h18',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-4 4.5-6 8-6s6.5 2 8 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1-3-5-3-5 0M12 7c1-3 5-3 5 0',
  transfer: 'M4 8h14l-3-3M20 16H6l3 3',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  card: 'M3 6h18v12H3zM3 10h18',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8h.01'
};

export function Icon({ name, size = 20, color = 'currentColor', stroke = 1.8 }: { name: string; size?: number; color?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? PATHS.dots} />
    </svg>
  );
}
