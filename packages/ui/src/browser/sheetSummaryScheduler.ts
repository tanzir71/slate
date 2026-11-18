import type { SummaryInput } from "./sheetSummaryProtocol";

type Timer = ReturnType<typeof setTimeout>;
export interface SummaryClock {
  now(): number;
  setTimer(run: () => void, delay: number): Timer;
  clearTimer(timer: Timer): void;
  requestFrame(run: () => void): number;
  cancelFrame(frame: number): void;
}
const browserClock: SummaryClock = {
  now: () => performance.now(),
  setTimer: (run, delay) => setTimeout(run, delay),
  clearTimer: (timer) => clearTimeout(timer),
  requestFrame: (run) => requestAnimationFrame(run),
  cancelFrame: (frame) => cancelAnimationFrame(frame),
};

/** Bound full-document summaries while publishing throughout continuous input. */
export function createSheetSummaryScheduler(
  read: (sheets: readonly SummaryInput[]) => void,
  clock = browserClock,
) {
  let active = true;
  let latest: readonly SummaryInput[] | undefined;
  let lastPosted = -Infinity;
  let timer: Timer | undefined;
  let frame: number | undefined;

  function post() {
    timer = undefined;
    if (!active || !latest) return;
    lastPosted = clock.now();
    read(latest);
  }
  function afterDelay() {
    timer = undefined;
    if (!active) return;
    frame = clock.requestFrame(() => {
      frame = undefined;
      if (active) timer = clock.setTimer(post, 0);
    });
  }
  return {
    read(sheets: readonly SummaryInput[]) {
      if (!active) return;
      latest = sheets;
      if (timer === undefined && frame === undefined)
        timer = clock.setTimer(
          afterDelay,
          Math.max(0, 100 - (clock.now() - lastPosted)),
        );
    },
    close() {
      active = false;
      latest = undefined;
      if (timer !== undefined) clock.clearTimer(timer);
      if (frame !== undefined) clock.cancelFrame(frame);
    },
  };
}
