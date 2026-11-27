"use client";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { beautifyJson } from "@/lib/json";

// The editor's text area has no label of its own: give it one (screen readers announce an unnamed input as just "edit").
const CodeMirror = dynamic(
  async () => {
    const { default: Base, EditorView } = await import("@uiw/react-codemirror");
    return function LabelledEditor({ label, extensions = [], ...props }: ReactCodeMirrorProps & { label: string }) {
      return <Base {...props} extensions={[...extensions, EditorView.contentAttributes.of({ "aria-label": label })]} />;
    };
  },
  { ssr: false, loading: () => <Skeleton className="h-40 w-full" /> },
);

export type Language = "json" | "python" | "javascript" | "text";

export function CodeEditor({
  value,
  onChange,
  language = "json",
  height = "240px",
  readOnly = false,
  beautify = true,
  label = "Code editor",
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Language;
  height?: string;
  readOnly?: boolean;
  /** Offer a Beautify button while the text is a JSON object or array (JSON and plain-text editors). */
  beautify?: boolean;
  /** What the editor holds, for screen readers (the visible label is elsewhere on the page). */
  label?: string;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const extensions =
    language === "json"
      ? [json()]
      : language === "python"
        ? [python()]
        : language === "javascript"
          ? [javascript()]
          : [];
  const pretty =
    beautify && onChange && !readOnly && (language === "json" || language === "text") ? beautifyJson(value) : undefined;
  return (
    <div className={`overflow-hidden rounded-md border text-sm ${className ?? ""}`} data-testid="code-editor">
      {pretty !== undefined && (
        <div className="flex justify-end border-b bg-muted/40 px-1 py-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            aria-label="Beautify JSON"
            disabled={pretty === value}
            onClick={() => onChange?.(pretty)}
          >
            Beautify
          </Button>
        </div>
      )}
      <CodeMirror
        label={label}
        value={value}
        onChange={onChange}
        height={height}
        extensions={extensions}
        readOnly={readOnly}
        theme={resolvedTheme === "dark" ? oneDark : "light"}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
