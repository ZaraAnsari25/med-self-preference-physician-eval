import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white border-accent hover:bg-accent-hover disabled:bg-line-strong disabled:border-line-strong",
  secondary: "bg-surface text-ink border-line hover:border-line-strong hover:bg-subtle disabled:text-muted",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-subtle disabled:text-muted",
  danger: "bg-surface text-danger border-line hover:bg-danger-soft",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" && "h-8 px-2.5 text-sm",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-[0.95rem]",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-xl border border-line bg-surface", className)} {...props} />;
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "done" | "progress" | "danger"; className?: string }) {
  const tones = {
    neutral: "bg-subtle text-ink-2 border-line",
    accent: "bg-accent-soft text-accent border-[#f0c9cf]",
    done: "bg-done-soft text-done border-done-line",
    progress: "bg-progress-soft text-progress border-progress-line",
    danger: "bg-danger-soft text-danger border-[#f5c2bd]",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[0.72rem] font-semibold uppercase tracking-wider text-muted", className)}>{children}</div>;
}

export function Logo() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3v6a4 4 0 0 0 8 0V3" />
        <path d="M10 13v2a5 5 0 0 0 10 0v-2" />
        <circle cx="20" cy="11" r="2" />
      </svg>
    </span>
  );
}
