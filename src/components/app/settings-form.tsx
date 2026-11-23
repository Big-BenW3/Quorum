"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ElectionDetail } from "@/server/domain/views";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Notice } from "@/components/ui/misc";
import { ChoiceCard, Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { FieldsEditor, type FieldDef } from "@/components/app/new-election-form";
import { fromLocalInput, TIMEZONES, toLocalInput } from "@/lib/format";

type E = Pick<ElectionDetail, "id" | "title" | "description" | "timezone" | "startsAt" | "endsAt" | "restricted" | "fields" | "voters" | "rosterFrozen" | "resultsDisclosure" | "autoPublish" | "tieRule" | "credentialTtlSeconds" | "role" | "status">;

export function SettingsForm({ e, editable }: { e: E; editable: boolean }) {
  const router = useRouter(); const toast = useToast();
  const owner = e.role === "OWNER";
  const canChangeWho = editable && e.voters === 0 && !e.rosterFrozen;
  const init = {
    title: e.title, description: e.description ?? "", timezone: e.timezone,
    start: toLocalInput(e.startsAt, e.timezone), end: toLocalInput(e.endsAt, e.timezone),
    mode: e.restricted ? "RESTRICTED" : "OPEN", fields: e.fields as FieldDef[],
    disclosure: e.resultsDisclosure, autoPublish: e.autoPublish, tie: e.tieRule, ttl: Math.round(e.credentialTtlSeconds / 60),
  };
  const [v, setV] = useState(init);
  const set = <K extends keyof typeof init>(k: K, val: (typeof init)[K]) => setV((x) => ({ ...x, [k]: val }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);

  async function submit(ev: FormEvent) {
    ev.preventDefault(); setBusy(true); setError(null); setFe({});
    const body: Record<string, unknown> = {};
    if (v.title !== init.title) body.title = v.title;
    if (v.description !== init.description) body.description = v.description || null;
    if (v.timezone !== init.timezone) body.timezone = v.timezone;
    if (v.start !== init.start) body.startsAt = fromLocalInput(v.start, v.timezone);
    if (v.end !== init.end) body.endsAt = fromLocalInput(v.end, v.timezone);
    if (v.mode !== init.mode) body.eligibilityMode = v.mode;
    if (JSON.stringify(v.fields) !== JSON.stringify(init.fields)) body.verificationFields = v.fields;
    if (v.ttl !== init.ttl) body.credentialTtlSeconds = v.ttl * 60;
    if (v.disclosure !== init.disclosure) body.resultsDisclosure = v.disclosure;
    if (v.autoPublish !== init.autoPublish) body.autoPublish = v.autoPublish;
    if (v.tie !== init.tie) body.tieRule = v.tie;
    try { await api("PATCH", `/api/elections/${e.id}`, body); toast.success("Settings saved"); router.refresh(); }
    catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFe(err.fields); }
    finally { setBusy(false); }
  }
  const lock = !editable;
  const zones = TIMEZONES.includes(v.timezone) ? TIMEZONES : [v.timezone, ...TIMEZONES];

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {lock && <Notice tone="info" title="Settings are locked">{e.status === "OPEN" ? "Voting has started, so these can’t change. You can still extend voting from the Overview." : "Voting has ended, so these can’t change."}</Notice>}
      {error && !Object.keys(fe).length && <Notice tone="danger">{error}</Notice>}

      <Card><CardHeader title="Details" /><CardBody className="space-y-5">
        <Field label="Title" error={fe.title}>{(p) => <Input {...p} value={v.title} onChange={(x) => set("title", x.target.value)} disabled={lock} maxLength={120} />}</Field>
        <Field label="Description" optional error={fe.description} hint="Shown to voters before they verify.">{(p) => <Textarea {...p} rows={3} value={v.description} onChange={(x) => set("description", x.target.value)} disabled={lock} maxLength={2000} />}</Field>
      </CardBody></Card>

      <Card><CardHeader title="Schedule" description="Times are in the election’s time zone. You can leave them empty until you’re ready to schedule." /><CardBody className="space-y-5">
        <Field label="Time zone" error={fe.timezone}>{(p) => <Select {...p} value={v.timezone} onChange={(x) => set("timezone", x.target.value)} disabled={lock}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>}</Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Voting opens" optional error={fe.startsAt}>{(p) => <Input {...p} type="datetime-local" value={v.start} onChange={(x) => set("start", x.target.value)} disabled={lock} />}</Field>
          <Field label="Voting closes" optional error={fe.endsAt}>{(p) => <Input {...p} type="datetime-local" value={v.end} onChange={(x) => set("end", x.target.value)} disabled={lock} />}</Field>
        </div>
        {e.restricted && <p className="text-sm text-muted-fg">The voter list locks 24 hours before the opening time.</p>}
      </CardBody></Card>

      <Card><CardHeader title="Who can vote" description={canChangeWho ? undefined : e.voters > 0 ? "Remove the imported voters to change this." : e.rosterFrozen ? "The voter list is locked." : undefined} /><CardBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Who can vote">
          <ChoiceCard name="mode" value="RESTRICTED" checked={v.mode === "RESTRICTED"} onChange={() => set("mode", "RESTRICTED")} disabled={!canChangeWho} title="Only people on my list" description="Voters prove who they are against an imported list." />
          <ChoiceCard name="mode" value="OPEN" checked={v.mode === "OPEN"} onChange={() => set("mode", "OPEN")} disabled={!canChangeWho} title="Anyone with the link" description="No list. One ballot per device is a weak limit." />
        </div>
        {v.mode === "RESTRICTED" && (canChangeWho
          ? <div><p className="mb-3 text-sm font-medium">What voters type to verify</p><FieldsEditor fields={v.fields} onChange={(f) => set("fields", f)} error={fe.verificationFields} /></div>
          : <p className="text-sm text-muted-fg">Voters verify with: {e.fields.map((f) => f.label).join(", ")}.</p>)}
        <Field label="Time to finish a ballot (minutes)" error={fe.credentialTtlSeconds} hint="Once verified, a voter has this long to submit before they must verify again. 2 to 60.">
          {(p) => <Input {...p} type="number" min={2} max={60} value={v.ttl} onChange={(x) => set("ttl", Number(x.target.value))} disabled={lock} className="max-w-28" />}
        </Field>
      </CardBody></Card>

      <Card><CardHeader title="Results" description={owner ? "These are fixed before voting starts, so nobody can change the rules once ballots are coming in." : "Only an owner of the organization can change these."} /><CardBody className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="When results are shown">
          <ChoiceCard name="disclosure" value="AFTER_CLOSE" checked={v.disclosure === "AFTER_CLOSE"} onChange={() => set("disclosure", "AFTER_CLOSE")} disabled={lock || !owner} title="After voting closes" description="Nothing is shown while voting runs. Organizers review first, then you publish." />
          <ChoiceCard name="disclosure" value="LIVE" checked={v.disclosure === "LIVE"} onChange={() => set("disclosure", "LIVE")} disabled={lock || !owner} title="Live while voting is open" description="Anyone with the results link sees running totals. This can influence people who haven’t voted yet." />
        </div>
        <Switch checked={v.autoPublish} onChange={(x) => set("autoPublish", x)} disabled={lock || !owner} label="Publish results automatically" description="When voting closes, results and analytics go public without a separate step." />
        <Field label="If candidates tie for the last seat" error={fe.tieRule}>
          {(p) => <Select {...p} value={v.tie} onChange={(x) => set("tie", x.target.value as typeof v.tie)} disabled={lock || !owner}><option value="REPORT_TIE">Report the tie as it is</option><option value="REQUIRE_RUNOFF">Mark the position as needing a runoff</option></Select>}
        </Field>
      </CardBody></Card>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy} disabled={lock || !dirty}>Save changes</Button>
        {dirty && !busy && <Button variant="ghost" onClick={() => { setV(init); setFe({}); setError(null); }}>Discard changes</Button>}
      </div>

      {e.status === "DRAFT" && (
        <Card className="border-danger/30"><CardHeader title="Delete this election" description="Removes the ballot, voter list and settings. Only drafts can be deleted." /><CardBody><Button variant="danger" onClick={() => setDel(true)}>Delete election</Button></CardBody></Card>
      )}
      <ConfirmDialog open={del} onClose={() => setDel(false)} tone="danger" confirmLabel="Delete election" confirmText="delete" title="Delete this election?" description="This can’t be undone."
        onConfirm={async () => { try { await api("DELETE", `/api/elections/${e.id}`); toast.success("Election deleted"); router.push("/app"); router.refresh(); } catch (err) { toast.error(errorMessage(err)); setDel(false); } }} />
    </form>
  );
}
