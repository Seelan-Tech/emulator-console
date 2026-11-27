"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useOp, useRunOp } from "@/lib/aws-client";

import { queueArnFromUrl } from "../sns/logic";
import { targetId } from "./logic";
import { allowRuleOnTarget } from "./permissions";

type Kind = "sqs" | "lambda" | "sns" | "other";
const ID = /^[A-Za-z0-9._-]{1,64}$/;

export function AddTargetDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bus: string;
  rule: string;
  ruleArn: string;
  existingIds: string[];
}) {
  const { region } = useTarget();
  const runOp = useRunOp();
  const [kind, setKind] = useState<Kind>("sqs");
  const [chosen, setChosen] = useState("");
  const [other, setOther] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [input, setInput] = useState("");
  const [allow, setAllow] = useState(true);
  const [busy, setBusy] = useState(false);

  const queues = useOp<{ QueueUrls?: string[] }>("sqs", "ListQueues", {}, { enabled: props.open && kind === "sqs" });
  const fns = useOp<{ Functions?: { FunctionName: string; FunctionArn: string }[] }>(
    "lambda",
    "ListFunctions",
    {},
    { enabled: props.open && kind === "lambda" },
  );
  const topics = useOp<{ Topics?: { TopicArn: string }[] }>(
    "sns",
    "ListTopics",
    {},
    { enabled: props.open && kind === "sns" },
  );
  const options: { arn: string; label: string }[] =
    kind === "sqs"
      ? (queues.data?.QueueUrls ?? []).map((u) => ({ arn: queueArnFromUrl(u, region), label: u.split("/").pop()! }))
      : kind === "lambda"
        ? (fns.data?.Functions ?? []).map((f) => ({ arn: f.FunctionArn, label: f.FunctionName }))
        : kind === "sns"
          ? (topics.data?.Topics ?? []).map((t) => ({ arn: t.TopicArn, label: t.TopicArn.split(":").pop()! }))
          : [];
  const arn = kind === "other" ? other.trim() : chosen;

  useEffect(() => {
    if (!props.open) return;
    setKind("sqs");
    setChosen("");
    setOther("");
    setId("");
    setIdEdited(false);
    setInput("");
    setAllow(true);
  }, [props.open]);
  useEffect(() => {
    if (!idEdited && arn) setId(targetId(arn));
  }, [arn, idEdited]);

  const idError = !id
    ? null
    : !ID.test(id)
      ? "Up to 64 letters, digits, dots, hyphens and underscores"
      : props.existingIds.includes(id)
        ? "This rule has a target with this id"
        : null;
  const arnError = kind === "other" && other && !other.trim().startsWith("arn:") ? "An ARN starts with arn:" : null;
  let inputError: string | null = null;
  if (input.trim()) {
    try {
      JSON.parse(input);
    } catch (e) {
      inputError = `Not valid JSON: ${(e as Error).message}`;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await runOp<{ FailedEntryCount?: number; FailedEntries?: { ErrorMessage?: string }[] }>(
        "eventbridge",
        "PutTargets",
        {
          Rule: props.rule,
          EventBusName: props.bus,
          Targets: [{ Id: id, Arn: arn, ...(input.trim() ? { Input: JSON.stringify(JSON.parse(input)) } : {}) }],
        },
      );
      if (r.FailedEntryCount) throw new Error(r.FailedEntries?.[0]?.ErrorMessage ?? "The target was not added");
      if (allow && kind !== "other")
        await allowRuleOnTarget(runOp, { targetArn: arn, ruleArn: props.ruleArn, bus: props.bus, rule: props.rule });
      props.onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add target</DialogTitle>
          <DialogDescription>Where rule “{props.rule}” sends the events it matches.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="t-kind">Target type</Label>
            <Select
              id="t-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setChosen("");
                setIdEdited(false);
              }}
            >
              <option value="sqs">SQS queue</option>
              <option value="lambda">Lambda function</option>
              <option value="sns">SNS topic</option>
              <option value="other">Another ARN</option>
            </Select>
          </div>
          {kind === "other" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="t-arn">ARN</Label>
              <Input id="t-arn" value={other} onChange={(e) => setOther(e.target.value)} aria-invalid={!!arnError} />
              {arnError && (
                <p className="text-xs text-destructive" role="alert">
                  {arnError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Only queues, functions and topics get a permission and a delivery check.
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="t-pick">Target</Label>
              <Select id="t-pick" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.arn} value={o.arn}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="t-id">Target id</Label>
            <Input
              id="t-id"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdEdited(true);
              }}
              aria-invalid={!!idError}
            />
            {idError && (
              <p className="text-xs text-destructive" role="alert">
                {idError}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-input">Fixed input (optional JSON)</Label>
            <Textarea
              id="t-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Leave empty to send the whole event"
              className="h-20 text-xs"
            />
            {inputError && (
              <p className="text-xs text-destructive" role="alert">
                {inputError}
              </p>
            )}
          </div>
          {kind !== "other" && (
            <label className="flex items-start gap-2 text-sm">
              <Switch checked={allow} onCheckedChange={setAllow} aria-label="Allow this rule to deliver" />
              <span>
                Allow this rule to deliver
                <span className="block text-xs text-muted-foreground">
                  Adds the policy statement the {kind === "lambda" ? "function" : kind === "sqs" ? "queue" : "topic"}{" "}
                  needs to accept events from this rule. Without it nothing is delivered, and nothing says why.
                </span>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!arn || !id || !!idError || !!arnError || !!inputError || busy}>
              {busy && <Spinner />} Add target
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
