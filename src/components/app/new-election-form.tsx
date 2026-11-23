"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChoiceCard, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { TIMEZONES } from "@/lib/format";

export type FieldDef = { key: string; label: string; kind: "text" | "email" | "id" | "pin" };

export const PRESETS: { id: string; title: string; description: string; fields: FieldDef[] }[] = [
  { id: "email", title: "Email address", description: "Simple. Good when your member list already has emails.", fields: [{ key: "email", label: "Email address", kind: "email" }] },
  { id: "id", title: "Member or student ID", description: "A number or code your members already know.", fields: [{ key: "member_id", label: "Member ID", kind: "id" }] },
  { id: "email_pin", title: "Email and a PIN", description: "Stronger. Each voter gets a PIN you send them separately.", fields: [{ key: "email", label: "Email address", kind: "email" }, { key: "pin", label: "PIN", kind: "pin" }] },
  { id: "custom", title: "Custom", description: "Choose up to four fields yourself.", fields: [{ key: "email", label: "Email address", kind: "email" }] },
];

const KIND_LABEL: Record<FieldDef["kind"], string> = { text: "Text", email: "Email", id: "ID or code", pin: "PIN (hidden as typed)" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 32);

export function FieldsEditor({ fields, onChange, error }: { fields: FieldDef[]; onChange: (f: FieldDef[]) => void; error?: string }) {
  const set = (i: number, patch: Partial<FieldDef>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <div key={i} className="grid gap-3 sm:grid-cols-[1fr_190px_auto] sm:items-end">
          <Field label={i === 0 ? "What voters type" : "Label"}>
            {(p) => <Input {...p} value={f.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value, key: slug(e.target.value) || f.key })} placeholder="e.g. Membership number" />}
          </Field>
          <Field label={i === 0 ? "Kind" : "Kind"}>
            {(p) => <Select {...p} value={f.kind} onChange={(e) => set(i, { kind: e.target.value as FieldDef["kind"] })}>{(Object.keys(KIND_LABEL) as FieldDef["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>}
          </Field>
          <Button variant="ghost" size="icon" aria-label={`Remove ${f.label || "field"}`} disabled={fields.length === 1} onClick={() => onChange(fields.filter((_, j) => j !== i))} className="sm:mb-[22px]"><X className="size-4" /></Button>
        </div>
      ))}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {fields.length < 4 && <Button variant="secondary" size="sm" onClick={() => onChange([...fields, { key: `field_${fields.length + 1}`, label: "", kind: "text" }])}><Plus className="size-4" />Add a field</Button>}
    </div>
  );
}

export function NewElectionForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"RESTRICTED" | "OPEN">("RESTRICTED");
  const [preset, setPreset] = useState("email");
  const [custom, setCustom] = useState<FieldDef[]>(PRESETS[3]!.fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const tzDefault = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const verificationFields = preset === "custom" ? custom : PRESETS.find((p) => p.id === preset)!.fields;
    setBusy(true); setError(null); setFe({});
    try {
      const { election } = await api<{ election: { id: string } }>("POST", `/api/orgs/${orgId}/elections`, {
        title: String(fd.get("title") ?? ""), description: String(fd.get("description") ?? "").trim() || undefined,
        timezone: String(fd.get("timezone") ?? "UTC"), eligibilityMode: mode, verificationFields,
      });
      router.push(`/app/elections/${election.id}`); router.refresh();
    } catch (err) {
      setError(errorMessage(err)); if (err instanceof ApiError && err.fields) setFe(err.fields); setBusy(false);
    }
  }
  const zones = TIMEZONES.includes(tzDefault) ? TIMEZONES : [tzDefault, ...TIMEZONES];
  return (
    <form onSubmit={submit} noValidate className="space-y-10">
      {error && !Object.keys(fe).length && <Notice tone="danger">{error}</Notice>}
      <section className="space-y-5">
        <Field label="Title" error={fe.title}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={120} placeholder="e.g. 2027 committee elections" autoFocus />}</Field>
        <Field label="Description" optional error={fe.description} hint="Shown to voters before they verify.">{(p) => <Textarea {...p} name="description" rows={3} maxLength={2000} />}</Field>
        <Field label="Time zone" error={fe.timezone} hint="Start and end times are entered and shown in this zone.">{(p) => <Select {...p} name="timezone" defaultValue={tzDefault}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>}</Field>
      </section>

      <section aria-labelledby="who-h" className="space-y-4">
        <div><h2 id="who-h" className="text-[15px] font-semibold">Who can vote</h2><p className="text-sm text-muted-fg">You can’t change this after the voter list is imported.</p></div>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="who-h">
          <ChoiceCard name="mode" value="RESTRICTED" checked={mode === "RESTRICTED"} onChange={() => setMode("RESTRICTED")} title="Only people on my list" description="Import a roster. Voters prove who they are, and each can vote once." />
          <ChoiceCard name="mode" value="OPEN" checked={mode === "OPEN"} onChange={() => setMode("OPEN")} title="Anyone with the link" description="No roster. One ballot per device is a weak limit, so use it for polls, not binding votes." />
        </div>
      </section>

      {mode === "RESTRICTED" && (
        <section aria-labelledby="how-h" className="space-y-4">
          <div><h2 id="how-h" className="text-[15px] font-semibold">How voters prove who they are</h2><p className="text-sm text-muted-fg">Voters enter these details and we match them against your list.</p></div>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="how-h">
            {PRESETS.map((p) => <ChoiceCard key={p.id} name="preset" value={p.id} checked={preset === p.id} onChange={setPreset} title={p.title} description={p.description} />)}
          </div>
          {preset === "custom" && <FieldsEditor fields={custom} onChange={setCustom} error={fe.verificationFields} />}
          {fe.verificationFields && preset !== "custom" && <p className="text-sm text-danger" role="alert">{fe.verificationFields}</p>}
        </section>
      )}
      <div className="flex gap-3"><Button type="submit" loading={busy}>Create election</Button></div>
    </form>
  );
}
