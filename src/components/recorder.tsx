"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Circle, Save, Trash2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CopyCliButton } from "@/components/copy-cli-button";
import { useTarget } from "@/components/target-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { FixtureDetail, IdName } from "@/lib/api-types";
import { cliCommand, cliScript } from "@/lib/cli-command";
import { api } from "@/lib/client";
import { type RecordedStep, withTiming } from "@/lib/recorder-timing";
import { storage } from "@/lib/storage";

type Ctx = {
  steps: RecordedStep[];
  recording: boolean;
  setRecording: (v: boolean) => void;
  add: (s: RecordedStep) => void;
  remove: (i: number) => void;
  clear: () => void;
};

const noop: Ctx = {
  steps: [],
  recording: false,
  setRecording: () => {},
  add: () => {},
  remove: () => {},
  clear: () => {},
};
const RecorderCtx = createContext<Ctx>(noop);
export const useRecorder = () => useContext(RecorderCtx);

// Steps survive a reload (per target) so recording a long session doesn't depend on the tab staying open.
type PersistedRecorder = { steps: RecordedStep[]; recording: boolean };

export function RecorderProvider({ targetId, children }: { targetId: string; children: React.ReactNode }) {
  const key = `recorder:v1:${targetId}`;
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [recording, setRecording] = useState(true);
  const loaded = useRef(false);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => {
    const saved = storage.getJson<Partial<PersistedRecorder> | null>(key, null);
    if (saved?.steps) setSteps(saved.steps);
    if (typeof saved?.recording === "boolean") setRecording(saved.recording);
    loaded.current = true;
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    storage.setJson(key, { steps, recording });
  }, [key, steps, recording]);

  const add = useCallback((s: RecordedStep) => {
    if (recordingRef.current) setSteps((cur) => [...cur, withTiming(s)]);
  }, []);
  const remove = useCallback((i: number) => setSteps((cur) => cur.filter((_, j) => j !== i)), []);
  const clear = useCallback(() => setSteps([]), []);

  const value = useMemo(
    () => ({ steps, recording, setRecording, add, remove, clear }),
    [steps, recording, add, remove, clear],
  );
  return <RecorderCtx.Provider value={value}>{children}</RecorderCtx.Provider>;
}

type FixtureRow = { id: string; name: string };

// Persistent bar at the bottom of every target page: what you click is captured as replayable steps.
export function RecorderDrawer() {
  const { steps, recording, setRecording, remove, clear } = useRecorder();
  const { region } = useTarget();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  return (
    <div className="border-t bg-card" data-testid="recorder">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <Circle className={recording ? "size-3 fill-destructive text-destructive" : "size-3 text-muted-foreground"} />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={recording} onCheckedChange={setRecording} aria-label="Record state-changing calls" />
          Record
        </label>
        <Badge variant={steps.length ? "default" : "outline"} data-testid="recorder-count">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </Badge>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Changes you make are captured so you can replay them after a restart.
        </span>
        <div className="ml-auto flex items-center gap-2">
          {steps.length > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
                {open ? <ChevronDown /> : <ChevronUp />} Steps
              </Button>
              <CopyCliButton
                label="Copy steps as AWS CLI script"
                command={() => cliScript(steps.map((s) => ({ ...s, region: s.region ?? region })))}
              />
              <Button size="sm" variant="outline" onClick={clear}>
                <Trash2 /> Clear
              </Button>
              <Button size="sm" onClick={() => setSaving(true)}>
                <Save /> Save as fixture
              </Button>
            </>
          )}
        </div>
      </div>
      {open && steps.length > 0 && (
        <ol className="max-h-48 space-y-0.5 overflow-auto border-t px-4 py-2 font-mono text-xs">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-6 text-muted-foreground">{i + 1}</span>
              <span>
                {s.service}.{s.operation}
              </span>
              <span className="ml-auto">
                <CopyCliButton
                  iconOnly
                  variant="ghost"
                  label={`Copy step ${i + 1} as AWS CLI`}
                  command={() => cliCommand({ ...s, region: s.region ?? region })}
                />
              </span>
              <button
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove(i)}
                aria-label={`Remove step ${i + 1}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <SaveFixtureDialog
        open={saving}
        onOpenChange={setSaving}
        onSaved={() => {
          clear();
          void qc.invalidateQueries({ queryKey: ["fixtures"] });
        }}
      />
    </div>
  );
}

function SaveFixtureDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { steps } = useRecorder();
  const [dest, setDest] = useState("new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const fixtures = useQuery({
    queryKey: ["fixtures"],
    queryFn: () => api<FixtureRow[]>("/api/fixtures"),
    enabled: open,
  });

  async function save() {
    setBusy(true);
    try {
      if (dest === "new") {
        const f = await api<IdName>("/api/fixtures", "POST", { name: name.trim(), steps });
        toast.success(`Saved fixture "${f.name}" (${steps.length} steps)`);
      } else {
        const cur = await api<FixtureDetail>(`/api/fixtures/${dest}`);
        await api(`/api/fixtures/${dest}`, "PUT", { steps: [...cur.steps, ...steps] });
        toast.success(`Appended ${steps.length} step(s) to "${cur.name}"`);
      }
      onSaved();
      onOpenChange(false);
      setName("");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Save {steps.length} recorded step{steps.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Recorded inputs are stored in the fixture as plain JSON, including any secret values you typed.
          </DialogDescription>
        </DialogHeader>
        <Select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination">
          <option value="new">New fixture…</option>
          {fixtures.data?.map((f) => (
            <option key={f.id} value={f.id}>
              Append to “{f.name}”
            </option>
          ))}
        </Select>
        {dest === "new" && (
          <Input placeholder="Fixture name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || (dest === "new" && !name.trim())}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
