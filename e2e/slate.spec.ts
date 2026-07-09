import { expect, test } from "@playwright/test";

test("loads the Slate workspace and creates a new sheet", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Slate").first()).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Sheet" }).first()).toBeVisible();

  await page.getByRole("button", { name: "New Sheet" }).first().click();

  await expect(page.getByRole("heading", { name: "Untitled Sheet" })).toBeVisible();
  await expect(page.getByLabel("Markdown editor")).toBeVisible();
});

test("filters sheets by search text", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("Search sheets...").fill("research");
  await expect(page.getByRole("button", { name: /User Research Synthesis/ })).toBeVisible();
});

