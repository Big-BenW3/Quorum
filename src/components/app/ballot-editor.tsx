"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { imageProblem, uploadAsset } from "@/lib/upload";
import type { ElectionDetail } from "@/server/domain/views";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState, Notice } from "@/components/ui/misc";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/app/avatar";
import { plural } from "@/lib/format";

type Position = ElectionDetail["positions"][number];
type Candidate = Position["candidates"][number];
type Edit =
  | { t: "position"; p?: Position }
  | { t: "candidate"; pos: Position; c?: Candidate }
  | { t: "correct"; c: Candidate }
  | { t: "del-position"; p: Position }
  | { t: "del-candidate"; c: Candidate }
  | null;

const move = <T,>(arr: T[], i: number, d: -1 | 1) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j]!, a[i]!]; return a; };

export function BallotEditor({ electionId, positions, editable, maxImageBytes }: { electionId: string; positions: Position[]; editable: boolean; maxImageBytes: number }) {
  const router = useRouter();
  const toast = useToast();
  const [edit, setEdit] = useState<Edit>(null);
  const close = () => setEdit(null);
  const done = (msg: string) => { toast.success(msg); close(); router.refresh(); };
  async function reorder(url: string, ids: string[]) {
    try { await api("POST", url, { ids }); router.refresh(); } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <div className="space-y-6">
      {!editable && <Notice tone="info" title="The ballot is locked">Voting has started, so positions and candidates can’t change. You can still fix typos in a candidate’s name or bio. Each fix is recorded in the activity log.</Notice>}

      {positions.length === 0 ? (
        <EmptyState title="No positions yet" action={editable ? <Button onClick={() => setEdit({ t: "position" })}><Plus className="size-4" />Add a position</Button> : undefined}>A position is one question on the ballot, such as “President”, with the candidates or options voters can choose from.</EmptyState>
      ) : (
        positions.map((p, pi) => (
          <Card key={p.id} as="section">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold tracking-tight">{p.title}</h2>
                {p.description && <p className="mt-1 max-w-prose text-sm text-muted-fg">{p.description}</p>}
                <p className="mt-2 text-sm text-muted-fg">{p.maxSelections === 1 ? "Pick one" : `Pick up to ${p.maxSelections}`} · {plural(p.seats, "seat")} to fill{p.allowAbstain ? " · Voters can abstain" : ""}</p>
              </div>
              {editable && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Move ${p.title} up`} disabled={pi === 0} onClick={() => reorder(`/api/elections/${electionId}/positions/reorder`, move(positions, pi, -1).map((x) => x.id))}><ArrowUp className="size-4" /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Move ${p.title} down`} disabled={pi === positions.length - 1} onClick={() => reorder(`/api/elections/${electionId}/positions/reorder`, move(positions, pi, 1).map((x) => x.id))}><ArrowDown className="size-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setEdit({ t: "position", p })}><Pencil className="size-4" />Edit</Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${p.title}`} onClick={() => setEdit({ t: "del-position", p })}><Trash2 className="size-4" /></Button>
                </div>
              )}
            </div>
            <CardBody className="p-0">
              {p.candidates.length === 0 ? <p className="p-5 text-sm text-muted-fg">No candidates yet.</p> : (
                <ul className="divide-y divide-border">
                  {p.candidates.map((c, ci) => (
                    <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar name={c.name} src={c.imageUrl} />
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.name}</p>{c.bio && <p className="truncate text-sm text-muted-fg">{c.bio}</p>}</div>
                      {editable ? (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" aria-label={`Move ${c.name} up`} disabled={ci === 0} onClick={() => reorder(`/api/positions/${p.id}/candidates/reorder`, move(p.candidates, ci, -1).map((x) => x.id))}><ArrowUp className="size-4" /></Button>
                          <Button variant="ghost" size="icon" aria-label={`Move ${c.name} down`} disabled={ci === p.candidates.length - 1} onClick={() => reorder(`/api/positions/${p.id}/candidates/reorder`, move(p.candidates, ci, 1).map((x) => x.id))}><ArrowDown className="size-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setEdit({ t: "candidate", pos: p, c })}>Edit</Button>
                          <Button variant="ghost" size="icon" aria-label={`Remove ${c.name}`} onClick={() => setEdit({ t: "del-candidate", c })}><Trash2 className="size-4" /></Button>
                        </div>
                      ) : <Button variant="ghost" size="sm" onClick={() => setEdit({ t: "correct", c })}>Fix a typo</Button>}
                    </li>
                  ))}
                </ul>
              )}
              {editable && <div className="border-t border-border p-3"><Button variant="ghost" size="sm" onClick={() => setEdit({ t: "candidate", pos: p })}><Plus className="size-4" />Add a candidate</Button></div>}
            </CardBody>
          </Card>
        ))
      )}
      {editable && positions.length > 0 && <Button variant="secondary" onClick={() => setEdit({ t: "position" })}><Plus className="size-4" />Add a position</Button>}

      <PositionDialog key={edit?.t === "position" ? edit.p?.id ?? "new" : "x"} open={edit?.t === "position"} position={edit?.t === "position" ? edit.p : undefined} electionId={electionId} onClose={close} onDone={done} />
      <CandidateDialog key={edit?.t === "candidate" ? `${edit.pos.id}-${edit.c?.id ?? "new"}` : "y"} open={edit?.t === "candidate"} position={edit?.t === "candidate" ? edit.pos : undefined} candidate={edit?.t === "candidate" ? edit.c : undefined} electionId={electionId} maxImageBytes={maxImageBytes} onClose={close} onDone={done} />
      <CorrectDialog key={edit?.t === "correct" ? edit.c.id : "z"} open={edit?.t === "correct"} candidate={edit?.t === "correct" ? edit.c : undefined} onClose={close} onDone={done} />

      <ConfirmDialog open={edit?.t === "del-position"} onClose={close} tone="danger" confirmLabel="Delete position" title={`Delete “${edit?.t === "del-position" ? edit.p.title : ""}”?`}
        description={edit?.t === "del-position" && edit.p.candidates.length ? `This also removes its ${plural(edit.p.candidates.length, "candidate")}.` : "This can’t be undone."}
        onConfirm={async () => { if (edit?.t !== "del-position") return; try { await api("DELETE", `/api/positions/${edit.p.id}`); done("Position deleted"); } catch (e) { toast.error(errorMessage(e)); close(); } }} />
      <ConfirmDialog open={edit?.t === "del-candidate"} onClose={close} tone="danger" confirmLabel="Remove candidate" title={`Remove ${edit?.t === "del-candidate" ? edit.c.name : ""}?`} description="They’ll no longer appear on the ballot."
        onConfirm={async () => { if (edit?.t !== "del-candidate") return; try { await api("DELETE", `/api/candidates/${edit.c.id}`); done("Candidate removed"); } catch (e) { toast.error(errorMessage(e)); close(); } }} />
    </div>
  );
}

