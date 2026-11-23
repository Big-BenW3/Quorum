import "server-only";

/**
 * Live updates. Vercel cannot host a WebSocket server, so the default is bounded polling from the
 * browser against gated endpoints (see src/lib/use-polling.ts). This interface is where a managed
 * realtime provider (Pusher, Ably, Supabase Realtime) plugs in.
 *
 * Hard rule for any implementation: events carry NO counts, tallies or selections. They only say
 * "something changed", and the client re-fetches through the normal endpoints, which enforce the
 * election's disclosure policy on the server. A hidden result therefore cannot leak through a
 * realtime channel.
 */
export type RealtimeEvent = { type: "turnout.updated" | "results.updated" | "election.status" };

export interface Realtime {
  publish(channel: string, event: RealtimeEvent): Promise<void>;
}

class NoopRealtime implements Realtime {
  async publish() {}
}

let instance: Realtime = new NoopRealtime();
export const getRealtime = () => instance;
export const setRealtime = (r: Realtime) => { instance = r; };
