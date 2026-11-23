#!/usr/bin/env node
/**
 * Offline fallback: emits Prisma-style SQLite DDL straight from prisma/schema.prisma.
 *
 * Why this exists: `prisma migrate dev` needs the Rust schema engine, which is downloaded from
 * binaries.prisma.sh. Where that host is unreachable (locked-down CI, some sandboxes) you cannot
 * generate migrations. This script reproduces the DDL Prisma emits for SQLite (same table/index/FK
 * naming) so the baseline migration can still be produced and applied.
 *
 * On a machine with normal network access prefer the official tool:
 *     npx prisma migrate dev --name init
 * and verify there is no drift:
 *     npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
 *
 * Only the restricted schema style used in this repo is supported (one field per line, no @map).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const SCALARS = { String: "TEXT", Int: "INTEGER", Boolean: "BOOLEAN", DateTime: "DATETIME", Float: "REAL", Json: "JSONB", BigInt: "BIGINT", Bytes: "BLOB", Decimal: "DECIMAL" };
const enums = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]));
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));
const modelNames = new Set(models.map((m) => m.name));
const q = (s) => `"${s}"`;
const list = (cols) => cols.split(",").map((c) => c.trim()).filter(Boolean);
const refs = (s) => { const m = s.match(/\[([^\]]*)\]/); return m ? list(m[1]) : []; };
const ACTION = { Cascade: "CASCADE", Restrict: "RESTRICT", SetNull: "SET NULL", NoAction: "NO ACTION", SetDefault: "SET DEFAULT" };

function defaultSql(attrs, base) {
  const m = attrs.match(/@default\((.*?)\)(?:\s|$)/); if (!m) return "";
  const v = m[1].trim();
  if (/^(cuid|uuid|autoincrement|ulid|nanoid)\(/.test(v)) return "";
  if (v === "now()") return " DEFAULT CURRENT_TIMESTAMP";
  if (/^".*"$/.test(v)) return ` DEFAULT '${v.slice(1, -1).replace(/'/g, "''")}'`;
  if (enums.has(base)) return ` DEFAULT '${v}'`;
  return ` DEFAULT ${v}`;
}

const tables = []; const indexes = [];
for (const model of models) {
  const cols = []; const constraints = []; const fkNullable = new Map(); let pk = null; const fields = [];
  for (const raw of model.body.split("\n")) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith("@@")) {
      const cols2 = refs(line);
      if (line.startsWith("@@id")) pk = cols2;
      else if (line.startsWith("@@unique")) indexes.push(`CREATE UNIQUE INDEX ${q(`${model.name}_${cols2.join("_")}_key`)} ON ${q(model.name)}(${cols2.map(q).join(", ")});`);
      else if (line.startsWith("@@index")) indexes.push(`CREATE INDEX ${q(`${model.name}_${cols2.join("_")}_idx`)} ON ${q(model.name)}(${cols2.map(q).join(", ")});`);
      continue;
    }
    const m = line.match(/^(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)$/); if (!m) continue;
    fields.push({ name: m[1], base: m[2], mod: m[3] ?? "", attrs: m[4] });
  }
  const optional = new Map(fields.map((f) => [f.name, f.mod === "?"]));
  const fks = [];
  for (const f of fields) {
    if (modelNames.has(f.base)) {
      const rel = f.attrs.match(/@relation\((.*)\)/);
      if (rel && /fields:/.test(rel[1])) {
        const fcols = refs(rel[1].match(/fields:\s*(\[[^\]]*\])/)[1]);
        const rcols = refs(rel[1].match(/references:\s*(\[[^\]]*\])/)[1]);
        const allRequired = fcols.every((c) => !optional.get(c));
        const del = (rel[1].match(/onDelete:\s*(\w+)/) || [])[1];
        const upd = (rel[1].match(/onUpdate:\s*(\w+)/) || [])[1];
        fks.push({ fcols, target: f.base, rcols, del: ACTION[del] ?? (allRequired ? "RESTRICT" : "SET NULL"), upd: ACTION[upd] ?? "CASCADE" });
      }
      continue;
    }
    if (f.mod === "[]") continue;
    const type = SCALARS[f.base] ?? (enums.has(f.base) ? "TEXT" : null);
    if (!type) throw new Error(`Unsupported type ${f.base} on ${model.name}.${f.name}`);
    const isId = /@id\b/.test(f.attrs);
    cols.push(`    ${q(f.name)} ${type}${f.mod === "?" ? "" : " NOT NULL"}${defaultSql(f.attrs, f.base)}${isId && !pk ? " PRIMARY KEY" : ""}`.replace(/ NOT NULL PRIMARY KEY$/, " NOT NULL PRIMARY KEY"));
    if (/@unique\b/.test(f.attrs)) indexes.push(`CREATE UNIQUE INDEX ${q(`${model.name}_${f.name}_key`)} ON ${q(model.name)}(${q(f.name)});`);
  }
  const lines = [...cols];
  if (pk) lines.push(`    PRIMARY KEY (${pk.map(q).join(", ")})`);
  for (const fk of fks) lines.push(`    CONSTRAINT ${q(`${model.name}_${fk.fcols.join("_")}_fkey`)} FOREIGN KEY (${fk.fcols.map(q).join(", ")}) REFERENCES ${q(fk.target)} (${fk.rcols.map(q).join(", ")}) ON DELETE ${fk.del} ON UPDATE ${fk.upd}`);
  tables.push(`-- CreateTable\nCREATE TABLE ${q(model.name)} (\n${lines.join(",\n")}\n);`);
}
const sql = `${tables.join("\n\n")}\n\n${indexes.length ? "-- CreateIndex\n" + indexes.join("\n") : ""}\n`;
const out = process.argv[2];
if (!out) { process.stdout.write(sql); process.exit(0); }
const dir = join(root, "prisma/migrations", out);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "migration.sql"), sql);
writeFileSync(join(root, "prisma/migrations/migration_lock.toml"), '# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "sqlite"\n');
console.log(`wrote prisma/migrations/${out}/migration.sql (${tables.length} tables, ${indexes.length} indexes)`);