function PositionDialog({ open, position, electionId, onClose, onDone }: { open: boolean; position?: Position; electionId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  const [abstain, setAbstain] = useState(position?.allowAbstain ?? true);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    const body = { title: String(fd.get("title") ?? ""), description: String(fd.get("description") ?? "").trim() || null, maxSelections: Number(fd.get("max") || 1), seats: Number(fd.get("seats") || 1), allowAbstain: abstain };
    setBusy(true); setError(null); setFe({});
    try {
      if (position) await api("PATCH", `/api/positions/${position.id}`, body); else await api("POST", `/api/elections/${electionId}/positions`, body);
      onDone(position ? "Position saved" : "Position added");
    } catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFe(err.fields); setBusy(false); }
  }
  return (
    <Dialog locked={busy} open={open} onClose={onClose} title={position ? "Edit position" : "Add a position"} description="One question on the ballot, such as “President” or “Approve the budget?”">
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && !Object.keys(fe).length && <Notice tone="danger">{error}</Notice>}
        <Field label="Title" error={fe.title}>{(p) => <Input {...p} name="title" defaultValue={position?.title} required maxLength={120} autoFocus />}</Field>
        <Field label="Description" optional error={fe.description}>{(p) => <Textarea {...p} name="description" defaultValue={position?.description ?? ""} rows={2} maxLength={500} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Choices per voter" error={fe.maxSelections} hint="How many a voter can pick.">{(p) => <Input {...p} name="max" type="number" min={1} max={20} defaultValue={position?.maxSelections ?? 1} />}</Field>
          <Field label="Seats to fill" error={fe.seats} hint="How many winners.">{(p) => <Input {...p} name="seats" type="number" min={1} max={20} defaultValue={position?.seats ?? 1} />}</Field>
        </div>
        <Switch checked={abstain} onChange={setAbstain} label="Allow abstaining" description="Voters can submit without choosing anyone for this position." />
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{position ? "Save" : "Add position"}</Button></div>
      </form>
    </Dialog>
  );
}

