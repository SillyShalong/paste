import { test } from "@playwright/test";
import { MOCK_SCRIPT } from "./mock.mjs";

test("settings route debug", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await page.addInitScript(MOCK_SCRIPT);
  await page.goto("/#/settings");
  await page.waitForTimeout(800);
  const rootHtml = await page.evaluate(() => document.getElementById("root")?.innerHTML ?? "none");
  console.log("ERRORS:", JSON.stringify(errors).slice(0, 800));
  console.log("ROOT-HTML:", rootHtml);
});
