import { defineConfig } from "prisma/config";

// The URL is only needed by `prisma migrate` / `db push`. `prisma generate` does not read it.
// On Neon, DATABASE_URL is the pooled connection the app uses; migrations need the DIRECT (non-pooled) URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "file:./.data/dev.db",
  },
});
