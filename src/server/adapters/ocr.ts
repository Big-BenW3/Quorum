import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { logger } from "@/server/log";

/**
 * Document extraction (PDF, DOCX, PNG, JPEG → table of cells) behind an adapter.
 *
 * OFF by default. With OCR_DRIVER=none, requests to read those formats are refused with a clear
 * message and the administrator uses CSV or the manual paste/edit path. Nothing pretends to have
 * been read. With OCR_DRIVER=http the file bytes are sent to OCR_ENDPOINT_URL: that is a third-party
 * processor receiving voter data, so enable it deliberately and disclose it (docs/threat-model.md).
 *
 * HTTP contract (implement this in front of Azure Document Intelligence, AWS Textract, Google
 * Document AI, or your own service):
 *   POST {OCR_ENDPOINT_URL}
 *   Authorization: Bearer {OCR_API_KEY}   Content-Type: application/octet-stream
 *   X-Document-Kind: pdf|docx|png|jpeg    Idempotency-Key: {import id}
 *   → 200 { "columns": ["Name","Email"], "rows": [ { "cells": {"Name":"…","Email":"…"}, "confidence": 0.93 } ] }
 * Calls are time-limited and retried at most twice, only on 429/5xx/timeouts; the idempotency key
 * makes retries safe for the provider.
 */

export type ExtractKind = "pdf" | "docx" | "png" | "jpeg";
export type ExtractedTable = { columns: string[]; rows: { cells: Record<string, string>; confidence: number | null }[] };

export interface DocumentExtractor {
  readonly name: string;
  extract(i: { bytes: Buffer; kind: ExtractKind; idempotencyKey: string }): Promise<ExtractedTable>;
}

const response = z.object({
  columns: z.array(z.string().max(80)).min(1).max(40),
  rows: z.array(z.object({ cells: z.record(z.string(), z.string().max(400)), confidence: z.number().min(0).max(1).optional() })).max(100_000),
});

class HttpExtractor implements DocumentExtractor {
  readonly name = "http";
  async extract({ bytes, kind, idempotencyKey }: { bytes: Buffer; kind: ExtractKind; idempotencyKey: string }): Promise<ExtractedTable> {
    const e = env();
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(e.OCR_ENDPOINT_URL!, {
          method: "POST",
          headers: { Authorization: `Bearer ${e.OCR_API_KEY}`, "Content-Type": "application/octet-stream", "X-Document-Kind": kind, "Idempotency-Key": idempotencyKey },
          body: new Uint8Array(bytes),
          signal: AbortSignal.timeout(e.OCR_TIMEOUT_MS),
        });
        lastStatus = res.status;
        if (res.ok) {
          const parsed = response.safeParse(await res.json());
          if (!parsed.success) throw new AppError("PROVIDER_FAILED", "The document reader returned something we couldn't understand.");
          return { columns: parsed.data.columns, rows: parsed.data.rows.map((r) => ({ cells: r.cells, confidence: r.confidence ?? null })) };
        }
        if (res.status !== 429 && res.status < 500) break;
      } catch (err) {
        if (err instanceof AppError) throw err;
        lastStatus = 0;
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    logger.error("ocr.failed", { status: lastStatus });
    throw new AppError("PROVIDER_FAILED", "The document reader couldn't process this file. Try again, upload a CSV, or enter the voters manually.");
  }
}

let instance: DocumentExtractor | null | undefined;
/** Returns null when no provider is configured (callers must then refuse, never fake a result). */
export function getExtractor(): DocumentExtractor | null {
  if (instance !== undefined) return instance;
  instance = env().OCR_DRIVER === "http" ? new HttpExtractor() : null;
  return instance;
}
export function setExtractorForTests(x: DocumentExtractor | null | undefined) { instance = x; }
