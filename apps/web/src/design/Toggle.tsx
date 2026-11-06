import type { ReactNode } from "react";

// An on-or-off choice about how something is shown (as opposed to which of it is shown, which is a
// filter). A real checkbox, so the keyboard, the screen reader's "checked" and the label all come for
// free, drawn as a chip with a small track: aubergine (the hold) when it is on.
export function Toggle({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  // What it does, said once, under the label's name for assistive technology and on hover.
  hint?: string;
}) {
  return (
    <label className="toggle" title={hint}>
      <input
        type="checkbox"
        className="visually-hidden"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span>{children}</span>
    </label>
  );
}
