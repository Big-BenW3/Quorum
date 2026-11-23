import { z } from "zod";
import { hmacHex } from "@/server/crypto/keys";

/**
 * Verification fields: what a voter must type to prove they are on the roster
 * (e.g. email + registration number, or name + department + PIN).
 *
 * Identifiers are normalised and then combined into keyed HMACs. The roster stores only those HMACs,
 * never the identifiers. A plain unsalted hash would be brute-forceable for low-entropy values such as
 * student numbers and PINs; an HMAC under a server-held key is not, unless the key leaks.
 */

export const FIELD_KINDS = ["text", "email", "id", "pin"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const RESERVED_TARGETS = ["__label", "__group"] as const;

export const verificationFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "Use lowercase letters, numbers and underscores."),
  label: z.string().trim().min(1, "Give the field a label.").max(60),
  kind: z.enum(FIELD_KINDS),
});

export const verificationFieldsSchema = z
  .array(verificationFieldSchema)
  .min(1, "Add at least one verification field.")
  .max(4, "Use at most four verification fields.")
  .refine((f) => new Set(f.map((x) => x.key)).size === f.length, "Field keys must be unique.")
  .refine((f) => f.every((x) => !(RESERVED_TARGETS as readonly string[]).includes(x.key)), "That key is reserved.");

export type VerificationField = z.infer<typeof verificationFieldSchema>;

export const DEFAULT_FIELDS: VerificationField[] = [{ key: "email", label: "Email address", kind: "email" }];

export function parseFields(json: unknown): VerificationField[] {
  return verificationFieldsSchema.parse(json);
}

const MAX_VALUE = 120;

export function normalizeValue(kind: FieldKind, raw: string): string {
  const v = raw.normalize("NFKC").trim();
  switch (kind) {
    case "email":
      return v.toLowerCase();
    case "id":
      return v.replace(/\s+/g, "").toLowerCase();
    case "pin":
      return v;
    default:
      return v.replace(/\s+/g, " ").toLowerCase();
  }
}

/** Returns an error message for one field value, or null when it is acceptable. */
export function checkValue(field: VerificationField, raw: unknown): string | null {
  if (typeof raw !== "string") return `${field.label} is required.`;
  const v = normalizeValue(field.kind, raw);
  if (!v) return `${field.label} is required.`;
  if (v.length > MAX_VALUE) return `${field.label} is too long.`;
  if (field.kind === "email" && !z.email().safeParse(v).success) return `Enter a valid email address.`;
  return null;
}

export function checkAll(fields: VerificationField[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const e = checkValue(f, values[f.key]);
    if (e) errors[f.key] = e;
  }
  return errors;
}

export type RosterKeys = { lookupKey: string; primaryKey: string };

/** Throws if any field is missing/invalid: call checkAll first when you want per-field messages. */
export function computeKeys(electionId: string, fields: VerificationField[], values: Record<string, unknown>): RosterKeys {
  const norm = fields.map((f) => {
    const raw = values[f.key];
    if (typeof raw !== "string") throw new Error("missing field");
    return [f.key, normalizeValue(f.kind, raw)] as const;
  });
  return {
    lookupKey: hmacHex("roster-lookup", electionId, ...norm.flat()),
    primaryKey: hmacHex("roster-primary", electionId, norm[0]![0], norm[0]![1]),
  };
}

/** Public shape of the fields a voter is asked for (no internal notes). */
export const publicFields = (fields: VerificationField[]) => fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind }));
