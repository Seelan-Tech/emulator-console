"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client";

type TargetPublic = {
  id: string;
  name: string;
  baselineFixtureId: string | null;
  autoReplay: boolean;
  canDetectRestart: boolean;
};

// Baseline fixture + automatic replay: what to restore, and whether to do it the moment a restart is seen.
export function TargetSettings({
  targetId,
  open,
  onOpenChange,
}: {
  targetId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const target = useQuery({
    queryKey: ["target", targetId],
    queryFn: () => api<TargetPublic>(`/api/targets/${targetId}`),
    enabled: open,
  });
  const fixtures = useQuery({
    queryKey: ["fixtures"],
    queryFn: () => api<{ id: string; name: string }[]>("/api/fixtures"),
    enabled: open,
  });
  const [baseline, setBaseline] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  // The form is filled from the saved settings when they arrive, unless the user has already changed something
  // (the fixtures can load first): their choice must not be overwritten by a late response or a refetch.
  const touched = useRef(false);
  useEffect(() => {
    if (!open) touched.current = false;
  }, [open]);
  useEffect(() => {
    if (target.data && !touched.current) {
      setBaseline(target.data.baselineFixtureId ?? "");
      setAuto(target.data.autoReplay);
    }
  }, [target.data]);
  const canDetect = target.data?.canDetectRestart ?? false;

  async function save() {
    setBusy(true);
    try {
      await api(`/api/targets/${targetId}`, "PATCH", {
        baselineFixtureId: baseline || null,
        autoReplay: !!baseline && auto,
      });
      toast.success("Settings saved");
      void qc.invalidateQueries({ queryKey: ["target", targetId] });
      void qc.invalidateQueries({ queryKey: ["status", targetId] });
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restart recovery{target.data ? `: ${target.data.name}` : ""}</DialogTitle>
          <DialogDescription>
            The emulator loses its state when it restarts. Pick a fixture that rebuilds it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="baseline">Baseline fixture</Label>
            <Select
              id="baseline"
              value={baseline}
              onChange={(e) => {
                touched.current = true;
                setBaseline(e.target.value);
                if (!e.target.value) setAuto(false);
              }}
            >
              <option value="">None</option>
              {fixtures.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Switch
              checked={auto && !!baseline && canDetect}
              onCheckedChange={(v) => {
                touched.current = true;
                setAuto(v);
              }}
              disabled={!baseline || !canDetect}
              aria-label="Replay automatically after a restart"
            />
            <span>
              Replay automatically after a restart
              {!canDetect && (
                <span className="block text-xs text-muted-foreground">
                  Restarts can only be detected for targets that read the emulator&apos;s credential files. You can
                  still replay manually from the banner.
                </span>
              )}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
