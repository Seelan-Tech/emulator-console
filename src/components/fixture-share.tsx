"use client";
import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/client";
import { downloadText } from "@/lib/download";
import { MAX_FILE_BYTES, type OnConflict, parseFixtureFile, type SecretStep, secretSteps } from "@/lib/fixture-file";

type Prepared = { filename: string; text: string };

// Saves a fixture file. A file is plain text, so when a step holds a value that may be secret the person confirms first.
export function ExportButton({
  label,
  prepare,
  variant = "outline",
}: {
  label: string;
  prepare: () => Promise<Prepared | null>;
  variant?: "outline" | "ghost";
}) {
  const [pending, setPending] = useState<{ file: Prepared; secrets: SecretStep[] } | null>(null);

  async function start() {
    try {
      const file = await prepare();
      if (!file) return;
      const secrets = parseFixtureFile(file.text).flatMap((f) => secretSteps((f as { steps?: unknown[] }).steps ?? []));
      if (secrets.length) setPending({ file, secrets });
      else downloadText(file.filename, file.text);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} onClick={start}>
        <Download /> {label}
      </Button>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(v) => !v && setPending(null)}
        title="This file will contain values that may be secret"
        confirmLabel="Download anyway"
        description={
          <span className="grid gap-2">
            <span>
              A fixture file is plain text: anyone who gets it can read these values. Replace them with placeholders
              before you commit or share it.
            </span>
            <ul className="list-disc pl-5">
              {pending?.secrets.map((s, i) => (
                <li key={i}>
                  Step {s.step}: <code>{s.call}</code> has {s.what}
                </li>
              ))}
            </ul>
          </span>
        }
        onConfirm={() => {
          if (pending) downloadText(pending.file.filename, pending.file.text);
          setPending(null);
        }}
      />
    </>
  );
}

export function ExportAllButton() {
  return (
    <ExportButton
      label="Export all"
      prepare={async () => {
        const r = await fetch("/api/fixtures/export");
        if (!r.ok) throw new Error(`Export failed (HTTP ${r.status})`);
        return { filename: "emulator-console-fixtures.json", text: await r.text() };
      }}
    />
  );
}

type Item = {
  name: string;
  originalName?: string;
  action: "create" | "rename" | "replace" | "skip" | "invalid";
  steps?: number;
  errors?: number;
  warnings?: number;
  secrets?: SecretStep[];
  error?: string;
};
type Result = { dryRun: boolean; items: Item[] };

const WHAT: Record<Item["action"], { text: string; variant: "success" | "default" | "destructive" | "outline" }> = {
  create: { text: "New", variant: "success" },
  rename: { text: "Name exists: saved under a new name", variant: "default" },
  replace: { text: "Replaces the fixture with this name", variant: "destructive" },
  skip: { text: "Name exists: skipped", variant: "outline" },
  invalid: { text: "Not valid", variant: "destructive" },
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Imports a fixture file (one fixture or a bundle): shows what would happen before anything is saved.
export function FixtureImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [onConflict, setOnConflict] = useState<OnConflict>("rename");
  const [preview, setPreview] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const n = ++latest.current;
    if (!text.trim()) {
      setPreview(null);
      setError(null);
      return;
    }
    api<Result>("/api/fixtures/import", "POST", { text, onConflict, dryRun: true })
      .then((r) => n === latest.current && (setPreview(r), setError(null)))
      .catch((e: Error) => n === latest.current && (setPreview(null), setError(e.message)));
  }, [text, onConflict]);

  function reset(v: boolean) {
    setOpen(v);
    if (!v) {
      setText("");
      setPreview(null);
      setError(null);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError(`The file is larger than ${MAX_FILE_BYTES / 1_000_000} MB`);
    setText(await file.text());
  }

  const importable = preview?.items.filter((i) => i.action !== "skip" && i.action !== "invalid").length ?? 0;

  async function submit() {
    setBusy(true);
    try {
      await api("/api/fixtures/import", "POST", { text, onConflict });
      toast.success(`Imported ${plural(importable, "fixture")}`);
      reset(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import fixtures</DialogTitle>
          <DialogDescription>
            Choose a fixture file exported from the console (one fixture, or all of them). Nothing is saved until you
            confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            type="file"
            accept=".json,application/json"
            aria-label="Fixture file"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="…or paste the file's contents here"
            aria-label="Fixture file contents"
            className="h-24 text-xs"
          />
          <label className="flex items-center gap-2 text-sm">
            If a name exists already:
            <Select
              value={onConflict}
              onChange={(e) => setOnConflict(e.target.value as OnConflict)}
              className="w-64"
              aria-label="If a name exists already"
            >
              <option value="rename">Save under a new name</option>
              <option value="replace">Replace the existing fixture</option>
              <option value="skip">Skip it</option>
            </Select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {preview && (
            <Table data-testid="import-preview">
              <THead>
                <TR>
                  <TH>Fixture</TH>
                  <TH>What happens</TH>
                  <TH>Steps</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {preview.items.map((i, n) => (
                  <TR key={n}>
                    <TD className="font-medium">
                      {i.name}
                      {i.originalName ? (
                        <div className="text-xs font-normal text-muted-foreground">was “{i.originalName}”</div>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge variant={WHAT[i.action].variant}>{WHAT[i.action].text}</Badge>
                    </TD>
                    <TD>{i.steps ?? ""}</TD>
                    <TD className="text-xs">
                      {i.error ? <span className="text-destructive">{i.error}</span> : null}
                      {i.errors || i.warnings ? (
                        <div className="text-warning-text">
                          Check finds {plural(i.errors ?? 0, "error")} and {plural(i.warnings ?? 0, "warning")}
                        </div>
                      ) : null}
                      {i.secrets?.length ? (
                        <div className="text-muted-foreground">
                          Has values that may be secret: {i.secrets.map((s) => `step ${s.step} (${s.call})`).join(", ")}
                        </div>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !importable} onClick={submit}>
            {importable ? `Import ${plural(importable, "fixture")}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
