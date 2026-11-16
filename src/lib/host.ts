import { readEnv } from "./env";

type Source = Record<string, string | undefined>;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// DNS-rebinding defence: the console has no login, so the only thing keeping a malicious website from calling it
// through the browser is that the Host header must be one we expect (an attacker's domain would not be).
export function hostAllowed(hostHeader: string | null | undefined, env: Source = process.env): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, "");
  return LOCAL_HOSTS.includes(host) || readEnv(env).LOCAL_ALLOWED_HOSTS.includes(host);
}
