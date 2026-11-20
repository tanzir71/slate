import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`enabled tab action icons remain distinguishable in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("slate.appearance", theme), theme);
    await page.goto("./?sample=1");
    const bar = page.locator(".editorTabsBar"); await expect(bar.getByRole("tab", { selected: true })).toBeVisible();
    await page.mouse.move(0, 0);
    const metrics = await bar.evaluate((bar) => {
      function luminance(color: string) {
        const values = color.match(/[\d.]+/g);
        if (!values || values.length < 3) throw new Error(`Expected a computed RGB color: ${color}`);
        const channels = values.slice(0, 3).map((value) => { const channel = Number(value) / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      }
      const selected = bar.querySelector('[role="tab"][aria-selected="true"]');
      if (!selected) throw new Error("Open a sheet before checking enabled controls.");
      const surfaces = [getComputedStyle(bar).backgroundColor, getComputedStyle(selected).backgroundColor];
      return [...bar.querySelectorAll<HTMLButtonElement>(".editorTabClose, .editorTabActions > button")].filter((button) => !button.disabled).map((button) => {
        const foreground = getComputedStyle(button.querySelector("svg, .tabGlyph") ?? button).color, first = luminance(foreground);
        const contrast = Math.min(...surfaces.map((color) => { const second = luminance(color); return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05); }));
        return { name: button.getAttribute("aria-label"), foreground, surfaces, contrast };
      });
    });
    await testInfo.attach(`${theme}-tab-action-contrast`, { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
    expect(metrics.length).toBeGreaterThanOrEqual(3);
    // Required control icons need 3:1 against their adjacent surfaces:
    // https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
    for (const metric of metrics) expect(metric.contrast, `${theme} ${metric.name}: ${JSON.stringify(metric)}`).toBeGreaterThanOrEqual(3);
  });
}
