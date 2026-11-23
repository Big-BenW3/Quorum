import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/misc";

const base = "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,opacity,transform] duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50";
const variants = {
  primary: "bg-primary text-primary-fg hover:opacity-90",
  secondary: "border border-border bg-card text-fg hover:bg-muted",
  ghost: "text-fg hover:bg-muted",
  danger: "bg-danger text-white hover:opacity-90",
  link: "text-fg underline underline-offset-4 decoration-border hover:decoration-fg px-0 h-auto",
} as const;
const sizes = { sm: "h-8 px-3 text-sm", md: "h-9 px-4 text-sm", lg: "h-11 px-6 text-[15px]", icon: "h-9 w-9" } as const;

export type ButtonStyle = { variant?: keyof typeof variants; size?: keyof typeof sizes };
export const buttonClass = ({ variant = "primary", size = "md" }: ButtonStyle = {}, className?: string) => cn(base, variants[variant], variant !== "link" && sizes[size], className);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle & { loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant, size, loading, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass({ variant, size }, className)} {...rest}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

export function LinkButton({ variant, size, className, ...rest }: ComponentProps<typeof Link> & ButtonStyle) {
  return <Link className={buttonClass({ variant, size }, className)} {...rest} />;
}
