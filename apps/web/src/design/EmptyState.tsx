import type { ReactNode } from "react";

// A page with nothing on it yet says what will appear here, not just that it's empty.
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h2 className="empty-title">{title}</h2>
      <p className="empty-body">{children}</p>
      {action}
    </div>
  );
}
