import { test, expect } from "@playwright/test";
import { MOCK_SCRIPT } from "./mock.mjs";

test("onboarding renders steps and flips to granted live", async ({ page }) => {
  await page.addInitScript(MOCK_SCRIPT + "; window.__axTrusted = false;");
  await page.goto("/#/onboarding");
  await page.waitForTimeout(400);

  await expect(page.locator(".onb-heading")).toContainText("Welcome to Paste");
  await expect(page.locator(".onb-badge")).toContainText("Not granted yet");
  await expect(page.getByRole("button", { name: "Open System Settings" })).toBeVisible();

  // simulate the user enabling Accessibility in System Settings
  await page.evaluate(() => {
    window.__axTrusted = true;
  });
  await expect(page.locator(".onb-badge")).toContainText("Granted");
  await expect(page.locator(".onb-done")).toBeVisible();

  await page.locator(".onb-done").click();
  await expect(page.locator(".onb-final")).toContainText("Cmd+Shift+V");
});

test("request button triggers the system Accessibility prompt", async ({ page }) => {
  await page.addInitScript(MOCK_SCRIPT + "; window.__axTrusted = false;");
  await page.goto("/#/onboarding");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Request Accessibility Permission" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__invoked.some((c) => c.cmd === "request_accessibility_permission"),
      ),
    )
    .toBe(true);
});

test("onboarding finish closes the window through the IPC bridge", async ({ page }) => {
  await page.addInitScript(MOCK_SCRIPT + "; window.__axTrusted = true;");
  await page.goto("/#/onboarding");
  await page.waitForTimeout(400);
  await page.locator(".onb-done").click();
  await page.locator(".onb-final button").click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__invoked.some((c) => c.cmd === "close_window")),
    )
    .toBe(true);
});
