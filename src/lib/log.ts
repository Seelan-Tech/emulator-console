// Minimal structured logger: JSON lines in production (easy to ship to any log pipeline), readable text in
// development. LOG_LEVEL=debug|info|warn|error (default info). This is the only place that touches `console`.
type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL;
  return configured && configured in ORDER ? ORDER[configured as Level] : ORDER.info;
}

function emit(level: Level, msg: string, meta?: Meta) {
  if (ORDER[level] < threshold()) return;
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify({ level, time: new Date().toISOString(), msg, ...meta })
      : `${level.toUpperCase()} ${msg}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
  /* eslint-disable no-console */
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  /* eslint-enable no-console */
}

export const log = {
  debug: (msg: string, meta?: Meta) => emit("debug", msg, meta),
  info: (msg: string, meta?: Meta) => emit("info", msg, meta),
  warn: (msg: string, meta?: Meta) => emit("warn", msg, meta),
  error: (msg: string, meta?: Meta) => emit("error", msg, meta),
};
