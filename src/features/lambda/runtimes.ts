import type { Language } from "@/components/code-editor";

export const DEFAULT_ROLE = "arn:aws:iam::000000000000:role/lambda-role";

type Runtime = { label: string; handler: string; ext: string; language: Language; code: string };

const py = 'def handler(event, context):\n    print("event:", event)\n    return {"echo": event}\n';
const node =
  'export const handler = async (event) => {\n  console.log("event:", JSON.stringify(event));\n  return { echo: event };\n};\n';

const PYTHON_312: Runtime = { label: "Python 3.12", handler: "index.handler", ext: "py", language: "python", code: py };

export const RUNTIMES: Record<string, Runtime> = {
  "python3.12": PYTHON_312,
  "python3.13": { label: "Python 3.13", handler: "index.handler", ext: "py", language: "python", code: py },
  "nodejs20.x": { label: "Node.js 20", handler: "index.handler", ext: "mjs", language: "javascript", code: node },
  "nodejs22.x": { label: "Node.js 22", handler: "index.handler", ext: "mjs", language: "javascript", code: node },
};

// A runtime by id, falling back to the default (Python 3.12) for an id we have no template for.
export const runtimeInfo = (id: string): Runtime => RUNTIMES[id] ?? PYTHON_312;
export const DEFAULT_RUNTIME = "python3.12";

// "index.handler" -> "index.py": the file the zip must contain.
export const handlerFile = (runtime: string, handler: string) => `${handler.split(".")[0]}.${runtimeInfo(runtime).ext}`;

export const isReady = (c?: { State?: string; LastUpdateStatus?: string }) =>
  !!c && c.State !== "Pending" && c.LastUpdateStatus !== "InProgress";

export function decodeLog(b64: string | undefined): string {
  if (!b64) return "";
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}
