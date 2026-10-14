import { describe, expect, it } from "vitest";

import { retryAfterSeconds, SEND_BURST, SEND_WINDOW_MS, SendThrottle } from "./throttle";

describe("SendThrottle", () => {
  it("allows a burst, then cools down until the oldest send leaves the window", () => {
    const throttle = new SendThrottle();
    for (let i = 0; i < SEND_BURST; i++) expect(throttle.tryAcquire(1000 + i * 100)).toBe(true);
    expect(throttle.tryAcquire(1600)).toBe(false);
    expect(throttle.cooldownUntil()).toBe(1000 + SEND_WINDOW_MS);
    expect(throttle.tryAcquire(1000 + SEND_WINDOW_MS - 1)).toBe(false);
    expect(throttle.tryAcquire(1000 + SEND_WINDOW_MS)).toBe(true);
  });

  it("waits as long as the server asks after a 429", () => {
    const throttle = new SendThrottle();
    let notified = 0;
    throttle.subscribe(() => notified++);
    throttle.penalize(10_000, 3);
    expect(throttle.tryAcquire(12_999)).toBe(false);
    expect(throttle.tryAcquire(13_000)).toBe(true);
    expect(notified).toBe(1);
  });
});

describe("retryAfterSeconds", () => {
  it("reads delta seconds and falls back for missing or invalid values", () => {
    expect(retryAfterSeconds("3")).toBe(3);
    expect(retryAfterSeconds(null)).toBe(SEND_WINDOW_MS / 1000);
    expect(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(SEND_WINDOW_MS / 1000);
    expect(retryAfterSeconds("3600")).toBe(60);
  });
});
