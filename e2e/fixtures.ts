import { test as base, expect, type BrowserContext, type BrowserContextOptions } from "@playwright/test";

type ContextFactory = (options?: BrowserContextOptions) => Promise<BrowserContext>;

// WebKit disables OPFS in ephemeral contexts. An empty profile path asks Playwright
// for a fresh temporary persistent profile, which it removes when the context closes.
// Tests that change origin-global OPFS files must restore their original bytes;
// macOS WebKit can retain that storage across these temporary profiles.
export const test = base.extend<{ createContext: ContextFactory }>({
  createContext: async ({ browser, playwright, browserName, contextOptions, baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, colorScheme, timezoneId }, use) => {
    const contexts: BrowserContext[] = [];
    const defaults: BrowserContextOptions = { ...contextOptions, viewport, isMobile, hasTouch,
      ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
      ...(locale === undefined ? {} : { locale }), ...(colorScheme === undefined ? {} : { colorScheme }),
      ...(baseURL ? { baseURL } : {}), ...(userAgent ? { userAgent } : {}), ...(timezoneId ? { timezoneId } : {}) };
    await use(async (options = {}) => {
      const context = browserName === "webkit"
        ? await playwright.webkit.launchPersistentContext("", { ...defaults, ...options, headless: true })
        : await browser.newContext({ ...defaults, ...options });
      contexts.push(context);
      return context;
    });
    for (const context of contexts) await context.close();
  },
  context: async ({ context, browserName, createContext }, use) => {
    if (browserName !== "webkit") { await use(context); return; }
    const persistent = await createContext();
    await use(persistent);
  }
});

export { expect };
