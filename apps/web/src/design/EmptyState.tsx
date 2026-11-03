import type { ReactNode } from "react";
import { Vault } from "./Vault";

// A page with nothing on it yet says what will appear here, not just that it's empty. The vault is
// still on the screen, empty: the one dark surface a screen has is where the money would be.
export function EmptyState({
  title,
  children,
  action,
  label = "Held right now",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  // The small line over the title, which names what the vault is holding nothing of.
  label?: string;
}) {
  return (
    <Vault label={label} className="empty">
      <span className="t-meta empty-label">{label}</span>
      <h2 className="empty-title t-headline">{title}</h2>
      <p className="empty-body">{children}</p>
      {action}
    </Vault>
  );
}
