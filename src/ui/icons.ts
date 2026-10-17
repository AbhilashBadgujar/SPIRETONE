// Inline SVG icons. Stroke/fill use currentColor so CSS sets the tint.

export const ICONS = {
  ascend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 12.5 12 6.5l6 6"/><path d="M6 18.5l6-6 6 6" opacity=".55"/>
  </svg>`,
  block: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3z" fill="currentColor" opacity=".45"/>
    <path d="M12 2.8 20 7.3 12 11.8 4 7.3z" fill="currentColor"/>
    <path d="M12 11.8v9.4L4 16.7V7.3z" fill="currentColor" opacity=".7"/>
  </svg>`,
} as const;
