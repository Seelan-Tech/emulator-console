// Pure helpers for S3 keys and prefixes ("folders" are just key prefixes ending in "/").
export type Crumb = { name: string; prefix: string };

export function breadcrumbs(prefix: string): Crumb[] {
  const parts = prefix.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, prefix: parts.slice(0, i + 1).join("/") + "/" }));
}

export const displayName = (key: string, prefix: string) => key.slice(prefix.length) || key;

export const s3Uri = (bucket: string, key: string) => `s3://${bucket}/${key}`;

export function validateBucketName(name: string): string | null {
  if (name.length < 3 || name.length > 63) return "Use 3 to 63 characters";
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name))
    return "Lowercase letters, digits, dots and hyphens; start and end with a letter or digit";
  if (/\.\./.test(name)) return "No consecutive dots";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "Must not look like an IP address";
  return null;
}

// GetBucketLocation answers with a LocationConstraint: empty/null means us-east-1 and the legacy "EU" means eu-west-1.
export function bucketRegionFrom(locationConstraint: string | null | undefined): string {
  if (!locationConstraint) return "us-east-1";
  return locationConstraint === "EU" ? "eu-west-1" : locationConstraint;
}

export function validateFolderName(name: string): string | null {
  const n = name.trim();
  if (!n) return "Enter a name";
  if (n.includes("/") && n.replace(/\/+$/, "").includes("//")) return "No empty path segments";
  return null;
}

export type ObjectRow = { key: string; size: number; modified?: string };
export type SortKey = "name" | "size" | "modified";

export function sortObjects(rows: ObjectRow[], by: SortKey, dir: "asc" | "desc", prefix: string): ObjectRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: ObjectRow) =>
    by === "name" ? displayName(r.key, prefix).toLowerCase() : by === "size" ? r.size : (r.modified ?? "");
  return [...rows].sort((a, b) => (val(a) < val(b) ? -sign : val(a) > val(b) ? sign : 0));
}

const TEXT = /\.(txt|json|md|csv|log|ya?ml|xml|html?|css|js|mjs|ts|tsx|py|sh|toml|ini|env)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
export const previewKind = (key: string): "text" | "image" | null =>
  TEXT.test(key) ? "text" : IMAGE.test(key) ? "image" : null;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
