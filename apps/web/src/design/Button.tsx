import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  // Primary is the one filled button on a screen; secondary is for everything else.
  variant?: "primary" | "secondary";
  small?: boolean;
}

// The class names for a link that should look like a button.
export const buttonClass = (variant: "primary" | "secondary" = "primary", small = false) =>
  ["btn", variant === "secondary" && "btn-secondary", small && "btn-small"]
    .filter(Boolean)
    .join(" ");

export function Button({
  variant = "primary",
  small,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[buttonClass(variant, small), className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
