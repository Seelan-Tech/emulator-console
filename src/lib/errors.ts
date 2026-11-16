export const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "unknown error";
};

export type ErrorInfo = { name?: string; message: string; status?: number };

// Normalizes the error shapes we meet: AWS SDK errors (`$metadata.httpStatusCode`), our own errors with a
// `status`, and anything else thrown.
export function errorInfo(e: unknown): ErrorInfo {
  if (e instanceof Error) {
    const withStatus = e as Error & { $metadata?: { httpStatusCode?: number }; status?: number };
    return { name: e.name, message: e.message, status: withStatus.$metadata?.httpStatusCode ?? withStatus.status };
  }
  return { message: errorMessage(e) };
}

// SQLite reports a unique-constraint violation as "UNIQUE constraint failed: table.column".
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/.test(e.message);
}
