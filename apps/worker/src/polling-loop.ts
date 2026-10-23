type PollingLoopInput = {
  iteration: () => Promise<void>;
  onError: (error: unknown) => void;
  pollMs: number;
};

export type PollingLoop = {
  stop(): Promise<void>;
};

export function startPollingLoop(input: PollingLoopInput): PollingLoop {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;

  const run = async (): Promise<void> => {
    try {
      await input.iteration();
    } catch (error) {
      try {
        input.onError(error);
      } catch {
        // Reporting failures must not stop queue consumption.
      }
    }

    if (!stopped) {
      timer = setTimeout(() => {
        active = run();
      }, input.pollMs);
    }
  };

  active = run();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    }
  };
}
