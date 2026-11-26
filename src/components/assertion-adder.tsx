"use client";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ASSERTION_TEMPLATES, assertionStep } from "@/lib/fixture-templates";
import type { Step } from "@/lib/schemas";

// Adds a ready-made assertion to a fixture: choose one, fill in the names, and it is appended to the steps.
export function AssertionAdder({ onAdd }: { onAdd: (step: Step) => void }) {
  const [id, setId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const template = ASSERTION_TEMPLATES.find((t) => t.id === id);

  function add() {
    const r = assertionStep(id, values);
    if ("error" in r) return setError(r.error);
    setError(null);
    onAdd(r.step);
    setValues({});
    setId("");
  }

  return (
    <div className="mt-3 grid gap-2" data-testid="assertion-adder">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setValues({});
            setError(null);
          }}
          className="w-72"
          aria-label="Assertion"
        >
          <option value="">Add an assertion…</option>
          {ASSERTION_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        {template?.fields.map((f) => (
          <Input
            key={f.key}
            value={values[f.key] ?? f.value ?? ""}
            placeholder={f.placeholder}
            aria-label={f.label}
            className={f.key === "count" ? "w-24" : "w-56"}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
        ))}
        {template && (
          <Button type="button" variant="outline" onClick={add}>
            <Plus /> Add to steps
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
