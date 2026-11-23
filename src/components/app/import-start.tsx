"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { putToTarget, type UploadTarget } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Notice, Card, CardBody } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

type FieldDef = { key: string; label: string; kind: string };
const phases = { request: "Preparing the upload…", upload: "Uploading…", check: "Checking the file…", parse: "Reading the rows…" } as const;

function sampleCsv(fields: FieldDef[]) {
  const sample = (f: FieldDef, n: number) => (f.kind === "email" ? `voter${n}@example.org` : f.kind === "pin" ? `${4830 + n}` : f.kind === "id" ? `M-${1000 + n}` : `Value ${n}`);
  const head = [...fields.map((f) => f.key), "name", "group"].join(",");
  return [head, ...[1, 2].map((n) => [...fields.map((f) => sample(f, n)), n === 1 ? "Sam Lee" : "Ana Ruiz", n === 1 ? "Seniors" : "Juniors"].join(","))].join("\n") + "\n";
}

export function ImportStart({ electionId, fields }: { electionId: string; fields: FieldDef[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [phase, setPhase] = useState<keyof typeof phases | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = phase !== null;

  async function sendFile(file: File) {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    const contentType = file.type || (ext === "csv" ? "text/csv" : "application/octet-stream");
    try {
      setPhase("request");
      const r = await api<{ importId: string; upload: UploadTarget | null }>("POST", `/api/elections/${electionId}/imports`, { filename: file.name, contentType, size: file.size, idempotencyKey: crypto.randomUUID() });
      if (r.upload) { setPhase("upload"); await putToTarget(r.upload, file); }
      setPhase("check");
      const fin = await api<{ status: string; errorCode?: string | null }>("POST", `/api/elections/${electionId}/imports/${r.importId}/finalize`);
      if (fin.status === "REJECTED") { setError("That file couldn’t be accepted. Check that it’s a real CSV, PDF, Word or image file under the size limit."); setPhase(null); return; }
      setPhase("parse");
      await api("POST", `/api/elections/${electionId}/imports/${r.importId}/parse`);
      router.push(`/app/elections/${electionId}/voters/imports/${r.importId}`);
    } catch (e) { setError(errorMessage(e)); setPhase(null); }
  }

  async function sendManual(csv?: string) {
    setError(null); setPhase("parse");
    try {
      const imp = await api<{ id: string }>("POST", `/api/elections/${electionId}/imports/manual`, csv ? { csv } : {});
      router.push(`/app/elections/${electionId}/voters/imports/${imp.id}`);
    } catch (e) { setError(e instanceof ApiError && e.fields?.csv ? e.fields.csv : errorMessage(e)); setPhase(null); }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([sampleCsv(fields)], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "voters-template.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="How to add voters" className="inline-flex rounded-lg border border-border bg-muted p-1">
        {([["file", "Upload a file"], ["paste", "Paste or type"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" disabled={busy} onClick={() => setTab(id)}
            className={cn("rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors", tab === id ? "bg-card shadow-sm" : "text-muted-fg hover:text-fg")}>{label}</button>
        ))}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {tab === "file" ? (
        <div className="space-y-4">
          <label
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) void sendFile(f); }}
            className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center transition-colors focus-within:ring-2 focus-within:ring-ring", over ? "border-fg bg-muted" : "border-input bg-card hover:bg-muted/60", busy && "pointer-events-none opacity-70")}>
            <FileUp className="size-6 text-muted-fg" aria-hidden />
            <span className="font-medium">{busy ? phases[phase!] : "Drop a file here, or choose one"}</span>
            <span className="text-sm text-muted-fg">CSV works everywhere. PDFs, Word files and photos need a document reader to be set up.</span>
            <input ref={input} type="file" className="sr-only" accept=".csv,.pdf,.docx,.png,.jpg,.jpeg" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendFile(f); e.target.value = ""; }} />
          </label>
          <p className="text-sm text-muted-fg">The first row must name each column. You’ll match columns and review every row before anything is added. <button type="button" onClick={download} className="underline underline-offset-4 hover:text-fg">Download a template</button>.</p>
        </div>
      ) : (
        <Card><CardBody className="space-y-4">
          <Field label="Voters" hint="Paste CSV with a header row, or start empty and type voters in on the next screen.">
            {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false} className="font-mono text-[13px]" placeholder={sampleCsv(fields).trim()} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={!text.trim()} onClick={() => sendManual(text)}>Continue</Button>
            <Button variant="ghost" disabled={busy} onClick={() => sendManual()}>Start with an empty list</Button>
          </div>
        </CardBody></Card>
      )}
    </div>
  );
}
