import type { StructureId } from '../data/ids';

// Inline SVG icons. Everything uses currentColor so CSS sets the tint;
// layered opacity gives the flat two-tone game look.

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  ascend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 12.5 12 6.5l6 6"/><path d="M6 18.5l6-6 6 6" opacity=".55"/>
  </svg>`,
  block: svg(`
    <path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3z" fill="currentColor" opacity=".45"/>
    <path d="M12 2.8 20 7.3 12 11.8 4 7.3z" fill="currentColor"/>
    <path d="M12 11.8v9.4L4 16.7V7.3z" fill="currentColor" opacity=".7"/>`),
  resonance: svg(`
    <circle cx="12" cy="12" r="5.4" fill="currentColor"/>
    <path d="M5.4 6.4a8.6 8.6 0 0 0 0 11.2M18.6 6.4a8.6 8.6 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".6"/>`),
  rate: svg(`<path d="M12 5.5 19 16H5z" fill="currentColor"/>`),
  harmony: svg(`
    <path d="M7.5 2.5v7.8a4.5 4.5 0 0 0 9 0V2.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M12 15v7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`),
  shard: svg(`
    <path d="M12 2 18.5 9 12 22 5.5 9z" fill="currentColor" opacity=".6"/>
    <path d="M12 2 18.5 9h-13z" fill="currentColor"/>
    <path d="M12 9v13" stroke="currentColor" stroke-width="1.2" opacity=".5"/>`),
  bridge: svg(`
    <path d="M2 9h20v2.6H2z" fill="currentColor"/>
    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".6"/>
    <path d="M4 5v4M20 5v4M12 5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  golden: svg(`<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" fill="currentColor"/>`),
  soundOn: svg(`
    <path d="M3.5 9h4L13 4.5v15L7.5 15h-4z" fill="currentColor"/>
    <path d="M16.2 8.6a5 5 0 0 1 0 6.8M18.8 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  soundOff: svg(`
    <path d="M3.5 9h4L13 4.5v15L7.5 15h-4z" fill="currentColor"/>
    <path d="m16.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  lock: svg(`
    <path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/>`),
} as const;

export const STRUCTURE_ICONS: Readonly<Record<StructureId, string>> = {
  ST_EMPTY: ICONS.block,
  ST_COTTAGE: svg(`
    <path d="M2.5 11.5 12 3.5l9.5 8z" fill="currentColor"/>
    <path d="M5 11h14v9.5H5z" fill="currentColor" opacity=".55"/>
    <path d="M10.4 14.5h3.2v6h-3.2z" fill="currentColor"/>`),
  ST_PIER: svg(`
    <path d="M14 6.5h4.5V11H14z" fill="currentColor" opacity=".7"/>
    <path d="M2 11h20v2.6H2z" fill="currentColor"/>
    <path d="M5 13.6h2.2V19H5zM16.8 13.6H19V19h-2.2z" fill="currentColor" opacity=".7"/>
    <path d="M2 20.5c2-1.3 4-1.3 6 0s4 1.3 6 0 4-1.3 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".6"/>`),
  ST_TOWER: svg(`
    <path d="M12 1.8 18.5 9h-13z" fill="currentColor"/>
    <path d="M7.5 9h9v12.5h-9z" fill="currentColor" opacity=".55"/>
    <path d="M10.8 12h2.4v3.4h-2.4z" fill="currentColor"/>`),
  ST_LIGHTHOUSE: svg(`
    <path d="M8.6 5 12 1.8 15.4 5z" fill="currentColor"/>
    <path d="M9.2 5h5.6v4H9.2z" fill="currentColor"/>
    <path d="M9.4 9h5.2l1.6 12.5H7.8z" fill="currentColor" opacity=".55"/>
    <path d="M9 13.2h6l.4 3H8.6z" fill="currentColor"/>
    <path d="M7 6.2 2.5 4.6M17 6.2l4.5-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>`),
  ST_PLAZA: svg(`
    <path d="M2.5 14h19v6.5h-19z" fill="currentColor" opacity=".5"/>
    <path d="M6.5 14a5.5 2.6 0 0 1 11 0z" fill="currentColor"/>
    <path d="M11.1 6h1.8v7h-1.8z" fill="currentColor"/>
    <path d="M12 6.2c-2.2 0-3.8 1.7-3.8 3.8M12 6.2c2.2 0 3.8 1.7 3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`),
};
