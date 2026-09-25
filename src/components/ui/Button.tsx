import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline" | "danger" | "live";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white border border-accent-soft/40 hover:bg-[#9c46ff] shadow-[0_0_24px_rgba(142,45,255,0.35)] disabled:shadow-none",
  live: "bg-live/15 text-live border border-live/40 hover:bg-live/25",
  ghost: "bg-transparent text-ink-dim border border-transparent hover:surface-2 hover:text-ink",
  outline: "surface-1 text-ink-dim border border-line hover:border-line-strong hover:text-ink hover:surface-2",
  danger: "bg-err/10 text-err border border-err/40 hover:bg-err/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[11px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
  lg: "h-11 px-5 text-sm gap-2 rounded-lg font-semibold",
};

export function Button({ variant = "outline", size = "md", icon, iconRight, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center font-medium tracking-wide transition-colors select-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon ? <span className="shrink-0 inline-flex [&>svg]:size-[1.1em]">{icon}</span> : null}
      {children}
      {iconRight ? <span className="shrink-0 inline-flex [&>svg]:size-[1.1em]">{iconRight}</span> : null}
    </button>
  );
}
