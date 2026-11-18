import { afterEach, expect, it, vi } from "vitest";
import {
  createSheetSummaryScheduler,
  type SummaryClock,
} from "../src/browser/sheetSummaryScheduler";

afterEach(() => vi.useRealTimers());

function fakeClock(): SummaryClock {
  let sequence = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    now: () => Date.now(),
    setTimer: (run, delay) => setTimeout(run, delay),
    clearTimer: (timer) => clearTimeout(timer),
    requestFrame(run) {
      const id = ++sequence;
      frames.set(
        id,
        setTimeout(() => {
          frames.delete(id);
          run();
        }, 16),
      );
      return id;
    },
    cancelFrame(id) {
      clearTimeout(frames.get(id));
      frames.delete(id);
    },
  };
}
const sheets = (content: string) => [{ path: "A.md", content }];

it("uses the latest edit that arrives between a frame and its queued post", () => {
  vi.useFakeTimers({ now: 0 });
  const read = vi.fn();
  const scheduler = createSheetSummaryScheduler(read, fakeClock());
  scheduler.read(sheets("before frame"));
  vi.advanceTimersByTime(16);
  expect(read).not.toHaveBeenCalled();
  scheduler.read(sheets("after frame"));
  vi.advanceTimersByTime(4);
  expect(read.mock.calls).toEqual([[sheets("after frame")]]);
  scheduler.close();
});

it("coalesces the first frame and the next refresh window into their latest snapshots", () => {
  vi.useFakeTimers({ now: 0 });
  const read = vi.fn();
  const scheduler = createSheetSummaryScheduler(read, fakeClock());
  scheduler.read(sheets("a"));
  scheduler.read(sheets("ab"));
  scheduler.read(sheets("abc"));
  expect(read).not.toHaveBeenCalled();
  vi.advanceTimersByTime(20);
  expect(read.mock.calls).toEqual([[sheets("abc")]]);
  scheduler.read(sheets("abcd"));
  vi.advanceTimersByTime(30);
  scheduler.read(sheets("abcde"));
  vi.advanceTimersByTime(60);
  expect(read).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30);
  expect(read.mock.calls).toEqual([[sheets("abc")], [sheets("abcde")]]);
  scheduler.close();
});

it("publishes during continuous editing at a bounded cadence and catches up to the final text", () => {
  vi.useFakeTimers({ now: 0 });
  const posted: { time: number; content: string }[] = [];
  const scheduler = createSheetSummaryScheduler(
    (input) => posted.push({ time: Date.now(), content: input[0]!.content }),
    fakeClock(),
  );
  for (let index = 0; index < 30; index++) {
    scheduler.read(sheets(String(index)));
    vi.advanceTimersByTime(20);
    if (index === 14) expect(posted.length).toBeGreaterThan(1);
  }
  vi.advanceTimersByTime(50);
  expect(posted.length).toBeGreaterThan(3);
  expect(posted.length).toBeLessThanOrEqual(7);
  expect(posted.at(-1)?.content).toBe("29");
  for (let index = 1; index < posted.length; index++) {
    expect(
      posted[index]!.time - posted[index - 1]!.time,
    ).toBeGreaterThanOrEqual(100);
    expect(Number(posted[index]!.content)).toBeGreaterThan(
      Number(posted[index - 1]!.content),
    );
  }
  scheduler.close();
});

it.each([0, 1, 16])(
  "cancels pending work at time %i and ignores reads after closing",
  (elapsed) => {
    vi.useFakeTimers({ now: 0 });
    const read = vi.fn();
    const scheduler = createSheetSummaryScheduler(read, fakeClock());
    scheduler.read(sheets("a"));
    vi.advanceTimersByTime(elapsed);
    scheduler.close();
    scheduler.close();
    scheduler.read(sheets("later"));
    vi.runAllTimers();
    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);
