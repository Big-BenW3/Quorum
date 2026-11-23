import { api, ApiError } from "@/lib/api";

export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

/** Sends the bytes straight to the storage target the server signed for us (S3, or the local dev route). */
export async function putToTarget(target: UploadTarget, file: File): Promise<void> {
  let res: Response;
  try { res = await fetch(target.url, { method: target.method, headers: target.headers, body: file, credentials: "omit" }); }
  catch { throw new ApiError("NETWORK", "The upload didn't go through. Check your connection and try again.", 0); }
  if (!res.ok) throw new ApiError("UPLOAD_FAILED", res.status === 413 ? "That file is larger than allowed." : "The upload was rejected. Try again, or choose a different file.", res.status);
}

/** Candidate photos and banners: request a target, upload, finalize. Returns the upload id to attach. */
export async function uploadAsset(electionId: string, kind: "BANNER" | "LOGO" | "CANDIDATE_IMAGE", file: File): Promise<string> {
  const { uploadId, upload } = await api<{ uploadId: string; upload: UploadTarget }>("POST", `/api/elections/${electionId}/assets`, { kind, filename: file.name, contentType: file.type, size: file.size });
  await putToTarget(upload, file);
  await api("POST", `/api/elections/${electionId}/assets/${uploadId}/finalize`);
  return uploadId;
}

export const IMAGE_TYPES = ["image/png", "image/jpeg"];
export const imageProblem = (f: File, maxBytes = 2_000_000): string | null =>
  !IMAGE_TYPES.includes(f.type) ? "Use a PNG or JPEG image." : f.size > maxBytes ? `Choose an image under ${Math.round(maxBytes / 1_000_000)} MB.` : null;
