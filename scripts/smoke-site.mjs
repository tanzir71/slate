import { chromium, expect } from "@playwright/test";

const target = process.env.SLATE_SMOKE_URL;
if (!target) throw new Error("Set SLATE_SMOKE_URL to the deployed app URL");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const response = await page.goto(new URL("../", target).href);
  if (!response?.ok()) throw new Error(`App returned ${response?.status()}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Markdown at the");
  await page.getByRole("link", { name: "Open in your browser", exact: true }).first().click();
  await page.getByText("Keep notes in this browser", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "New Sheet", exact: true }).first().click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("# Release smoke\n\nMy words stay here.");
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("My words stay here.");
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`Verified first-run, save and reopen at ${target}`);
} finally { await browser.close(); }
