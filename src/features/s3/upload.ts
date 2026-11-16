import { tryParseJson } from "@/lib/json";

// Browser upload with progress. Uses XHR because fetch can't report upload progress. The server switches to
// multipart above 8 MB (the emulator rejects large single PutObject calls).
export type UploadHandle = { promise: Promise<void>; abort: () => void };

export function uploadFile(o: {
  tid: string;
  region?: string;
  bucket: string;
  key: string;
  file: File;
  onProgress: (loaded: number, total: number) => void;
}): UploadHandle {
  const xhr = new XMLHttpRequest();
  const q = new URLSearchParams({ bucket: o.bucket, key: o.key });
  if (o.region) q.set("region", o.region);
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", `/api/targets/${o.tid}/s3/_upload?${q}`);
    xhr.setRequestHeader("content-type", o.file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress(e.loaded, e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `upload failed (${xhr.status})`;
      msg = (tryParseJson(xhr.responseText) as { error?: string } | undefined)?.error ?? msg;
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.onabort = () => reject(new Error("upload cancelled"));
    xhr.send(o.file);
  });
  return { promise, abort: () => xhr.abort() };
}

export const downloadUrl = (
  tid: string,
  bucket: string,
  key: string,
  o: { region?: string; inline?: boolean } = {},
) => {
  const q = new URLSearchParams({ bucket, key });
  if (o.region) q.set("region", o.region);
  if (o.inline) q.set("inline", "1");
  return `/api/targets/${tid}/s3/_download?${q}`;
};
