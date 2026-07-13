// In-memory coordination for HTTP long-polling notification clients (the
// Pharmacy Desktop, which runs on .NET 4.8 / Windows 7 where a live WebSocket
// isn't reliable). A long-poll handler parks on waitForLine(); the socket emit
// path calls signalLine() the instant a notification is created, waking every
// parked poller for that line immediately — so the desktop gets web-grade
// realtime alerts over plain HTTPS.
//
// Purely in-process: on a multi-instance deployment a signal only reaches
// pollers on the same instance, but the long-poll's periodic DB re-check is the
// safety net, so at worst a notification is a couple seconds late, never lost.

type Waiter = () => void;

const waiters = new Map<string, Set<Waiter>>();

/** Wake every long-poll currently parked on this line. */
export function signalLine(lineId: string | null | undefined): void {
  if (!lineId) return;
  const set = waiters.get(lineId);
  if (!set || set.size === 0) return;
  // copy first: each waiter removes itself as it resolves
  for (const w of [...set]) {
    try {
      w();
    } catch {
      /* ignore a single bad waiter */
    }
  }
}

/**
 * Resolve as soon as signalLine(lineId) fires, or after `ms` — whichever comes
 * first. The caller re-queries the DB on wake and either returns rows or parks
 * again until its overall deadline.
 */
export function waitForLine(lineId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let set = waiters.get(lineId);
    if (!set) {
      set = new Set<Waiter>();
      waiters.set(lineId, set);
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      set!.delete(finish);
      if (set!.size === 0) waiters.delete(lineId);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    set.add(finish);
  });
}
