"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ImportSummary } from "@/server/domain/roster";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, Notice, Spinner, type Tone } from "@/components/ui/misc";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { num, plural } from "@/lib/format";

const LABEL = "__label", GROUP = "__group";
type FieldDef = { key: string; label: string; kind: string };
type Stats = { total: number; ok: number; warning: number; error: number; duplicate: number; ambiguous: number; skipped: number; imported?: number };
type Row = { id: string; rowIndex: number; status: string; issues: string[]; confidence: number | null; resolution: string | null; cells: Record<string, string> };
type Rows = { page: number; pageSize: number; total: number; rows: Row[] };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  OK: { label: "Ready", tone: "good" }, WARNING: { label: "Check", tone: "warn" }, ERROR: { label: "Needs a fix", tone: "danger" },
  DUPLICATE: { label: "Duplicate", tone: "neutral" }, AMBIGUOUS: { label: "Look-alike", tone: "warn" }, SKIPPED: { label: "Skipped", tone: "neutral" },
};
const FAIL_TEXT: Record<string, string> = {
  ROSTER_FROZEN: "The voter list locked before this file could be read.",
  TOO_MANY_ROWS: "The file has more rows than this server allows.",
  PROVIDER_NOT_CONFIGURED: "Reading this kind of file needs a document reader that isn’t set up. Upload a CSV or paste the voters instead.",
  EXPIRED: "This import expired and was discarded.",
};
const failText = (code: string | null) => (code && FAIL_TEXT[code]) || "We couldn’t read that file. Check it has a header row and try again, or paste the voters instead.";
const asStats = (s: unknown) => s as Stats | null;

