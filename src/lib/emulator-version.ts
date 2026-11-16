export type EmulatorVersion = { version: string; releaseDate: string | null; commit: string | null };

// The emulator image records `aws-emulator --version` next to the credentials:
//   Version: 1.0.385 / Release date: 2026.11.14 / Commit: <sha>
export function parseEmulatorVersion(text: string): EmulatorVersion | null {
  const version = /^Version:\s*(\S+)/im.exec(text)?.[1];
  if (!version) return null;
  const date = /^Release date:\s*(\d{4})\.(\d{2})\.(\d{2})/im.exec(text);
  return {
    version,
    releaseDate: date ? `${date[1]}-${date[2]}-${date[3]}` : null,
    commit: /^Commit:\s*([0-9a-f]{7,40})/im.exec(text)?.[1] ?? null,
  };
}

// Tooltip text for the version badge.
export const emulatorTitle = (e: EmulatorVersion) =>
  [`AWS Emulator ${e.version}`, e.releaseDate && `released ${e.releaseDate}`, e.commit && `commit ${e.commit}`]
    .filter(Boolean)
    .join(", ");
