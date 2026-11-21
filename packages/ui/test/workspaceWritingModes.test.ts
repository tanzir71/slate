import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceWritingModes } from "../src/browser/workspaceWritingModes";

afterEach(() => vi.useRealTimers());
it("allocates no activity timers or snapshots while Zen is off", () => {
  vi.useFakeTimers(); const modes = createWorkspaceWritingModes(), initial = modes.getSnapshot(), changed = vi.fn(); modes.subscribe(changed);
  for (let index = 0; index < 100; index++) modes.activity();
  expect(modes.getSnapshot()).toBe(initial); expect(vi.getTimerCount()).toBe(0); expect(changed).not.toHaveBeenCalled();
});
it("resets the idle deadline without rerendering on every key while the HUD is visible", () => {
  vi.useFakeTimers(); const modes = createWorkspaceWritingModes(), changed = vi.fn(); modes.zen(true); modes.subscribe(changed);
  const visible = modes.getSnapshot();
  for (let index = 0; index < 100; index++) modes.activity();
  expect(modes.getSnapshot()).toBe(visible); expect(changed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(1999); expect(modes.getSnapshot().hud).toBe(true);
  modes.activity(); vi.advanceTimersByTime(1999); expect(modes.getSnapshot().hud).toBe(true);
  vi.advanceTimersByTime(1); expect(modes.getSnapshot().hud).toBe(false); expect(changed).toHaveBeenCalledTimes(1);
  modes.activity(); expect(modes.getSnapshot().hud).toBe(true); expect(changed).toHaveBeenCalledTimes(2); modes.dispose();
});
it("cancels idle work on exit and disposal without changing another Space's writing state", () => {
  vi.useFakeTimers(); const first = createWorkspaceWritingModes(), second = createWorkspaceWritingModes(); first.zen(true); second.zen(true);
  first.zen(false); expect(vi.getTimerCount()).toBe(1); expect(first.getSnapshot().zen).toBe(false);
  const changed = vi.fn(); second.subscribe(changed); second.dispose(); expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(10_000); expect(changed).not.toHaveBeenCalled(); expect(first.getSnapshot().hud).toBe(false);
});
