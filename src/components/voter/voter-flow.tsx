"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { getVoterElection } from "@/server/domain/voting";
import { Avatar } from "@/components/app/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type Info = Awaited<ReturnType<typeof getVoterElection>>;
type Candidate = { id: string; name: string; bio: string | null; imageUrl: string | null };
type BallotPosition = { id: string; title: string; description: string | null; maxSelections: number; allowAbstain: boolean; candidates: Candidate[] };
type Phase = "verify" | "choose" | "review" | "done" | "voted" | "ended";

export function VoterFlow({ slug, info }: { slug: string; info: Info }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(info.open ? "verify" : "ended");
  const [values, setValues] = useState<Record<string, string>>({});
  const [fe, setFe] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ token: string; expiresAt: Date } | null>(null);
  const [ballot, setBallot] = useState<BallotPosition[]>([]);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [abstain, setAbstain] = useState<Set<string>>(new Set());
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } heading.current?.focus(); }, [phase]);

  const steps = info.restricted ? ["Verify", "Choose", "Review"] : ["Choose", "Review"];
  const stepIndex = phase === "verify" ? 0 : phase === "choose" ? (info.restricted ? 1 : 0) : phase === "review" ? (info.restricted ? 2 : 1) : -1;

  function fail(e: unknown, back: Phase) {
    if (e instanceof ApiError) {
      if (e.code === "ALREADY_VOTED") { setPhase("voted"); return; }
      if (e.code === "ELECTION_NOT_OPEN") { setError(e.message); setPhase("ended"); return; }
      if (e.code === "CREDENTIAL_INVALID" && back !== "verify") { setError("Your session timed out. Verify again to continue. Your choices on this page are cleared."); setPicks({}); setAbstain(new Set()); setCredential(null); setPhase("verify"); return; }
      if (e.fields) setFe(e.fields);
    }
    setError(errorMessage(e));
  }

  async function verify(ev?: FormEvent) {
    ev?.preventDefault(); setBusy(true); setError(null); setFe({});
    try {
      const r = await api<{ credential: string; expiresAt: string; ballot: BallotPosition[] }>("POST", `/api/public/v/${slug}/verify`, { values: info.restricted ? values : {} });
      setCredential({ token: r.credential, expiresAt: new Date(r.expiresAt) }); setBallot(r.ballot); setPicks({}); setAbstain(new Set()); setValues({}); setPhase("choose");
    } catch (e) { fail(e, "verify"); } finally { setBusy(false); }
  }

  const answered = (p: BallotPosition) => (picks[p.id]?.length ?? 0) > 0 || (p.allowAbstain && abstain.has(p.id));
  function toReview() {
    const miss = new Set(ballot.filter((p) => !answered(p)).map((p) => p.id));
    setMissing(miss);
    if (miss.size) {
      // Bring the first unanswered question into view and put keyboard focus on its first choice.
      const box = document.getElementById(`pos-${[...miss][0]}`);
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      box?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
      return;
    }
    setError(null); setPhase("review");
  }
  function pick(p: BallotPosition, id: string, on: boolean) {
    setMissing((m) => { const n = new Set(m); n.delete(p.id); return n; });
    setAbstain((a) => { const n = new Set(a); n.delete(p.id); return n; });
    setPicks((s) => {
      const cur = s[p.id] ?? [];
      if (p.maxSelections === 1) return { ...s, [p.id]: [id] };
      return { ...s, [p.id]: on ? (cur.length < p.maxSelections ? [...cur, id] : cur) : cur.filter((x) => x !== id) };
    });
  }
  function choseAbstain(p: BallotPosition) {
    setMissing((m) => { const n = new Set(m); n.delete(p.id); return n; });
    setPicks((s) => ({ ...s, [p.id]: [] })); setAbstain((a) => new Set(a).add(p.id));
  }

  async function submit() {
    if (!credential) return;
    setBusy(true); setError(null);
    try {
      await api("POST", `/api/public/v/${slug}/submit`, { credential: credential.token, selections: ballot.map((p) => ({ positionId: p.id, candidateIds: picks[p.id] ?? [] })) });
      setCredential(null); setPicks({}); setPhase("done");
    } catch (e) { fail(e, "review"); } finally { setBusy(false); }
  }

  const head = (title: string, children?: ReactNode) => (
    <div className="mb-8">
      <p className="mb-2 text-sm text-muted-fg">{info.organization}</p>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-[28px] sm:leading-9">{title}</h1>
      {children}
    </div>
  );

  // ───────── states without a ballot ─────────
  if (phase === "ended") {
    const pending = info.status === "DRAFT" || info.status === "SCHEDULED";
    return (
      <Shell>
        {head(info.title)}
        <Notice tone="info" title={pending ? "Voting hasn’t started yet" : "Voting has ended"}>
          {error ?? (pending ? (info.startsAt ? `It opens ${formatDateTime(info.startsAt, info.timezone)}.` : "The organizers haven’t opened it yet.") : "This election is no longer accepting ballots.")}
        </Notice>
        <div className="mt-6 flex flex-wrap gap-2">
          {pending && <Button variant="secondary" onClick={() => router.refresh()}>Check again</Button>}
          {info.resultsSlug && <Link href={`/r/${info.resultsSlug}`} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted">See the results</Link>}
        </div>
      </Shell>
    );
  }
  if (phase === "voted") {
    return <Shell>{head("You’ve already voted")}<Notice tone="info">{info.restricted ? "A ballot has already been submitted for these details, so they can’t be used again." : "A ballot has already been submitted from this browser, so it can’t be used to vote again."} If this wasn’t you, tell the organizers.</Notice></Shell>;
  }
  if (phase === "done") {
    return (
      <Shell>
        <div className="q-rise text-center">
          <CheckCircle2 className="mx-auto size-10 text-good" aria-hidden />
          <h1 ref={heading} tabIndex={-1} className="mt-4 text-2xl font-semibold tracking-tight outline-none">Your ballot is in</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-6 text-muted-fg">Thank you for voting in {info.title}. Your ballot is stored without your name or email, and it can’t be changed. You can close this page.</p>
          {info.resultsSlug && <p className="mt-6"><Link href={`/r/${info.resultsSlug}`} className="text-sm underline underline-offset-4 hover:text-fg">See the results</Link></p>}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <nav aria-label="Progress" className="mb-8">
        <ol className="flex items-center gap-2 text-sm">
          {steps.map((s, i) => (
            <li key={s} aria-current={i === stepIndex ? "step" : undefined} className={cn("flex items-center gap-2", i === stepIndex ? "font-medium text-fg" : i < stepIndex ? "text-muted-fg" : "text-muted-fg/70")}>
              {i > 0 && <span aria-hidden className="h-px w-6 bg-border" />}{s}
            </li>
          ))}
        </ol>
      </nav>

      <div key={phase} className="q-rise">
        {phase === "verify" && (
          <>
            {head(info.title, <>
              {info.description && <p className="mt-3 max-w-prose whitespace-pre-line text-[15px] leading-6 text-muted-fg">{info.description}</p>}
              {info.endsAt && <p className="mt-3 text-sm text-muted-fg">Voting closes {formatDateTime(info.endsAt, info.timezone)}.</p>}
            </>)}
            {error && <Notice tone="danger" className="mb-5">{error}</Notice>}
            <form onSubmit={verify} className="space-y-5" noValidate>
              {info.restricted ? (
                <>
                  <p className="text-[15px] text-muted-fg">Enter the details the organizers have on file for you.</p>
                  {info.fields.map((f, i) => (
                    <Field key={f.key} label={f.label} error={fe[f.key]}>
                      {(p) => <Input {...p} name={f.key} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        type={f.kind === "email" ? "email" : f.kind === "pin" ? "password" : "text"} autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus={i === 0} maxLength={400} />}
                    </Field>
                  ))}
                </>
              ) : <p className="text-[15px] text-muted-fg">Anyone with this link can vote once from this browser. Your browser needs to allow cookies.</p>}
              <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">{info.restricted ? "Continue" : "Start voting"}</Button>
            </form>
          </>
        )}

        {phase === "choose" && (
          <>
            {head(info.title, <>
              <p className="mt-2 text-sm text-muted-fg">You have until {credential && formatDateTime(credential.expiresAt, info.timezone)} to submit. Nothing is saved until you submit.</p>
            </>)}
            {error && <Notice tone="danger" className="mb-5">{error}</Notice>}
            <div className="space-y-10">
              {ballot.map((p) => {
                const chosen = picks[p.id] ?? [];
                const multi = p.maxSelections > 1;
                const full = multi && chosen.length >= p.maxSelections;
                return (
                  <fieldset key={p.id} id={`pos-${p.id}`} className="min-w-0" aria-describedby={`hint-${p.id}`}>
                    <legend className="text-lg font-semibold tracking-tight">{p.title}</legend>
                    {p.description && <p className="mt-1 max-w-prose text-sm text-muted-fg">{p.description}</p>}
                    <p id={`hint-${p.id}`} className={cn("mt-1 text-sm", missing.has(p.id) ? "font-medium text-danger" : "text-muted-fg")} role={missing.has(p.id) ? "alert" : undefined}>
                      {missing.has(p.id) ? (p.allowAbstain ? "Choose someone, or abstain." : "Make a choice to continue.") : multi ? `Choose up to ${p.maxSelections}. ${chosen.length} chosen.` : "Choose one."}
                    </p>
                    <div className="mt-3 space-y-2">
                      {p.candidates.map((c) => (
                        <Option key={c.id} type={multi ? "checkbox" : "radio"} name={p.id} checked={chosen.includes(c.id)} disabled={multi && full && !chosen.includes(c.id)} onChange={(on) => pick(p, c.id, on)}>
                          {(c.imageUrl || c.bio) && <Avatar name={c.name} src={c.imageUrl} className="size-10" />}
                          <span className="min-w-0"><span className="block font-medium">{c.name}</span>{c.bio && <span className="mt-0.5 block text-sm leading-5 text-muted-fg">{c.bio}</span>}</span>
                        </Option>
                      ))}
                      {p.allowAbstain && (
                        <Option type={multi ? "checkbox" : "radio"} name={p.id} checked={abstain.has(p.id)} onChange={() => choseAbstain(p)}>
                          <span className="min-w-0"><span className="block font-medium">Abstain</span><span className="block text-sm text-muted-fg">Don’t choose anyone for this.</span></span>
                        </Option>
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="mt-10 flex gap-2"><Button size="lg" onClick={toReview}>Review your ballot</Button></div>
          </>
        )}

        {phase === "review" && (
          <>
            {head("Review your ballot", <><p className="mt-2 text-sm text-muted-fg">Once you submit, you can’t change your vote.</p></>)}
            {error && <Notice tone="danger" className="mb-5">{error}</Notice>}
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {ballot.map((p) => {
                const names = (picks[p.id] ?? []).map((id) => p.candidates.find((c) => c.id === id)?.name).filter(Boolean);
                return (
                  <div key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4">
                    <dt className="font-medium">{p.title}</dt>
                    <dd className={cn("text-right", names.length === 0 && "text-muted-fg")}>{names.length ? names.join(", ") : "Abstained"}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-8 flex flex-wrap gap-2">
              <Button size="lg" loading={busy} onClick={submit}>Submit ballot</Button>
              <Button size="lg" variant="secondary" disabled={busy} onClick={() => setPhase("choose")}>Change a choice</Button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-xl">{children}</div>;
}

function Option({ type, name, checked, disabled, onChange, children }: { type: "radio" | "checkbox"; name: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", checked ? "border-fg bg-muted/60" : "border-border hover:bg-muted/40", disabled && "cursor-not-allowed opacity-50 hover:bg-card")}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[var(--fg)]" />
      {children}
    </label>
  );
}
