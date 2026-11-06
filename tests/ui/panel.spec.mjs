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

test("Delete removes the selected clip and hits the backend", async ({ page }) => {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })),
  );
  await expect(page.locator(".card")).toHaveCount(FIXTURE_CLIPS.length - 1);
  const deletedId = await page.evaluate(
    () => window.__invoked.find((c) => c.cmd === "delete_clip")?.args.id,
  );
  expect(deletedId).toBe(FIXTURE_CLIPS[0].id);
});

test("Delete while typing in search does NOT delete a clip (regression)", async ({ page }) => {
  const input = page.locator(".search-input");
  await input.click();
  await input.press("Delete");
  await expect(page.locator(".card")).toHaveCount(FIXTURE_CLIPS.length);
  const deletes = await page.evaluate(
    () => window.__invoked.filter((c) => c.cmd === "delete_clip").length,
  );
  expect(deletes).toBe(0);
});

test("Space opens the full-content preview and Esc closes it", async ({ page }) => {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toBeVisible();
  await expect(page.locator(".detail-overlay")).toContainText("alpha note");
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toHaveCount(0);
});

test("pause toggle hits the backend and the banner renders on state change", async ({ page }) => {
  // The button calls toggle_pause directly; the banner updates via the
  // pause:changed event, which the mock never fires — so simulate the
  // event's store effect for the rendering half of the assertion.
  await page.getByRole("button", { name: "Pause history" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ipcState.paused))
    .toBe(true);
  const called = await page.evaluate(() =>
    window.__invoked.some((c) => c.cmd === "toggle_pause"),
  );
  expect(called).toBe(true);
  await page.evaluate(() => window.__store.setState({ paused: true }));
  await expect(page.locator(".paused-banner")).toBeVisible();
  await page.getByRole("button", { name: "Resume history" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ipcState.paused))
    .toBe(false);
});

test("theme switch updates the panel attribute", async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__store.getState().settings;
    window.__store.setState({ settings: { ...s, theme: "light" } });
  });
  await expect(page.locator('.panel[data-theme="light"]')).toHaveCount(1);
});

test("language switch renders Chinese labels", async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__store.getState().settings;
    window.__store.setState({ settings: { ...s, language: "zh" } });
  });
  await expect(page.locator(".search-input")).toHaveAttribute(
    "placeholder",
    "搜索剪贴板历史…",
  );
});

test("empty history shows the empty state", async ({ page }) => {
  await page.evaluate(() => window.__store.setState({ clips: [] }));
  await expect(page.locator(".empty-state")).toBeVisible();
});

test("pinboard creation calls IPC and lists the board", async ({ page }) => {
  await page.getByRole("button", { name: "+ New Pinboard" }).click();
  await page.locator(".board-input").fill("Work");
  await page.locator(".board-input").press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => window.__invoked.some((c) => c.cmd === "create_pinboard")),
    )
    .toBe(true);
  await expect(page.locator(".board-name")).toHaveText("Work");
});