export function ImportWorkspace({ electionId, initial, fields, frozen }: { electionId: string; initial: ImportSummary; fields: FieldDef[]; frozen: boolean }) {
  const router = useRouter(); const toast = useToast();
  const base = `/api/elections/${electionId}/imports/${initial.id}`;
  const back = `/app/elections/${electionId}/voters`;
  const [imp, setImp] = useState(initial);
  const [stats, setStats] = useState<Stats | null>(asStats(initial.stats));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll while the server is working on it.
  useEffect(() => {
    if (imp.status !== "PARSING" && imp.status !== "CONFIRMING") return;
    const t = setInterval(async () => {
      try { const next = await api<ImportSummary>("GET", base); setImp(next); setStats(asStats(next.stats)); } catch { /* try again on the next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [imp.status, base]);

  async function call(name: string, fn: () => Promise<void>) {
    setBusy(name); setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }
  const parse = () => call("parse", async () => { const r = await api<ImportSummary>("POST", `${base}/parse`); setImp(r); setStats(asStats(r.stats)); });
  const discard = () => call("discard", async () => { await api("POST", `${base}/reject`); toast.success("Import discarded"); router.push(back); router.refresh(); });

  const head = <><p className="mb-2 text-sm text-muted-fg"><Link href={back} className="hover:text-fg">Voters</Link></p><h2 className="mb-1 text-2xl font-semibold tracking-tight">Review voters</h2><p className="mb-8 text-sm text-muted-fg">{imp.originalName}</p></>;
  const errorNotice = error && <Notice tone="danger" className="mb-6">{error}</Notice>;

  if (imp.status === "PARSING" || imp.status === "CONFIRMING") {
    return <div>{head}<Card><CardBody className="flex items-center gap-3 py-10"><Spinner className="size-5" /><div><p className="font-medium">{imp.status === "PARSING" ? "Reading your file…" : "Adding voters…"}</p><p className="text-sm text-muted-fg">This page updates by itself. You can leave and come back.</p></div></CardBody></Card></div>;
  }
  if (imp.status === "IMPORTED") {
    return <div>{head}<Notice tone="good" title={`${plural(stats?.imported ?? 0, "voter")} added`}>The file and the staged rows have been deleted.</Notice><div className="mt-6"><Button onClick={() => router.push(back)}>Back to voters</Button></div></div>;
  }
  if (imp.status === "REJECTED") {
    return <div>{head}<Notice tone="info" title="This import was discarded">{imp.errorCode ? failText(imp.errorCode) : "Nothing was added."}</Notice><div className="mt-6"><Button onClick={() => router.push(`${back}/import`)}>Start a new import</Button></div></div>;
  }
  if (imp.status === "AWAITING_UPLOAD" || imp.status === "UPLOADED" || imp.status === "FAILED") {
    return (
      <div>{head}{errorNotice}
        <Notice tone={imp.status === "FAILED" ? "danger" : "warn"} title={imp.status === "FAILED" ? "We couldn’t read this file" : imp.status === "UPLOADED" ? "The file is uploaded but hasn’t been read yet" : "The upload didn’t finish"}>
          {imp.status === "FAILED" ? failText(imp.errorCode) : imp.status === "UPLOADED" ? "Read it to continue." : "Start again with the same file."}
        </Notice>
        <div className="mt-6 flex gap-2">
          {imp.status !== "AWAITING_UPLOAD" && <Button loading={busy === "parse"} onClick={parse}>{imp.status === "FAILED" ? "Try again" : "Read the file"}</Button>}
          <Button variant="secondary" loading={busy === "discard"} onClick={discard}>Discard</Button>
        </div>
      </div>
    );
  }
  return <Review {...{ electionId, imp, setImp, stats, setStats, fields, frozen, base, back, head, discard, busy }} />;
}

function issueText(code: string, fields: FieldDef[]) {
  const [kind, key] = code.split(":");
  const f = fields.find((x) => x.key === key)?.label ?? key;
  switch (code) {
    case "label:missing": return "No name, so a masked identifier will be shown";
    case "confidence:low": return "Low reading confidence. Check against the source";
    case "duplicate:roster": return "Already on the voter list";
    case "duplicate:file": return "Repeated earlier in this file";
    case "ambiguous:roster": return `Shares ${fields[0]?.label ?? "an identifier"} with a voter already on the list`;
    case "ambiguous:file": return `Shares ${fields[0]?.label ?? "an identifier"} with another row in this file`;
  }
  if (kind === "missing") return `${f} is missing`;
  if (kind === "invalid") return `${f} doesn’t look valid`;
  return code;
}

function Review({ electionId, imp, setImp, stats, setStats, fields, frozen, base, back, head, discard, busy: outerBusy }: {
  electionId: string; imp: ImportSummary; setImp: (i: ImportSummary) => void; stats: Stats | null; setStats: (s: Stats) => void; fields: FieldDef[]; frozen: boolean; base: string; back: string; head: React.ReactNode; discard: () => void; busy: string | null;
}) {
  const router = useRouter(); const toast = useToast();
  const mapping = imp.mapping as Record<string, string>;
  const complete = fields.every((f) => mapping[f.key]);
  const [map, setMap] = useState<Record<string, string>>(mapping);
  const [filter, setFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<Rows | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [confirm, setConfirm] = useState(false);

  const shown = useMemo(() => {
    const cols: { col: string; label: string }[] = [];
    for (const f of fields) if (mapping[f.key]) cols.push({ col: mapping[f.key]!, label: f.label });
    if (mapping[LABEL]) cols.push({ col: mapping[LABEL]!, label: "Name" });
    if (mapping[GROUP]) cols.push({ col: mapping[GROUP]!, label: "Group" });
    return cols;
  }, [fields, mapping]);

  useEffect(() => {
    if (!complete) return;
    let live = true; setLoading(true);
    api<Rows>("GET", `${base}/rows?page=${page}${filter !== "ALL" ? `&status=${filter}` : ""}`)
      .then((r) => { if (live) { setRows(r); setError(null); } })
      .catch((e) => { if (live) setError(errorMessage(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [base, complete, filter, page, version]);

  const mutate = useCallback(async (fn: () => Promise<{ stats: Stats }>, ok?: string) => {
    setError(null);
    try { const r = await fn(); setStats(r.stats); setVersion((v) => v + 1); if (ok) toast.success(ok); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
  }, [setStats, toast]);

  async function saveMapping() {
    const missing = fields.filter((f) => !map[f.key]);
    if (missing.length) { setError(`Choose a column for: ${missing.map((m) => m.label).join(", ")}.`); return; }
    setSaving(true);
    const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v));
    const ok = await mutate(() => api<{ stats: Stats }>("PUT", `${base}/mapping`, { mapping: clean }), "Columns matched");
    if (ok) setImp({ ...imp, mapping: clean });
    setSaving(false);
  }

  const ready = (stats?.ok ?? 0) + (stats?.warning ?? 0);
  const blockers = stats?.error ?? 0;
  const tabs = [["ALL", "All", stats?.total ?? 0], ["OK", "Ready", stats?.ok ?? 0], ["WARNING", "Check", stats?.warning ?? 0], ["ERROR", "Needs a fix", stats?.error ?? 0], ["AMBIGUOUS", "Look-alikes", stats?.ambiguous ?? 0], ["DUPLICATE", "Duplicates", stats?.duplicate ?? 0], ["SKIPPED", "Skipped", stats?.skipped ?? 0]] as const;
  const pages = rows ? Math.max(1, Math.ceil(rows.total / rows.pageSize)) : 1;
  const targets = [...fields.map((f) => ({ key: f.key, label: f.label, required: true })), { key: LABEL, label: "Name (shown in the voter list)", required: false }, { key: GROUP, label: "Group (for turnout by group)", required: false }];

  return (
    <div>
      {head}
      {error && <Notice tone="danger" className="mb-6">{error}</Notice>}

      <Card className="mb-8">
        <CardHeader title="1. Match columns" description="Tell us which column in your file holds each detail. We’ve guessed where we could." />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {targets.map((t) => (
              <Field key={t.key} label={t.label} optional={!t.required}>
                {(p) => <Select {...p} value={map[t.key] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [t.key]: e.target.value }))}>
                  <option value="">{t.required ? "Choose a column" : "None"}</option>
                  {imp.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>}
              </Field>
            ))}
          </div>
          <Button variant={complete ? "secondary" : "primary"} loading={saving} onClick={saveMapping} disabled={JSON.stringify(Object.fromEntries(Object.entries(map).filter(([, v]) => v))) === JSON.stringify(mapping) && complete}>{complete ? "Update matches" : "Save and review rows"}</Button>
        </CardBody>
      </Card>

      {complete && (
        <section aria-labelledby="rows-h" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h3 id="rows-h" className="text-[15px] font-semibold">2. Review rows</h3><p className="text-sm text-muted-fg">Fix or skip anything marked “Needs a fix”. Rows that are ready are added when you confirm.</p></div>
            <Button variant="secondary" size="sm" onClick={() => setEdit("new")} disabled={frozen}><Plus className="size-4" />Add a row</Button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter rows">
            {tabs.filter(([id, , n]) => id === "ALL" || n > 0).map(([id, label, n]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(1); }}
                className={cn("rounded-full border px-3 py-1 text-sm transition-colors", filter === id ? "border-fg bg-fg text-bg" : "border-border bg-card text-muted-fg hover:text-fg")}>{label} <span className="tabular-nums opacity-70">{num(n)}</span></button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-muted-fg">
                <tr><th scope="col" className="w-12 px-4 py-2.5 font-medium">#</th>{shown.map((c) => <th key={c.col} scope="col" className="px-4 py-2.5 font-medium">{c.label}</th>)}<th scope="col" className="px-4 py-2.5 font-medium">Status</th><th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody className={cn("divide-y divide-border", loading && "opacity-60 transition-opacity")}>
                {rows?.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3 tabular-nums text-muted-fg">{r.rowIndex + 1}</td>
                    {shown.map((c) => <td key={c.col} className="max-w-[220px] truncate px-4 py-3">{r.cells[c.col] || <span className="text-muted-fg">–</span>}</td>)}
                    <td className="px-4 py-3">
                      <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{r.resolution === "KEEP" && r.status === "AMBIGUOUS" ? "Keeping both" : STATUS[r.status]?.label ?? r.status}</Badge>
                      {r.issues.length > 0 && r.status !== "SKIPPED" && <ul className="mt-1.5 space-y-0.5 text-[13px] text-muted-fg">{r.issues.map((i) => <li key={i}>{issueText(i, fields)}</li>)}</ul>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Button variant="ghost" size="sm" aria-label={`Edit row ${r.rowIndex + 1}`} onClick={() => setEdit(r)}><Pencil className="size-3.5" />Edit</Button>
                      {r.status === "AMBIGUOUS" && r.resolution !== "KEEP" && <Button variant="ghost" size="sm" onClick={() => mutate(() => api("POST", `${base}/rows/${r.id}/resolve`, { action: "KEEP" }))}>Keep</Button>}
                      {r.status === "SKIPPED" ? <Button variant="ghost" size="sm" onClick={() => mutate(() => api("POST", `${base}/rows/${r.id}/resolve`, { action: "CLEAR" }))}>Restore</Button> : <Button variant="ghost" size="sm" onClick={() => mutate(() => api("POST", `${base}/rows/${r.id}/resolve`, { action: "SKIP" }))}>Skip</Button>}
                    </td>
                  </tr>
                ))}
                {rows && rows.rows.length === 0 && <tr><td colSpan={shown.length + 3} className="px-4 py-10 text-center text-muted-fg">{filter === "ALL" ? "No rows yet. Add one to get started." : "No rows in this group."}</td></tr>}
                {!rows && <tr><td colSpan={shown.length + 3} className="px-4 py-10 text-center text-muted-fg"><Spinner className="mx-auto size-5" /></td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && <div className="flex items-center justify-between text-sm"><span className="text-muted-fg">Page {page} of {pages}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
            <p className="text-sm"><span className="font-medium">3. Confirm.</span>{" "}<span className="text-muted-fg">{blockers > 0 ? `${plural(blockers, "row")} still ${blockers === 1 ? "needs" : "need"} a fix or a skip.` : `${plural(ready, "voter")} ready to add.`}{stats && stats.ambiguous > 0 ? ` ${plural(stats.ambiguous, "look-alike")} to decide.` : ""}</span></p>
            <div className="flex gap-2"><Button variant="ghost" onClick={discard} loading={outerBusy === "discard"}>Discard</Button><Button onClick={() => setConfirm(true)} disabled={frozen || blockers > 0 || (ready === 0 && !stats?.ambiguous)}>Add voters</Button></div>
          </div>
        </section>
      )}

      <RowDialog key={edit === null ? "none" : edit === "new" ? "new" : edit.id} row={edit} onClose={() => setEdit(null)} columns={shown} fields={fields} mapping={mapping}
        onSave={async (cells) => {
          const ok = await mutate(() => edit === "new" ? api<{ stats: Stats }>("POST", `${base}/rows`, { cells }) : api<{ stats: Stats }>("PATCH", `${base}/rows/${(edit as Row).id}`, { cells }), edit === "new" ? "Row added" : "Row updated");
          if (ok) setEdit(null);
        }} />

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} confirmLabel="Add voters" title={`Add ${plural(ready, "voter")} to the list?`}
        description="Skipped, duplicate and unresolved rows are left out. The uploaded file and the staged rows are deleted once this finishes. You can add more until the list locks."
        onConfirm={async () => {
          try {
            const r = await api<ImportSummary>("POST", `${base}/confirm`);
            toast.success(`${plural(asStats(r.stats)?.imported ?? ready, "voter")} added`); setConfirm(false); router.push(back); router.refresh();
          } catch (e) { setConfirm(false); setError(errorMessage(e)); setVersion((v) => v + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
        }} />
    </div>
  );
}

function RowDialog({ row, onClose, columns, fields, mapping, onSave }: { row: Row | "new" | null; onClose: () => void; columns: { col: string; label: string }[]; fields: FieldDef[]; mapping: Record<string, string>; onSave: (cells: Record<string, string>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const secretCols = new Set(fields.filter((f) => f.kind === "pin").map((f) => mapping[f.key]));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const cells: Record<string, string> = {};
    for (const c of columns) { const v = String(fd.get(c.col) ?? ""); if (secretCols.has(c.col) && row !== "new" && !v) continue; cells[c.col] = v; }
    setBusy(true); await onSave(cells); setBusy(false);
  }
  const existing = row && row !== "new" ? row : null;
  return (
    <Dialog locked={busy} open={row !== null} onClose={onClose} title={row === "new" ? "Add a row" : "Edit row"} description={existing ? existing.issues.map((i) => issueText(i, fields)).join(". ") || undefined : undefined}>
      <form onSubmit={submit} className="space-y-4">
        {columns.map((c, i) => {
          const secret = secretCols.has(c.col);
          return (
            <Field key={c.col} label={c.label} optional={c.label === "Name" || c.label === "Group"} hint={secret && existing ? "Leave blank to keep the current value." : undefined}>
              {(p) => <Input {...p} name={c.col} type={secret ? "password" : "text"} autoComplete="off" defaultValue={secret ? "" : existing?.cells[c.col] ?? ""} autoFocus={i === 0} maxLength={400} />}
            </Field>
          );
        })}
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{row === "new" ? "Add row" : "Save row"}</Button></div>
      </form>
    </Dialog>
  );
}
