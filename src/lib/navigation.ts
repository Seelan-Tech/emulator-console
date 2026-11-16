// A full page load, not a client-side route change. After sign-in/sign-out (or deleting the thing you are
// looking at) the server must render fresh with the new session, and no stale client router state may survive.
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
