"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock, CheckCircle2, CircleDot, Lock, Radio } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ElectionDetail } from "@/server/domain/views";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, Notice } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";

type Props = Pick<ElectionDetail, "id" | "status" | "timezone" | "startsAt" | "endsAt" | "openedAt" | "closedAt" | "publishedAt" | "rosterFreezeAt" | "rosterFrozen" | "ready" | "problems" | "role" | "restricted" | "autoPublish" | "resultsDisclosure"> & { publicResultsUrl: string };
type Dialog = null | "open" | "schedule" | "unschedule" | "close" | "extend" | "publish";

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

export function LifecyclePanel(p: Props) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [startV, setStartV] = useState("");
  const [endV, setEndV] = useState("");
  const isOwner = p.role === "OWNER";

  function show(d: Exclude<Dialog, null>) {
    setProblems([]); setFieldErr(null);
    if (d === "schedule") { setStartV(toLocalInput(p.startsAt ?? inHours(48), p.timezone)); setEndV(toLocalInput(p.endsAt ?? inHours(48 + 72), p.timezone)); }
    if (d === "open") setEndV(toLocalInput(p.endsAt && p.endsAt.getTime() > Date.now() + 10 * 60_000 ? p.endsAt : inHours(72), p.timezone));
    if (d === "extend") setEndV(toLocalInput(p.endsAt ? new Date(p.endsAt.getTime() + 24 * HOUR) : inHours(24), p.timezone));
    setDialog(d);
  }

  /** Runs an API call; on failure keeps the dialog open and explains what to fix. */
  async function run(fn: () => Promise<unknown>, done: string) {
    setProblems([]); setFieldErr(null);
    try { await fn(); toast.success(done); setDialog(null); router.refresh(); }
    catch (err) {
      if (err instanceof ApiError) {
        const list = err.fields?.problems?.split("\n").filter(Boolean);
        if (list?.length) { setProblems(list); return; }
        setFieldErr(err.fields?.endsAt ?? err.fields?.startsAt ?? err.message); return;
      }
      setFieldErr(errorMessage(err));
    }
  }
  const transition = (action: string, extra?: object) => api("POST", `/api/elections/${p.id}/transition`, { action, ...extra });
  const endsIso = () => fromLocalInput(endV, p.timezone);
  const err = (
    <>
      {problems.length > 0 && <Notice tone="danger" title="Not ready yet" className="mb-4"><ul className="list-disc space-y-1 pl-4">{problems.map((x) => <li key={x}>{x}</li>)}</ul></Notice>}
      {fieldErr && <Notice tone="danger" className="mb-4">{fieldErr}</Notice>}
    </>
  );
  const dateInput = (label: string, v: string, set: (s: string) => void, id: string) => (
    <div className="mb-5"><Field label={label} hint={`In ${p.timezone.replace(/_/g, " ")}`}>{(f) => <Input {...f} id={id} type="datetime-local" value={v} onChange={(e) => set(e.target.value)} required />}</Field></div>
  );

  const fixLinks = (
    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
      {p.problems.map((m) => (
        <li key={m}><span>{m}{" "}<Link className="underline underline-offset-4 hover:text-fg" href={`/app/elections/${p.id}/${m.startsWith("Import") ? "voters" : "ballot"}`}>Fix</Link></span></li>
      ))}
    </ul>
  );

  let head: { icon: React.ReactNode; title: string; sub: React.ReactNode };
  switch (p.status) {
    case "SCHEDULED": head = { icon: <CalendarClock className="size-5" />, title: "Scheduled", sub: <>Voting opens {formatDateTime(p.startsAt, p.timezone)} and closes {formatDateTime(p.endsAt, p.timezone)}.</> }; break;
    case "OPEN": head = { icon: <Radio className="size-5 text-good" />, title: "Voting is open", sub: <>Closes {formatDateTime(p.endsAt, p.timezone)}. The ballot and voter list are locked.</> }; break;
    case "CLOSED": head = { icon: <Lock className="size-5" />, title: "Voting is closed", sub: <>Closed {formatDateTime(p.closedAt, p.timezone)}. Results and analytics are ready for you to review.</> }; break;
    case "PUBLISHED": head = { icon: <CheckCircle2 className="size-5 text-good" />, title: "Results are published", sub: <>Published {formatDateTime(p.publishedAt, p.timezone)}. Anyone with the results link can see them.</> }; break;
    default: head = { icon: <CircleDot className="size-5" />, title: "Draft", sub: "Voters can’t see this election yet. Finish the ballot and voter list, then schedule or open voting." };
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="flex gap-3">
          <span className="mt-0.5 text-muted-fg" aria-hidden>{head.icon}</span>
          <div><h2 className="text-lg font-semibold tracking-tight">{head.title}</h2><p className="mt-1 max-w-prose text-[15px] leading-6 text-muted-fg">{head.sub}</p></div>
        </div>

        {p.status === "DRAFT" && !p.ready && <Notice tone="warn" title="Before you can schedule or open voting">{fixLinks}</Notice>}
        {p.status === "SCHEDULED" && p.restricted && p.rosterFreezeAt && !p.rosterFrozen && <p className="text-sm text-muted-fg">The voter list locks {formatDateTime(p.rosterFreezeAt, p.timezone)}, 24 hours before voting opens.</p>}
        {p.status === "SCHEDULED" && p.restricted && p.rosterFrozen && <p className="text-sm text-muted-fg">The voter list is locked.</p>}

        <div className="flex flex-wrap gap-2">
          {p.status === "DRAFT" && <>
            <Button onClick={() => show("schedule")} disabled={!p.ready}>Schedule voting</Button>
            <Button variant="secondary" onClick={() => show("open")} disabled={!p.ready}>Open now</Button>
          </>}
          {p.status === "SCHEDULED" && <>
            <Button variant="secondary" onClick={() => show("open")}>Open now</Button>
            <Button variant="secondary" onClick={() => show("schedule")}>Change times</Button>
            <Button variant="ghost" onClick={() => show("unschedule")}>Back to draft</Button>
          </>}
          {p.status === "OPEN" && <>
            <LinkButton href={`/app/elections/${p.id}/turnout`} variant="secondary">Watch turnout</LinkButton>
            <Button variant="secondary" onClick={() => show("extend")}>Extend voting</Button>
            <Button variant="danger" onClick={() => show("close")}>Close voting now</Button>
          </>}
          {p.status === "CLOSED" && <>
            <LinkButton href={`/app/elections/${p.id}/results`}>Review results</LinkButton>
            <LinkButton href={`/app/elections/${p.id}/analytics`} variant="secondary">See analytics</LinkButton>
            {isOwner ? <Button variant="secondary" onClick={() => show("publish")}>Publish results</Button> : <span className="self-center text-sm text-muted-fg">An owner publishes results.</span>}
          </>}
          {p.status === "PUBLISHED" && <>
            <LinkButton href={`/app/elections/${p.id}/results`}>View results</LinkButton>
            <LinkButton href={`/app/elections/${p.id}/analytics`} variant="secondary">See analytics</LinkButton>
            <LinkButton href={p.publicResultsUrl} variant="ghost" target="_blank" rel="noreferrer">Open public page</LinkButton>
          </>}
        </div>
        {p.status === "OPEN" && p.autoPublish && <p className="text-sm text-muted-fg">Results publish automatically when voting closes.</p>}
      </CardBody>

      <ConfirmDialog open={dialog === "open"} onClose={() => setDialog(null)} title="Open voting now?" confirmLabel="Open voting"
        description="Voters can vote as soon as you confirm. The voter list and ballot lock: you can fix typos in names afterwards, but not add, remove or reorder anything."
        onConfirm={async () => { const e = endsIso(); if (!e) { setFieldErr("Choose when voting should close."); return; } await run(() => transition("open", { endsAt: e }), "Voting is open"); }}>
        {err}{dateInput("Voting closes", endV, setEndV, "open-ends")}
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "schedule"} onClose={() => setDialog(null)} title={p.status === "SCHEDULED" ? "Change times" : "Schedule voting"} confirmLabel={p.status === "SCHEDULED" ? "Save times" : "Schedule"}
        description="Voting opens and closes on its own at these times. We re-check readiness when you confirm."
        onConfirm={async () => {
          const s = fromLocalInput(startV, p.timezone), e = endsIso();
          if (!s || !e) { setFieldErr("Choose both a start and an end time."); return; }
          await run(async () => { await api("PATCH", `/api/elections/${p.id}`, { startsAt: s, endsAt: e }); if (p.status === "DRAFT") await transition("schedule"); }, p.status === "DRAFT" ? "Voting scheduled" : "Times saved");
        }}>
        {err}{dateInput("Voting opens", startV, setStartV, "sched-start")}{dateInput("Voting closes", endV, setEndV, "sched-end")}
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "unschedule"} onClose={() => setDialog(null)} title="Move back to draft?" confirmLabel="Back to draft"
        description="Voting won’t open on its own. You can schedule it again once you’re ready. This isn’t possible after the voter list has locked."
        onConfirm={() => run(() => transition("unschedule"), "Back to draft")}>{err}</ConfirmDialog>

      <ConfirmDialog open={dialog === "extend"} onClose={() => setDialog(null)} title="Extend voting" confirmLabel="Extend"
        description="Pick a later closing time. Voters who haven’t voted keep their access."
        onConfirm={async () => { const e = endsIso(); if (!e) { setFieldErr("Choose a new end time."); return; } await run(() => api("POST", `/api/elections/${p.id}/extend`, { endsAt: e }), "Voting extended"); }}>
        {err}{dateInput("New closing time", endV, setEndV, "extend-ends")}
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "close"} onClose={() => setDialog(null)} tone="danger" title="Close voting now?" confirmLabel="Close voting" confirmText="close"
        description="No one can vote after this, including people already part-way through. Closing can’t be undone."
        onConfirm={() => run(() => transition("close"), "Voting closed")}>{err}</ConfirmDialog>

      <ConfirmDialog open={dialog === "publish"} onClose={() => setDialog(null)} title="Publish results?" confirmLabel="Publish results"
        description={p.resultsDisclosure === "AFTER_CLOSE" ? "Anyone with the results link will be able to see the results and analytics. Review them first if you haven’t." : "Results are already visible on the results link while voting runs. Publishing marks the final outcome."}
        onConfirm={() => run(() => transition("publish"), "Results published")}>{err}</ConfirmDialog>
    </Card>
  );
}