function CandidateDialog({ open, position, candidate, electionId, maxImageBytes, onClose, onDone }: { open: boolean; position?: Position; candidate?: Candidate; electionId: string; maxImageBytes: number; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null); const [removeImg, setRemoveImg] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  const preview = objectUrl ?? (removeImg ? null : candidate?.imageUrl ?? null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!position) return; const fd = new FormData(e.currentTarget);
    setBusy(true); setError(null); setFe({});
    try {
      const imageUploadId = file ? await uploadAsset(electionId, "CANDIDATE_IMAGE", file) : removeImg ? null : undefined;
      const body = { name: String(fd.get("name") ?? ""), bio: String(fd.get("bio") ?? "").trim() || null, ...(imageUploadId !== undefined ? { imageUploadId } : {}) };
      if (candidate) await api("PATCH", `/api/candidates/${candidate.id}`, body); else await api("POST", `/api/positions/${position.id}/candidates`, body);
      onDone(candidate ? "Candidate saved" : "Candidate added");
    } catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFe(err.fields); setBusy(false); }
  }
  return (
    <Dialog locked={busy} open={open} onClose={onClose} title={candidate ? "Edit candidate" : "Add a candidate"} description={position ? `For “${position.title}”. For a yes/no question, add “Yes” and “No” as options.` : undefined}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && !Object.keys(fe).length && <Notice tone="danger">{error}</Notice>}
        <Field label="Name" error={fe.name}>{(p) => <Input {...p} name="name" defaultValue={candidate?.name} required maxLength={100} autoFocus />}</Field>
        <Field label="Bio" optional error={fe.bio} hint="One or two lines voters see under the name.">{(p) => <Textarea {...p} name="bio" defaultValue={candidate?.bio ?? ""} rows={3} maxLength={1000} />}</Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">Photo <span className="font-normal text-muted-fg">(optional)</span></p>
          <div className="flex items-center gap-3">
            <Avatar name={candidate?.name ?? "?"} src={preview} className="size-14" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => input.current?.click()}><ImagePlus className="size-4" />{preview ? "Replace" : "Choose image"}</Button>
              {preview && <Button variant="ghost" size="sm" onClick={() => { setFile(null); setRemoveImg(true); }}>Remove</Button>}
            </div>
            <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Candidate photo" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return; const p = imageProblem(f, maxImageBytes);
              if (p) { setError(p); e.target.value = ""; return; } setError(null); setFile(f); setRemoveImg(false);
            }} />
          </div>
          {fe.imageUploadId && <p className="mt-1.5 text-sm text-danger" role="alert">{fe.imageUploadId}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>{candidate ? "Save" : "Add candidate"}</Button></div>
      </form>
    </Dialog>
  );
}

function CorrectDialog({ open, candidate, onClose, onDone }: { open: boolean; candidate?: Candidate; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!candidate) return; const fd = new FormData(e.currentTarget);
    setBusy(true); setError(null); setFe({});
    try {
      await api("POST", `/api/candidates/${candidate.id}/correct`, { name: String(fd.get("name") ?? ""), bio: String(fd.get("bio") ?? "").trim() || null, reason: String(fd.get("reason") ?? "") });
      onDone("Correction saved");
    } catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFe(err.fields); setBusy(false); }
  }
  return (
    <Dialog locked={busy} open={open} onClose={onClose} title="Fix a typo" description="This changes what voters see right away and is recorded in the activity log with your reason.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && !Object.keys(fe).length && <Notice tone="danger">{error}</Notice>}
        <Field label="Name" error={fe.name}>{(p) => <Input {...p} name="name" defaultValue={candidate?.name} required maxLength={100} autoFocus />}</Field>
        <Field label="Bio" optional error={fe.bio}>{(p) => <Textarea {...p} name="bio" defaultValue={candidate?.bio ?? ""} rows={3} maxLength={1000} />}</Field>
        <Field label="Reason" error={fe.reason} hint="For the activity log, e.g. “Misspelled surname”.">{(p) => <Input {...p} name="reason" required minLength={5} maxLength={200} />}</Field>
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" loading={busy}>Save correction</Button></div>
      </form>
    </Dialog>
  );
}
