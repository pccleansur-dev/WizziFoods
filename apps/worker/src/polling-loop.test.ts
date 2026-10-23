import { afterEach, describe, expect, it, vi } from "vitest";

import { startPollingLoop } from "./polling-loop.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("polling loop", () => {
  it("waits between iterations and continues after transient errors", async () => {
    vi.useFakeTimers();
    const error = new Error("temporary");
    const iteration = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const onError = vi.fn();

    const loop = startPollingLoop({ iteration, onError, pollMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(iteration).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(iteration).toHaveBeenCalledTimes(2);

    await loop.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(iteration).toHaveBeenCalledTimes(2);
  });

  it("never overlaps slow iterations", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const iteration = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const loop = startPollingLoop({
      iteration,
      onError: vi.fn(),
      pollMs: 100
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(iteration).toHaveBeenCalledOnce();
    finish?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(iteration).toHaveBeenCalledTimes(2);

    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    await loop.stop();
  });
});
