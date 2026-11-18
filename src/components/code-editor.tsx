"use client";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { beautifyJson } from "@/lib/json";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <Skeleton className="h-40 w-full" />,
});

export type Language = "json" | "python" | "javascript" | "text";

export function CodeEditor({
  value,
  onChange,
  language = "json",
  height = "240px",
  readOnly = false,
  beautify = true,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Language;
  height?: string;
  readOnly?: boolean;
  /** Offer a Beautify button while the text is a JSON object or array (JSON and plain-text editors). */
  beautify?: boolean;
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
