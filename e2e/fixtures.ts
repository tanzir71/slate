import { test as base, expect, type BrowserContext, type BrowserContextOptions } from "@playwright/test";

type ContextFactory = (options?: BrowserContextOptions) => Promise<BrowserContext>;

// WebKit disables OPFS in ephemeral contexts. An empty profile path asks Playwright
// for a fresh temporary persistent profile, which it removes when the context closes.
export const test = base.extend<{ createContext: ContextFactory }>({
  createContext: async ({ browser, playwright, browserName }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = browserName === "webkit"
        ? await playwright.webkit.launchPersistentContext("", { ...options, headless: true })
        : await browser.newContext(options);
      contexts.push(context);
      return context;
    });
    for (const context of contexts) await context.close();
  },
  context: async ({ context, browserName, createContext, baseURL, viewport, userAgent }, use) => {
    if (browserName !== "webkit") { await use(context); return; }
    const persistent = await createContext({ ...(baseURL ? { baseURL } : {}), viewport, ...(userAgent ? { userAgent } : {}) });
    await use(persistent);
  }
});

export { expect };
