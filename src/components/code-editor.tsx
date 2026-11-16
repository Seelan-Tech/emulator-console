"use client";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

import { Skeleton } from "@/components/ui/skeleton";

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
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: Language;
  height?: string;
  readOnly?: boolean;
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
  return (
    <div className={`overflow-hidden rounded-md border text-sm ${className ?? ""}`} data-testid="code-editor">
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
