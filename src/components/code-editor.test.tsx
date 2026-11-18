import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { CodeEditor, type Language } from "./code-editor";

// CodeMirror cannot be laid out by jsdom; a textarea stands in for it.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="editor" value={value} readOnly />,
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

function Harness({ initial, language, readOnly }: { initial: string; language?: Language; readOnly?: boolean }) {
  const [v, setV] = useState(initial);
  return <CodeEditor value={v} onChange={setV} language={language} readOnly={readOnly} />;
}

describe("CodeEditor Beautify", () => {
  test("re-indents JSON and then has nothing left to do", async () => {
    render(<Harness initial='{"a":[1,2]}' />);
    await screen.findByLabelText("editor");
    await userEvent.click(screen.getByRole("button", { name: "Beautify JSON" }));
    expect(screen.getByLabelText("editor")).toHaveValue('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(screen.getByRole("button", { name: "Beautify JSON" })).toBeDisabled();
  });

  test("plain-text editors offer it only while the text is a JSON object or array", async () => {
    const plain = render(<Harness initial="hello" language="text" />);
    await screen.findByLabelText("editor");
    expect(screen.queryByRole("button", { name: "Beautify JSON" })).toBeNull();
    plain.unmount();
    render(<Harness initial="[1]" language="text" />);
    await screen.findByLabelText("editor");
    expect(screen.getByRole("button", { name: "Beautify JSON" })).toBeEnabled();
  });

  test("not for invalid JSON, code or read-only editors", async () => {
    for (const props of [
      { initial: "{broken" },
      { initial: '{"a":1}', language: "python" as const },
      { initial: '{"a":1}', readOnly: true },
    ]) {
      const { unmount } = render(<Harness {...props} />);
      await screen.findByLabelText("editor");
      expect(screen.queryByRole("button", { name: "Beautify JSON" })).toBeNull();
      unmount();
    }
  });
});
