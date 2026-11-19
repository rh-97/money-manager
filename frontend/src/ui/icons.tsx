const PATHS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  loans: '<path d="M7 8h12l-3-3M17 16H5l3 3"/>',
  chart: '<path d="M5 20V11M11 20V5M17 20v-7M3 20h18"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5zM16 13.5h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  cash: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.4"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>',
  safe: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9v1M7 19v2M17 19v2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
  cart: '<path d="M3 4h2l2.4 10.5h10.8L20 7H6.3"/><circle cx="9" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  bag: '<path d="M6 8h12l-1 12H7zM9 8a3 3 0 0 1 6 0"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  cup: '<path d="M5 8h11v4.5a5.5 5.5 0 0 1-11 0zM16 9.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2"/>',
  bus: '<rect x="5" y="4" width="14" height="13" rx="2.5"/><path d="M5 11h14M8.5 20v-3M15.5 20v-3M8.5 14h.01M15.5 14h.01"/>',
  wifi: '<path d="M4.5 10.5a11 11 0 0 1 15 0M8 14a6 6 0 0 1 8 0M12 18h.01"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  percent: '<path d="M18 6L6 18"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  in: '<path d="M17 7L7 17M7 9v8h8"/>',
  out: '<path d="M7 17L17 7M9 7h8v8"/>',
  transfer: '<path d="M5 9h14l-3.5-3.5M19 15H5l3.5 3.5"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M11 21v-3h2v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M4 4l16 16M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.9 3.6M6.4 7.9A16.6 16.6 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  scale: '<path d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 6a2.5 2.5 0 0 0 5 0zM19 8l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
  swap: '<path d="M7 4v14M4 15l3 3 3-3M17 20V6M14 9l3-3 3 3"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M12 9v11M3.5 9h17M12 9S10 4.5 7.8 5.5C6 6.4 7.5 9 12 9zm0 0s2-4.5 4.2-3.5C18 6.4 16.5 9 12 9z"/>',
  book: '<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM17 20h2V7M5 17a3 3 0 0 1 3-3h9"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  plane: '<path d="M3 13l18-8-6 16-3-7z"/>',
  dots: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
};

export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined} dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.dots! }} />
  );
}

/** A tinted rounded square with an icon; slot 0 = neutral, 1-6 = category colours. */
export function Chip({ icon, slot }: { icon: string; slot?: number }) {
  const chip = slot === undefined ? 'var(--ink)' : slot === 0 ? 'var(--c-other)' : `var(--c${slot})`;
  return (
    <span className="ico" style={{ ['--chip' as string]: chip }}>
      <Icon name={icon} />
    </span>
  );
}

export const ACCOUNT_ICONS: Record<string, string> = {
  bank: 'bank',
  wallet: 'phone',
  ewallet: 'wallet',
  cash: 'cash',
  card: 'card',
  savings: 'safe',
  other: 'wallet',
  person: 'person',
  organization: 'building',
};
