import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("the desktop policy permits the workspace and blocks injected scripts, bases and outbound fetches", async ({ page }) => {
  await nativeFixture(page, { "note.md": "Words kept on this device" });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Reflect.set(window, "nativePolicyViolations", violations);
    document.addEventListener("securitypolicyviolation", (event) => violations.push(event.effectiveDirective));
  });
  const response = await page.goto("./");
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await expect(page.locator(".cm-content")).toHaveText("Words kept on this device");
  const before = await page.evaluate(() => document.baseURI);
  await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.nativeInjectedScriptRan = true";
    document.head.append(script);
    const base = document.createElement("base");
    base.href = "https://slate-csp.invalid/";
    document.head.append(base);
    await fetch("https://slate-csp.invalid/blocked").catch(() => undefined);
  });
  expect(await page.evaluate(() => Reflect.get(window, "nativeInjectedScriptRan"))).toBeUndefined();
  expect(await page.evaluate(() => document.baseURI)).toBe(before);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "nativePolicyViolations") as string[])).toEqual(expect.arrayContaining(["script-src-elem", "base-uri", "connect-src"]));
  await expect(page.locator(".cm-content")).toHaveText("Words kept on this device");
  await expect(page.locator(".storageFooter")).not.toContainText("Search cache unavailable");
});
