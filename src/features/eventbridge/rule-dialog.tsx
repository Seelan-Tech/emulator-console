"use client";
import { useEffect, useState } from "react";

import { CodeEditor } from "@/components/code-editor";
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
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMutateOp } from "@/lib/aws-client";

import { PATTERN_TEMPLATES, validatePattern, validateRuleName, validateSchedule } from "./logic";

export type Rule = {
  Name: string;
  Arn?: string;
  Description?: string;
  EventPattern?: string;
  ScheduleExpression?: string;
  State?: string;
};

const pretty = (o: unknown) => JSON.stringify(o, null, 2);

// Creates a rule, or changes an existing one (PutRule with the same name replaces it, so the fields it does not name are
// reset: that is why the whole rule is shown).
export function RuleDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bus: string;
  rule?: Rule;
  onSaved?: (name: string) => void;
}) {
  const { rule, bus } = props;
  const put = useMutateOp("eventbridge", "PutRule");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"pattern" | "schedule">("pattern");
  const [pattern, setPattern] = useState(pretty(PATTERN_TEMPLATES[0]!.pattern));
  const [schedule, setSchedule] = useState("rate(5 minutes)");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!props.open) return;
    setName(rule?.Name ?? "");
    setDescription(rule?.Description ?? "");
    setMode(rule?.ScheduleExpression ? "schedule" : "pattern");
    let p = pretty(PATTERN_TEMPLATES[0]!.pattern);
    try {
      if (rule?.EventPattern) p = pretty(JSON.parse(rule.EventPattern));
    } catch {
      p = rule?.EventPattern ?? p;
    }
    setPattern(p);
    setSchedule(rule?.ScheduleExpression ?? "rate(5 minutes)");
    setEnabled(rule ? rule.State !== "DISABLED" : true);
  }, [props.open, rule]);

  const nameError = !rule && name ? validateRuleName(name) : null;
  const triggerError = mode === "pattern" ? validatePattern(pattern) : validateSchedule(schedule);
  const invalid = (!rule && (!name || !!nameError)) || !!triggerError;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? `Edit rule “${rule.Name}”` : "Create rule"}</DialogTitle>
          <DialogDescription>
            A rule on <code>{bus}</code> matches events by a pattern, or fires on a schedule. Add its targets
            afterwards.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ruleName = rule?.Name ?? name;
            await put
              .mutateAsync({
                Name: ruleName,
                EventBusName: bus,
                State: enabled ? "ENABLED" : "DISABLED",
                ...(description.trim() ? { Description: description.trim() } : {}),
                ...(mode === "pattern"
                  ? { EventPattern: JSON.stringify(JSON.parse(pattern)) }
                  : { ScheduleExpression: schedule.trim() }),
              })
              .then(
                () => {
                  props.onOpenChange(false);
                  props.onSaved?.(ruleName);
                },
                () => {},
              );
          }}
        >
          {!rule && (
            <div className="grid gap-1.5">
              <Label htmlFor="rule-name">Rule name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!nameError}
                autoFocus
              />
              {nameError && (
                <p className="text-xs text-destructive" role="alert">
                  {nameError}
                </p>
              )}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="rule-desc">Description (optional)</Label>
            <Input id="rule-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-mode">Fires on</Label>
            <Select
              id="rule-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as "pattern" | "schedule")}
              className="w-64"
            >
              <option value="pattern">An event pattern</option>
              <option value="schedule">A schedule</option>
            </Select>
          </div>
          {mode === "pattern" ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Event pattern</Label>
                <Select
                  aria-label="Start from an example"
                  className="w-64"
                  value=""
                  onChange={(e) => {
                    const t = PATTERN_TEMPLATES[Number(e.target.value)];
                    if (t) setPattern(pretty(t.pattern));
                  }}
                >
                  <option value="">Start from an example…</option>
                  {PATTERN_TEMPLATES.map((t, i) => (
                    <option key={t.label} value={i}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <CodeEditor value={pattern} onChange={setPattern} height="160px" label="Event pattern" />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="rule-schedule">Schedule</Label>
              <Input
                id="rule-schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                className="font-mono"
                placeholder="rate(5 minutes) or cron(0 12 * * ? *)"
                aria-invalid={!!triggerError}
              />
              {bus !== "default" && (
                <p className="text-xs text-muted-foreground">
                  AWS only runs scheduled rules on the default bus; the emulator may accept one here anyway.
                </p>
              )}
            </div>
          )}
          {triggerError && (
            <p className="text-xs text-destructive" role="alert">
              {triggerError}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" /> Enabled
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={invalid || put.isPending}>
              {put.isPending && <Spinner />} {rule ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
