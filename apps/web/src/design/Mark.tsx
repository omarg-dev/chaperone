import type { SVGProps } from "react";

// The Hold mark: a rounded bracket holding a dot, "the pause before money moves".
//
// Construction rule, on a 48 unit grid: the bracket's corner radius equals the dot's width, the
// stroke is half the dot, the dot sits a little toward the opening (held, not trapped), and clear
// space is one dot on every side. The numbers below are that rule written out.
const DOT = 11; // the dot's width
const RADIUS = DOT; // corner radius = dot width
const STROKE = DOT / 2; // stroke = half the dot
const LEFT = 8;
const TOP = 8;
const RIGHT = 32; // the opening
const BOTTOM = 40;
const DOT_X = 21.5; // a little toward the opening
const DOT_Y = 24;

const BRACKET = [
  `M${RIGHT} ${TOP}`,
  `H${LEFT + RADIUS}`,
  `A${RADIUS} ${RADIUS} 0 0 0 ${LEFT} ${TOP + RADIUS}`,
  `V${BOTTOM - RADIUS}`,
  `A${RADIUS} ${RADIUS} 0 0 0 ${LEFT + RADIUS} ${BOTTOM}`,
  `H${RIGHT}`,
].join(" ");

// Below this size the full mark's strokes blur, so a hand-cut version on a 16 unit grid is used.
export const CUT_BELOW = 20;

export interface MarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
  // Names the mark for assistive technology. Without it the mark is decoration.
  title?: string;
}

export function Mark({ size = 24, title, className, ...rest }: MarkProps) {
  const cut = size < CUT_BELOW;
  return (
    <svg
      width={size}
      height={size}
      viewBox={cut ? "0 0 16 16" : "0 0 48 48"}
      className={className}
      style={{ color: "var(--hold)" }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      {cut ? (
        <>
          <path
            d="M11.5 2.2 H6.6 A4.4 4.4 0 0 0 2.2 6.6 V9.4 A4.4 4.4 0 0 0 6.6 13.8 H11.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="7.6" cy="8" r="2.3" fill="currentColor" />
        </>
      ) : (
        <>
          <path
            d={BRACKET}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          <circle cx={DOT_X} cy={DOT_Y} r={DOT / 2} fill="currentColor" />
        </>
      )}
    </svg>
  );
}
