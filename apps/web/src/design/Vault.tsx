import type { ElementType, ReactNode } from "react";

// The vault: the one dark aubergine surface on a screen, holding only where the money is right now
// (the held amount, the held cart, the run step, the empty vault). A screen has exactly one; `bare` is
// for the vault drawn as a column of a table.
export function Vault({
  label,
  as: Tag = "section",
  bare = false,
  className,
  children,
}: {
  // Names the vault for assistive technology.
  label: string;
  as?: ElementType;
  bare?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tag
      className={["vault", bare ? "vault-bare" : "vault-panel", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}
