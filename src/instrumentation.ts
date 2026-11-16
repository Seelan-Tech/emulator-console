// Runs once when the server starts (not during `next build`).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv(); // throws (and the container exits) with a readable message if configuration is missing or invalid
    (await import("./lib/log")).log.warn(
      "Emulator Console has no login: anyone who can reach this server can use it. Keep it on loopback.",
    );
    const { startRestartWatcher } = await import("./lib/restart-watch");
    startRestartWatcher();
  }
}
