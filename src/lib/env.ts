import { z } from "zod";

// The single place configuration is read and validated. Everything comes from environment variables; this module
// gives them types and defaults, rejects invalid values with a readable message, and documents each one in
// ENV_DOCS (which generates `.env.example` and the configuration reference in the user guide).

// "" is treated as unset, so `FOO=` in a compose file or .env behaves like leaving FOO out.
const empty = (v: unknown) => (v === "" ? undefined : v);

const bool = (fallback: boolean) =>
  z
    .preprocess(empty, z.enum(["true", "false"]).optional())
    .transform((v) => (v === undefined ? fallback : v === "true"));

const str = (fallback: string) => z.preprocess(empty, z.string().default(fallback));
const optionalStr = z.preprocess(empty, z.string().optional());

const csv = (fallback: string) =>
  z.preprocess(empty, z.string().default(fallback)).transform((s) =>
    s
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );

export const envSchema = z.object({
  // core
  DATA_DIR: str("./data"),
  APP_SECRET: z.preprocess(empty, z.string().min(32, "APP_SECRET must be at least 32 characters").optional()),
  DOCS_URL: str("https://github.com/Seelan-Tech/emulator-console/tree/main/docs"),
  LOG_LEVEL: z.preprocess(empty, z.enum(["debug", "info", "warn", "error"]).default("info")),
  // access
  LOCAL_ALLOWED_HOSTS: csv(""),
  // targets and credentials
  ALLOW_LOCAL_CREDENTIAL_FILES: bool(false),
  LOCAL_CREDENTIALS_ROOT: str("/emu"),
  LOCAL_TARGET_ENDPOINT: optionalStr,
});

export type Env = z.infer<typeof envSchema>;
type Source = Record<string, string | undefined>;

export class EnvError extends Error {}

function parse(source: Source): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new EnvError(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}

// Memoized for process.env (read on hot paths such as every request); re-parsed whenever a value changes.
let memo: { key: string; value: Env } | undefined;

export function readEnv(source: Source = process.env): Env {
  if (source !== process.env) return parse(source);
  const key = Object.keys(envSchema.shape)
    .map((k) => source[k] ?? "")
    .join("\u0000");
  if (memo?.key !== key) memo = { key, value: parse(source) };
  return memo.value;
}

// Startup check (see instrumentation.ts): the app cannot run without these, so fail immediately and clearly.
export function validateEnv(source: Source = process.env): Env {
  const env = readEnv(source);
  if (!env.APP_SECRET) throw new EnvError("Invalid configuration:\n  APP_SECRET is required (at least 32 characters)");
  return env;
}

// ---- documentation ----

export type EnvDoc = { name: keyof Env; group: string; description: string; default?: string; example?: string };

export const ENV_DOCS: EnvDoc[] = [
  {
    name: "DATA_DIR",
    group: "Core",
    description:
      "Directory holding the console's SQLite database (emulator-console.db). Created if missing. In Compose it is /data, on a volume.",
    default: "./data",
  },
  {
    name: "APP_SECRET",
    group: "Core",
    description:
      "At least 32 random characters. Encrypts target secrets at rest; rotating it invalidates stored target secrets. Required.",
    example: "change-me-to-a-long-random-string-please",
  },
  {
    name: "DOCS_URL",
    group: "Core",
    description:
      "Where the Help button in the header points. Set it to your own copy of the user guide if you keep one.",
    default: "https://github.com/Seelan-Tech/emulator-console/tree/main/docs",
  },
  {
    name: "LOG_LEVEL",
    group: "Core",
    description: "Verbosity of server logs: debug, info, warn or error.",
    default: "info",
  },

  {
    name: "LOCAL_ALLOWED_HOSTS",
    group: "Access",
    description:
      "Extra Host header names the console accepts (comma-separated), besides localhost, 127.0.0.1 and [::1]. Requests with any other Host are refused (DNS-rebinding defence).",
    example: "console.lan",
  },

  {
    name: "ALLOW_LOCAL_CREDENTIAL_FILES",
    group: "Targets and credentials",
    description: "Let targets read the emulator's own credential files (restart detection depends on this).",
    default: "false",
  },
  {
    name: "LOCAL_CREDENTIALS_ROOT",
    group: "Targets and credentials",
    description: "Directory holding the emulator's per-port credential folders (mounted read-only).",
    default: "/emu",
  },
  {
    name: "LOCAL_TARGET_ENDPOINT",
    group: "Targets and credentials",
    description:
      "Endpoint of the Local emulator target the console creates by itself. Defaults to `https://emulator:<port>`.",
    example: "https://emulator:9297",
  },
];

// The text of `.env.example`. A test keeps the file identical to this, so it cannot drift from the code.
export function renderEnvExample(): string {
  const groups = [...new Set(ENV_DOCS.map((d) => d.group))];
  const blocks = groups.map((g) => {
    const lines = ENV_DOCS.filter((d) => d.group === g).flatMap((d) => {
      const value = d.example ?? d.default ?? "";
      const required = d.name === "APP_SECRET";
      const hint = d.default !== undefined && d.example === undefined ? "" : "";
      return [
        `# ${d.description}${d.default !== undefined ? ` (default: ${d.default})` : ""}`,
        `${required ? "" : "# "}${d.name}=${value}${hint}`,
      ];
    });
    return `# ---- ${g} ----\n${lines.join("\n")}`;
  });
  return `# Configuration for Emulator Console. Copy to .env and edit. Lines starting with "# KEY=" are optional.\n\n${blocks.join("\n\n")}\n`;
}

// The text of docs/configuration.md, kept identical to the code by a test (`npm run env:example` regenerates it).
export function renderConfigDoc(): string {
  const groups = [...new Set(ENV_DOCS.map((d) => d.group))];
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const sections = groups.map((g) => {
    const rows = ENV_DOCS.filter((d) => d.group === g).map((d) => {
      const required = d.name === "APP_SECRET";
      const fallback = d.default !== undefined ? `\`${cell(d.default)}\`` : required ? "**required**" : "unset";
      return `| \`${d.name}\` | ${fallback} | ${cell(d.description)} |`;
    });
    return `## ${g}\n\n| Variable | Default | Description |\n| --- | --- | --- |\n${rows.join("\n")}`;
  });
  return [
    "# Configuration reference",
    "",
    "<!-- Generated from src/lib/env.ts by `npm run env:example`. Do not edit by hand. -->",
    "",
    "The console is configured with environment variables. With Docker Compose, set them in the shell or in a `.env` file next to `compose.yaml`; `compose.yaml` already passes the ones it needs to the `console` service. A value that is present but invalid stops the app at start-up with a message naming the variable.",
    "",
    "A ready-to-edit template is in [`.env.example`](../.env.example).",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}
