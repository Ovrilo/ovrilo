/**
 * Client-side send pacing. The server is the authority (429 with Retry-After, per user across all
 * channels); this mirrors its default limit so a burst is stopped before the request and the
 * person sees a cooldown instead of a stack of failed messages.
 */
export const SEND_BURST = 5;
export const SEND_WINDOW_MS = 5000;

export class SendThrottle {
  private sends: number[] = [];
  private until = 0;
  private readonly listeners = new Set<() => void>();

  /** When sending is allowed again (epoch ms); in the past when it is allowed now. */
  cooldownUntil = (): number => this.until;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Counts a send if allowed now; otherwise starts (or keeps) the cooldown and returns false. */
  tryAcquire(now: number): boolean {
    if (now < this.until) return false;
    this.sends = this.sends.filter((t) => now - t < SEND_WINDOW_MS);
    if (this.sends.length >= SEND_BURST) {
      this.set(this.sends[0]! + SEND_WINDOW_MS);
      return false;
    }
    this.sends.push(now);
    return true;
  }

  /** The server refused a send: wait as long as it asked. */
  penalize(now: number, retryAfterSeconds: number) {
    this.set(Math.max(this.until, now + retryAfterSeconds * 1000));
  }

  private set(until: number) {
    if (until === this.until) return;
    this.until = until;
    this.listeners.forEach((listener) => listener());
  }
}

/** One per app: the server's limit is per user, not per channel. */
export const sendThrottle = new SendThrottle();

/** Seconds from a Retry-After header (delta-seconds form); a safe default when absent or odd. */
export function retryAfterSeconds(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : SEND_WINDOW_MS / 1000;
}
