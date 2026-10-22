// Inline SVG icons (stroke, currentColor, 24-unit grid drawn at 16 px) and the harness marks (Claude, Cursor, Orchestrator).
// Why: crisp at any DPI, themeable with CSS, no icon font or package. Used by every component.
import type { ReactNode, SVGProps } from 'react';
import type { Harness } from '@shared/contract';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconStop = (p: P) => <Svg {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" /></Svg>;
export const IconMaximize = (p: P) => <Svg {...p}><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" /></Svg>;
export const IconMinimize = (p: P) => <Svg {...p}><path d="M4 14h6v6M20 10h-6V4M10 14l-6.5 6.5M14 10l6.5-6.5" /></Svg>;
export const IconMore = (p: P) => <Svg {...p}><circle cx="5.5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>;
export const IconChevronDown = (p: P) => <Svg {...p}><path d="m6 9.5 6 6 6-6" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 4 21 19.5H3z" /><path d="M12 10v4.2M12 17.2v.1" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.1" /></Svg>;
export const IconGlobe = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5S14.6 18.1 12 20.5C9.4 18.1 8.2 15.3 8.2 12S9.4 5.9 12 3.5z" /></Svg>;
export const IconArrowLeft = (p: P) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
export const IconArrowRight = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconArrowUp = (p: P) => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>;
export const IconArrowDown = (p: P) => <Svg {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" /></Svg>;
export const IconTerminal = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="m7.5 10 3 2.5-3 2.5M12.5 15.5h4" /></Svg>;
export const IconEdit = (p: P) => <Svg {...p}><path d="M14.5 5.5 18.5 9.5 9 19H5v-4z" /><path d="m12.5 7.5 4 4" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5" /></Svg>;
export const IconSparkle = (p: P) => <Svg {...p}><path d="M12 3.5c.6 4.1 2.4 6 6.5 6.5-4.1.6-5.9 2.4-6.5 6.5-.6-4.1-2.4-5.9-6.5-6.5 4.1-.5 5.9-2.4 6.5-6.5z" /><path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" /></Svg>;
export const IconGrid = (p: P) => <Svg {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></Svg>;
export const IconColumns = (p: P) => <Svg {...p}><rect x="3.5" y="4" width="4.8" height="16" rx="1.4" /><rect x="9.6" y="4" width="4.8" height="11" rx="1.4" /><rect x="15.7" y="4" width="4.8" height="7" rx="1.4" /></Svg>;
export const IconBolt = (p: P) => <Svg {...p}><path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const IconTarget = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></Svg>;
export const IconKeyboard = (p: P) => <Svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.1M10 10h.1M13.5 10h.1M17 10h.1M7.5 14h9" /></Svg>;
export const IconBrain = (p: P) => <Svg {...p}><path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3.2 3.2 0 0 0 7.5 18 2.8 2.8 0 0 0 12 19.5V6a2.5 2.5 0 0 0-3-1.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2 3.2 3.2 0 0 1-3.5 5.3 2.8 2.8 0 0 1-4.5 1.5V6a2.5 2.5 0 0 1 3-1.5z" /></Svg>;
export const IconSettings = (p: P) => <Svg {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></Svg>;
export const IconSend = (p: P) => <Svg {...p}><path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" /></Svg>;
export const IconQuestion = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.4M12 16.6v.1" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></Svg>;
export const IconDot = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></Svg>;
export const IconList = (p: P) => <Svg {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1" /></Svg>;
export const IconBranch = (p: P) => <Svg {...p}><circle cx="7" cy="5.5" r="2" /><circle cx="7" cy="18.5" r="2" /><circle cx="17" cy="8" r="2" /><path d="M7 7.5v9M17 10c0 4-10 3-10 6.5" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z" /><path d="M5 16.5a3 3 0 0 1 3-3h10.5" /></Svg>;
export const IconCoins = (p: P) => <Svg {...p}><ellipse cx="9.5" cy="7.5" rx="5.5" ry="2.5" /><path d="M4 7.5v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4" /><path d="M9 16.2c.2 1.3 2.6 2.3 5.5 2.3 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.7-2.1-4-2.4" /></Svg>;
export const IconChart = (p: P) => <Svg {...p}><path d="M4 20h16M7 16.5v-5M12 16.5V7M17 16.5v-8" /></Svg>;
export const IconTicket = (p: P) => <Svg {...p}><path d="M4 7.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V10a2 2 0 0 0 0 4v2.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V14a2 2 0 0 0 0-4z" /><path d="M14 5.5v2M14 11v2M14 16.5v2" /></Svg>;
export const IconMap = (p: P) => <Svg {...p}><path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" /><path d="M9 4.5v13M15 6.5v13" /></Svg>;
export const IconCompass = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" /></Svg>;
export const IconLightbulb = (p: P) => <Svg {...p}><path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-.6c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5z" /></Svg>;
export const IconUser = (p: P) => <Svg {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" /></Svg>;
export const IconLayers = (p: P) => <Svg {...p}><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></Svg>;
export const IconFocus = (p: P) => <Svg {...p}><path d="M4 8.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3" /><circle cx="12" cy="12" r="2.5" /></Svg>;
export const IconEraser = (p: P) => <Svg {...p}><path d="m8.5 19.5-4.2-4.2a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l4.2 4.2a1.6 1.6 0 0 1 0 2.3l-8.7 8.7M8.5 19.5H20M9 8.8l6.2 6.2" /></Svg>;
export const IconUndo = (p: P) => <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>;
export const IconLogin = (p: P) => <Svg {...p}><path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4M10 16.5 14.5 12 10 7.5M14.5 12H4" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>;
export const IconExternal = (p: P) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>;
export const IconCopy = (p: P) => <Svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" /></Svg>;
export const IconHistory = (p: P) => <Svg {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8" /><path d="M12 8v4.2l2.8 1.6" /></Svg>;
export const IconPanel =(p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9h17" /></Svg>;
export const IconSpinner = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="spin" {...rest}>
    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity=".22" strokeWidth="2.4" />
    <path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/** The harness mark of a tile: Claude (warm spark), Cursor (cursor arrow), Orchestrator (violet four-point star, the ✦ of its column; once a Orchestrator "R"). */
export function HarnessMark({ harness, orchestrator, size = 20 }: { harness: Harness; orchestrator?: boolean; size?: number }) {
  if (orchestrator) {
    return (
      <span className="mark mark-orchestrator" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 14.4 9.6 21.5 12l-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z" /></svg>
      </span>
    );
  }
  if (harness === 'cursor') {
    return (
      <span className="mark mark-cursor" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="currentColor"><path d="M5 3.5 19.5 11l-6.6 1.9L9.8 19.5z" /></svg>
      </span>
    );
  }
  if (harness !== 'claude') {
    // any other engine (Kimi, one from the brain): its initial, never another vendor's mark
    return <span className="mark mark-engine" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden="true">{harness.charAt(0).toUpperCase()}</span>;
  }
  return (
    <span className="mark mark-claude" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18" />
      </svg>
    </span>
  );
}
