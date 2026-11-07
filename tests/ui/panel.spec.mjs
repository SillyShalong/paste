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

test("Copy Again copies without pasting (no keystroke, no focus grab)", async ({ page }) => {
  await page.locator(".card").first().click({ button: "right" });
  await page.getByText("Copy Again").click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        copy: window.__invoked.filter((c) => c.cmd === "copy_clip").length,
        paste: window.__invoked.filter((c) => c.cmd === "paste_clip").length,
      })),
    )
    .toEqual({ copy: 1, paste: 0 });
  const copiedId = await page.evaluate(
    () => window.__invoked.find((c) => c.cmd === "copy_clip")?.args.id,
  );
  expect(copiedId).toBe(FIXTURE_CLIPS[0].id);
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

test("a live clipboard:new event inserts the clip at the top", async ({ page }) => {
  const fresh = { ...FIXTURE_CLIPS[0], id: 99, text: "live event clip", createdAt: Date.now() };
  await page.evaluate((payload) => window.__fireEvent("clipboard:new", payload), fresh);
  await expect(page.locator(".card")).toHaveCount(FIXTURE_CLIPS.length + 1);
  await expect(page.locator(".card").first()).toContainText("live event clip");
});

test("detail preview stays in sync while browsing with arrow keys", async ({ page }) => {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toContainText("alpha note");
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toContainText("https://example.com");
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toContainText("alpha note");
});

test("delete from the detail header removes the clip and closes", async ({ page }) => {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toBeVisible();
  await page.locator(".detail-header .btn.danger").click();
  await expect(page.locator(".detail-overlay")).toHaveCount(0);
  await expect(page.locator(".card")).toHaveCount(FIXTURE_CLIPS.length - 1);
});

test("board view shows only the clips pinned to that board", async ({ page }) => {
  // Seed the BACKEND via an init script: reload-safe (addInitScript reruns
  // before the app on every load) and refetch serves it like SQLite would.
  await page.addInitScript(() => {
    const backend = window.__ipcState;
    backend.pinboards.push({ id: 1, name: "Work", position: 0, createdAt: 1700000000000 });
    backend.clips.push({ ...backend.clips[0], id: 50, pinboardId: 1, text: "pinned to work" });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__store.getState().clips.length > 0);
  await page.locator(".board-item", { hasText: "Work" }).click();
  await page.waitForTimeout(400);
  console.log("DBG-BOARD", await page.evaluate(() => ({
    view: window.__store.getState().view,
    n: window.__store.getState().clips.length,
    pins: window.__store.getState().clips.map((c) => c.pinboardId),
    calls: window.__invoked.filter((c) => c.cmd === "list_clips").slice(-2).map((c) => c.args),
  })));
  await expect(page.locator(".board-chip")).toHaveText("Work");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".card")).toContainText("pinned to work");
});

test("wheel over the strip scrolls horizontally", async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...FIXTURE_CLIPS[0], id: 100 + i, text: `clip number ${i}`,
  }));
  await page.evaluate((clips) => window.__store.setState({ clips }), many);
  const before = await page.evaluate(
    () => document.querySelector(".cards-row")?.scrollLeft ?? -1,
  );
  await page.evaluate(() => {
    document
      .querySelector(".cards-row")
      ?.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true }));
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(
    () => document.querySelector(".cards-row")?.scrollLeft ?? -1,
  );
  expect(after).toBeGreaterThan(before);
});

test("Copy Again shows the copied toast", async ({ page }) => {
  await page.locator(".card").first().click({ button: "right" });
  await page.getByText("Copy Again").click();
  await expect(page.locator(".toast")).toContainText("Copied to clipboard");
});

test("user scroll cancels the keyboard scroll animation (no jitter)", async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...FIXTURE_CLIPS[0], id: 200 + i, text: `bulk clip ${i}`,
  }));
  await page.evaluate((clips) => window.__store.setState({ clips }), many);

  // Keyboard-navigate to the far end — starts the scroll animation toward it.
  for (let i = 0; i < 11; i++) {
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
  }
  await page.waitForTimeout(120); // let the animation spin up toward the target
  const during = await page.evaluate(
    () => document.querySelector(".cards-row")?.scrollLeft ?? -1,
  );

  // User scrolls LEFT against the animation (trackpad swipe direction).
  await page.evaluate(() => {
    document
      .querySelector(".cards-row")
      ?.dispatchEvent(new WheelEvent("wheel", { deltaY: -600, bubbles: true }));
  });
  await page.waitForTimeout(700); // old code: animation pulls scrollLeft back right here
  const s1 = await page.evaluate(
    () => document.querySelector(".cards-row")?.scrollLeft ?? -1,
  );
  await page.waitForTimeout(400);
  const s2 = await page.evaluate(
    () => document.querySelector(".cards-row")?.scrollLeft ?? -1,
  );
  // The animation must be canceled: scrollLeft is frozen where the user's
  // swipe left it (single wheel delta = -600 applied once) — no drift back
  // toward the selected card at the far end.
  expect(s1).toBeLessThan(during + 50); // the swipe moved it left
  expect(s2).toBe(s1); // and it stays put
  expect(during).toBeGreaterThanOrEqual(0);
});

test("arrow keys continue from the trackpad-scrolled position (no teleport)", async ({ page }) => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...FIXTURE_CLIPS[0], id: 300 + i, text: `scroll clip ${i}`,
  }));
  await page.evaluate((clips) => window.__store.setState({ clips }), many);
  await page.waitForTimeout(100);

  // Trackpad: scroll right ~1200px in two swipes
  for (const dy of [600, 600]) {
    await page.evaluate((delta) => {
      document
        .querySelector(".cards-row")
        ?.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
    }, dy);
    await page.waitForTimeout(120);
  }
  const before = await page.evaluate(() => ({
    scrollLeft: Math.round(document.querySelector(".cards-row")?.scrollLeft ?? -1),
    sel: window.__store.getState().sel,
  }));
  expect(before.sel).toBeGreaterThan(0); // selection followed the viewport

  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => ({
    scrollLeft: Math.round(document.querySelector(".cards-row")?.scrollLeft ?? -1),
    sel: window.__store.getState().sel,
    maxScroll: document.querySelector(".cards-row")
      ? document.querySelector(".cards-row").scrollWidth -
        document.querySelector(".cards-row").clientWidth
      : -1,
  }));

  // Selection advanced by exactly one from the viewport-synced position
  expect(after.sel).toBe(before.sel + 1);
  // The strip moved only a card-width or so — NOT teleported to an end
  expect(Math.abs(after.scrollLeft - before.scrollLeft)).toBeLessThan(500);
  expect(after.scrollLeft).toBeGreaterThan(0);
});
