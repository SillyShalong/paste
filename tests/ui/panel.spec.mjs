import { test, expect } from "@playwright/test";
import { FIXTURE_CLIPS, MOCK_SCRIPT } from "./mock.mjs";

// Every test loads the real panel frontend (vite dev build) with the Tauri
// IPC seam mocked, so filters/search/paste run the actual store code path.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(MOCK_SCRIPT);
  await page.goto("/");
  await page.waitForFunction(() => window.__store && window.__store.getState().clips.length > 0);
});

test("renders all history clips as cards", async ({ page }) => {
  const cards = page.locator(".card");
  await expect(cards).toHaveCount(FIXTURE_CLIPS.length);
  await expect(page.locator(".card").first()).toContainText("alpha note");
});

test("kind filter chips query and render only matching clips", async ({ page }) => {
  await page.getByRole("button", { name: "Colors" }).click();
  const cards = page.locator(".card");
  await expect(cards).toHaveCount(2);
  // color cards render a swatch styled with their own color
  await expect(cards.first()).toContainText("#22c55e");
  const swatch = cards.first().locator("[style*='background']").first();
  await expect(swatch).toBeVisible();
});

test("search filters clips by text", async ({ page }) => {
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("alpha");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".card")).toContainText("alpha note");
  // Clear with select-all + delete (keyboard) — closer to real usage and
  // reliable against React's controlled-input re-render.
  await input.press("ControlOrMeta+a");
  await input.press("Delete");
  await expect(page.locator(".card")).toHaveCount(FIXTURE_CLIPS.length);
});

test("arrow keys move the card selection within bounds", async ({ page }) => {
  const selected = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".card")].findIndex((c) => c.classList.contains("selected")),
    );
  await expect.poll(selected).toBe(0);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  await expect.poll(selected).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  await expect.poll(selected).toBe(0);
});

test("Enter pastes the selected clip through the IPC bridge", async ({ page }) => {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.__invoked.some((c) => c.cmd === "paste_clip")),
    )
    .toBe(true);
});
