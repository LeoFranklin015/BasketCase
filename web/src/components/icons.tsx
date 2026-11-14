import type { SVGProps } from "react";

/** One stroke family: 16px grid, 1.5 stroke, round caps and joins, currentColor. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
  </Svg>
);

export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8Z" />
  </Svg>
);

export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5H3.5v9h9V10M9 2.5h4.5V7M13.5 2.5 7.5 8.5" />
  </Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 6.25 8 9.75l3.5-3.5" />
  </Svg>
);

export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);

/** Anchored asset: can't be challenged. */
export const IconAnchor = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="3.5" r="1.5" />
    <path d="M8 5v8.5M5.5 7.5h5M2.75 9.5a5.25 4 0 0 0 10.5 0" />
  </Svg>
);

export const IconFlame = (p: P) => (
  <Svg {...p}>
    <path d="M8 14.25c2.6 0 4.25-1.8 4.25-4.2 0-2.6-2.2-3.9-2.9-6.8-1.5 1-2.1 2.4-2.1 3.6-.9-.5-1.4-1.3-1.5-2.2C4.6 5.8 3.75 7.6 3.75 10c0 2.4 1.65 4.25 4.25 4.25Z" />
  </Svg>
);

export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.75 13 3.5v4c0 3.2-2.1 5.6-5 6.75C5.1 13.1 3 10.7 3 7.5v-4L8 1.75Z" />
  </Svg>
);

export const IconSwap = (p: P) => (
  <Svg {...p}>
    <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.25V11M8 5v.01" />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 7.25 8 2.75l5.5 4.5V13a.75.75 0 0 1-.75.75H9.75v-3.5h-3.5v3.5H3.25A.75.75 0 0 1 2.5 13V7.25Z" />
  </Svg>
);

export const IconRocket = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 10.5 5.5 6.5c1.6-3 4.1-4.6 8-4.75-.15 3.9-1.75 6.4-4 8.75Z" />
    <path d="M5.5 6.5H3l1.5-2h2.75M9.5 10.5V13l2-1.5V8.75" />
    <path d="M4.75 9.75c-1 .5-1.75 1.75-1.75 3.25 1.5 0 2.75-.75 3.25-1.75" />
  </Svg>
);

/** A headstone, for the graveyard. */
export const IconTomb = (p: P) => (
  <Svg {...p}>
    <path d="M4 13.75V6.5a4 4 0 0 1 8 0v7.25" />
    <path d="M2.5 13.75h11M8 5.5v4M6.5 7h3" />
  </Svg>
);

export const IconWallet = (p: P) => (
  <Svg {...p}>
    <path d="M12.5 5.25V3.75a1 1 0 0 0-1-1h-8a1.25 1.25 0 0 0 0 2.5h9.25a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-.75.75H3.5a1.25 1.25 0 0 1-1.25-1.25V4" />
    <path d="M10.75 9.25h.01" strokeWidth={2} />
  </Svg>
);

export const IconChartLine = (p: P) => (
  <Svg {...p}>
    <path d="M2 11.5 5.5 8l2.5 2 5.5-5.5" />
  </Svg>
);

export const IconCandles = (p: P) => (
  <Svg {...p}>
    <path d="M5 2.5v2M5 11v2.5M11 2.5v3.5M11 12v1.5" />
    <rect x="3.5" y="4.5" width="3" height="6.5" rx=".5" />
    <rect x="9.5" y="6" width="3" height="6" rx=".5" />
  </Svg>
);

export const IconDrop = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.25c2.2 2.6 4 4.75 4 7.1a4 4 0 0 1-8 0c0-2.35 1.8-4.5 4-7.1Z" />
  </Svg>
);

export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Svg>
);

export const IconShare = (p: P) => (
  <Svg {...p}>
    <path d="M8 10V2.5M5.25 5.25 8 2.5l2.75 2.75M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4" />
  </Svg>
);

export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.75" />
    <path d="M10.5 3.5v-.25a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.25" />
  </Svg>
);

export const IconArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);

export const IconArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
);

export const IconArrowUpRight = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" />
  </Svg>
);

export const IconMore = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <circle cx="8" cy="3.5" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="8" cy="12.5" r="1.25" />
  </Svg>
);
