import { type Conn, run, type ServiceName, serviceNames, services } from "./aws";
import { errorInfo } from "./errors";

export type Probe = {
  service: ServiceName;
  available: boolean | null; // null: the emulator could not be reached
  detail?: string;
};

// An unimplemented service answers UnknownService (or 404/501); any other API error still means it exists.
const UNSUPPORTED = /UnknownService|UnsupportedOperation|NotImplemented|could not resolve a target service/i;
const NETWORK = /TimeoutError|socket hang up|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND/i;
const CONCURRENCY = 4; // the emulator drops connections when probed with everything at once
const ATTEMPTS = 3;

async function probe(conn: Conn, service: ServiceName): Promise<Probe> {
  let msg = "";
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      await run(conn, service, services[service].probe, {});
      return { service, available: true };
    } catch (e) {
      const info = errorInfo(e);
      msg = `${info.name ?? ""} ${info.message}`.trim();
      if (NETWORK.test(msg)) continue;
      if (UNSUPPORTED.test(msg) || info.status === 404 || info.status === 501)
        return { service, available: false, detail: msg };
      return { service, available: true, detail: msg };
    }
  }
  return { service, available: null, detail: msg };
}

export async function discover(conn: Conn): Promise<Probe[]> {
  const queue = [...serviceNames];
  const results = new Map<ServiceName, Probe>();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) results.set(s, await probe(conn, s));
    }),
  );
  return serviceNames.map((s) => results.get(s)!);
}
