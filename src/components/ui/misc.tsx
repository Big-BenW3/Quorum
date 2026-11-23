import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("q-spin size-4", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("q-skeleton rounded-md", className)} aria-hidden />;
}

const tones = {
  neutral: "bg-muted text-muted-fg",
  accent: "bg-accent-soft text-accent-text",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({ className, children, as: Tag = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" }) {
  return <Tag className={cn("rounded-lg border border-border bg-card", className)}>{children}</Tag>;
}
export const CardHeader = ({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) => (
  <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)}>
    <div className="min-w-0">
      <h2 className="text-[15px] font-semibold leading-6 tracking-tight">{title}</h2>
      {description && <p className="mt-0.5 max-w-prose text-sm text-muted-fg">{description}</p>}
    </div>
    {action}
  </div>
);
export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn("p-5", className)}>{children}</div>;

const noticeStyles = {
  info: { icon: Info, cls: "border-border bg-muted text-fg", i: "text-muted-fg" },
  good: { icon: CheckCircle2, cls: "border-transparent bg-good-soft text-fg", i: "text-good" },
  warn: { icon: AlertTriangle, cls: "border-transparent bg-warn-soft text-fg", i: "text-warn" },
  danger: { icon: XCircle, cls: "border-transparent bg-danger-soft text-fg", i: "text-danger" },
} as const;
export function Notice({ tone = "info", title, children, className, action }: { tone?: keyof typeof noticeStyles; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const s = noticeStyles[tone];
  const Icon = s.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", s.cls, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", s.i)} aria-hidden />
      <div className="min-w-0 flex-1 leading-6">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "text-muted-fg")}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-8", className)}>
      {icon && <div className="text-muted-fg">{icon}</div>}
      <div>
        <p className="font-medium">{title}</p>
        {children && <p className="mt-1 max-w-md text-sm text-muted-fg">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-2 text-sm text-muted-fg">{breadcrumb}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-muted-fg">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <p className="text-sm text-muted-fg">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted-fg">{hint}</p>}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border text-sm">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline justify-between gap-6 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-muted-fg">{i.label}</dt>
          <dd className="text-right font-medium">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
