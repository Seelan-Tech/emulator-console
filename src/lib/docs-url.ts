const REPO = "https://github.com/Seelan-Tech/emulator-console";

// Where the Help button points: the user guide of the version that is running (its release tag, so the pages match
// the behaviour), or `main` when the version is unknown (a development build). DOCS_URL overrides both.
export function docsUrl(version: string | undefined, override?: string): string {
  if (override) return override;
  const released = version && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version);
  return `${REPO}/tree/${released ? `v${version}` : "main"}/docs`;
}
