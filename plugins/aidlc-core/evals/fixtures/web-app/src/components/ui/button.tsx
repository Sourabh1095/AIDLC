import type { ButtonHTMLAttributes } from "react";

/** The project's button: primary for the main action, secondary for everything else. */
export function Button({ variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return <button className={`btn btn-${variant}`} {...props} />;
}
