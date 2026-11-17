const REPO = "https://github.com/Seelan-Tech/emulator-console";

export type BuildInfo = { version?: string; revision?: string; release: boolean };

// Baked in at build time (next.config.ts). A build is a "release" only when the release workflow says so; anything
// else (a local build, a CI build of a branch) must not pass for the tagged version.
export const buildInfo = (): BuildInfo => ({
  version: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
  revision: process.env.NEXT_PUBLIC_APP_REVISION || undefined,
  release: process.env.NEXT_PUBLIC_APP_RELEASE === "true",
});

const short = (rev: string) => rev.slice(0, 7);

// "v0.2.0" for a release, "0.2.0+abc1234" for a build of some other commit, "0.2.0 (dev)" when the commit is unknown.
export function versionLabel(b: BuildInfo): string {
  if (!b.version) return "dev";
  if (b.release) return `v${b.version}`;
  return b.revision ? `${b.version}+${short(b.revision)}` : `${b.version} (dev)`;
}

// The release tag this build was cut from, or null for a build of any other commit.
export const releaseTag = (b: BuildInfo) => (b.release && b.version ? `v${b.version}` : null);

export const releaseNotesUrl = (b: BuildInfo) => {
  const tag = releaseTag(b);
  return tag ? `${REPO}/releases/tag/${tag}` : `${REPO}/releases`;
};

export const changelogUrl = (b: BuildInfo) => `${REPO}/blob/${releaseTag(b) ?? "main"}/CHANGELOG.md`;

export const bugReportUrl = `${REPO}/issues/new?template=bug_report.yml`;

// Text to paste into a bug report: what is running, nothing else.
export function aboutDetails(o: {
  build: BuildInfo;
  emulators: { name: string; version: string }[];
  browser?: string;
}): string {
  const lines = [`Emulator Console ${versionLabel(o.build)}${o.build.release ? " (release)" : ""}`];
  if (o.build.revision) lines.push(`Revision: ${o.build.revision}`);
  for (const e of o.emulators) lines.push(`Emulator (${e.name}): ${e.version}`);
  if (o.browser) lines.push(`Browser: ${o.browser}`);
  return lines.join("\n");
}
