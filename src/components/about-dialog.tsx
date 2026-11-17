"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { aboutDetails, bugReportUrl, buildInfo, changelogUrl, releaseNotesUrl, versionLabel } from "@/lib/app-version";
import { api } from "@/lib/client";

type TargetRow = { name: string; emulator: { version: string } | null };

// What is running, with a block to paste into a bug report. The console's own version is baked in at build time; the
// emulator's comes from each target.
export function AboutDialog({
  open,
  onOpenChange,
  docsUrl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docsUrl?: string;
}) {
  const build = buildInfo();
  const [copied, setCopied] = useState(false);
  const targets = useQuery({
    queryKey: ["targets", "about"],
    queryFn: () => api<TargetRow[]>("/api/targets"),
    enabled: open,
  });
  const emulators = (targets.data ?? []).flatMap((t) =>
    t.emulator ? [{ name: t.name, version: t.emulator.version }] : [],
  );
  const details = aboutDetails({
    build,
    emulators,
    browser: typeof navigator === "undefined" ? undefined : navigator.userAgent,
  });
  const links = [
    { label: "Release notes", href: releaseNotesUrl(build) },
    { label: "Changelog", href: changelogUrl(build) },
    ...(docsUrl ? [{ label: "User guide", href: docsUrl }] : []),
    { label: "Report a bug", href: bugReportUrl },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>About Emulator Console</DialogTitle>
          <DialogDescription>
            Version <span data-testid="about-version">{versionLabel(build)}</span>
            {build.release ? "" : ": not a tagged release, so it may differ from the published docs."}
          </DialogDescription>
        </DialogHeader>
        <pre
          className="overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap"
          data-testid="about-details"
        >
          {details}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(details);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                // clipboard unavailable (insecure context or blocked): the text above can still be selected
              }
            }}
          >
            {copied ? <Check /> : <Copy />} Copy details
          </Button>
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              {l.label}
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
