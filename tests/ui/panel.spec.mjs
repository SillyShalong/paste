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

test("vertical arrows cycle the pinboard views", async ({ page }) => {
  await page.addInitScript(() => {
    const backend = window.__ipcState;
    backend.pinboards.push(
      { id: 1, name: "Work", position: 0, createdAt: 1700000000000 },
      { id: 2, name: "Snippets", position: 1, createdAt: 1700000000001 },
    );
    backend.clips.push({ ...backend.clips[0], id: 60, pinboardId: 1, text: "pinned work item" });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__store.getState().clips.length > 0);

  const getView = () => page.evaluate(() => window.__store.getState().view);
  const chip = () => page.locator(".board-chip");

  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await expect(chip()).toHaveText("Work");
  await expect(await getView()).toMatchObject({ type: "board", id: 1 });
  await expect(page.locator(".card")).toHaveCount(1); // the pinned clip

  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await expect(chip()).toHaveText("Snippets");
  await expect(page.locator(".card")).toHaveCount(0); // board 2 is empty

  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await expect(await getView()).toMatchObject({ type: "history" }); // wrapped around
  await expect(chip()).toHaveCount(0);

  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })),
  );
  await expect(chip()).toHaveText("Snippets"); // wrap backwards to the last board
});

test("vertical arrows are inert while typing in the search box", async ({ page }) => {
  await page.addInitScript(() => {
    window.__ipcState.pinboards.push({ id: 1, name: "Work", position: 0, createdAt: 1700000000000 });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__store.getState().clips.length > 0);

  const input = page.locator(".search-input");
  await input.click();
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  const current = await page.evaluate(() => window.__store.getState().view);
  expect(current.type).toBe("history");
  await expect(page.locator(".board-chip")).toHaveCount(0);
});

test("pinboards can be renamed inline", async ({ page }) => {
  await page.addInitScript(() => {
    window.__ipcState.pinboards.push({ id: 1, name: "Work", position: 0, createdAt: 1700000000000 });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__store.getState().pinboards.length > 0);

  const item = page.locator(".board-item", { hasText: "Work" });
  await item.hover();
  await item.locator(".board-del").first().click(); // ✎ rename button
  const input = page.locator(".board-input");
  await expect(input).toHaveValue("Work");
  await input.fill("Work Items");
  await input.press("Enter");

  await expect(page.locator(".board-name")).toHaveText("Work Items");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = window.__invoked.find((x) => x.cmd === "rename_pinboard");
        return { id: c?.args.id, name: c?.args.name };
      }),
    )
    .toMatchObject({ id: 1, name: "Work Items" });
});

test("escape cancels the rename without changes", async ({ page }) => {
  await page.addInitScript(() => {
    window.__ipcState.pinboards.push({ id: 1, name: "Keep", position: 0, createdAt: 1700000000000 });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__store.getState().pinboards.length > 0);

  const item = page.locator(".board-item", { hasText: "Keep" });
  await item.hover();
  await item.locator(".board-del").first().click();
  const input = page.locator(".board-input");
  await expect(input).toHaveValue("Keep");
  await input.fill("Changed");
  await input.press("Escape");

  await expect(page.locator(".board-name")).toHaveText("Keep");
  const renames = await page.evaluate(
    () => window.__invoked.filter((c) => c.cmd === "rename_pinboard").length,
  );
  expect(renames).toBe(0);
});

test("typing always jumps into search, even after arrow navigation", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.waitForTimeout(100);

  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  });
  await page.waitForTimeout(150);

  const active = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(active).toContain("search-input"); // typing focuses search
  // The synthetic keydown cannot insert text itself — real keystrokes land
  // in the newly focused box (standard type-to-search behavior).
});

test("space with a selected card previews instead of typing", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toBeVisible(); // preview, not a space
  await expect(page.locator(".search-input")).toHaveValue(""); // box untouched
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await expect(page.locator(".detail-overlay")).toHaveCount(0);
});

test("typing still jumps into search before any navigation", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  });
  await page.waitForTimeout(150);
  const focused = await page.evaluate(
    () => document.activeElement?.classList.contains("search-input") ?? false,
  );
  expect(focused).toBe(true);
});

test("slash focuses the search box after navigation", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  });
  await page.waitForTimeout(150);
  const focused = await page.evaluate(
    () => document.activeElement?.classList.contains("search-input") ?? false,
  );
  expect(focused).toBe(true);
});

test("clicking the search input allows normal typing", async ({ page }) => {
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("alpha");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(input).toBeFocused();
});

async function openSettings(page) {
  const { appendFileSync } = await import("node:fs");
  await page.goto("/#/settings");
  const h1 = await page.evaluate(() => location.hash);
  await page.reload();
  const h2 = await page.evaluate(() => location.hash);
  appendFileSync("/tmp/pw-hash.log", `after-goto=${JSON.stringify(h1)} after-reload=${JSON.stringify(h2)}\n`);
  await page.waitForSelector(".settings-root h1");
}

test("retention presets require confirmation before cleanup", async ({ page }) => {
  await openSettings(page);
  const select = page.locator('[data-testid="retention-select"]');
  await expect(select).toHaveValue("0"); // permanent by default

  // Destructive change: 5 days → needs the confirm strip, no IPC yet
  await select.selectOption("5");
  await expect(page.locator('[data-testid="retention-confirm"]')).toBeVisible();
  let calls = await page.evaluate(
    () => window.__invoked.filter((c) => c.cmd === "set_settings").length,
  );
  expect(calls).toBe(0);

  // Cancel: nothing changes
  await page.locator('[data-testid="retention-confirm"] .btn', { hasText: "Cancel" }).click();
  await expect(page.locator('[data-testid="retention-confirm"]')).toHaveCount(0);
  await expect(select).toHaveValue("0");

  // Apply: set_settings fires with retentionDays = 5
  await select.selectOption("5");
  await page.locator('[data-testid="retention-apply"]').click();
  await expect(page.locator('[data-testid="retention-confirm"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = [...window.__invoked].reverse().find((x) => x.cmd === "set_settings");
        return c?.args?.newSettings?.retentionDays;
      }),
    )
    .toBe(5);
});

test("choosing Forever applies immediately without confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    window.__ipcState.settings.retentionDays = 10;
  });
  await openSettings(page);

  const select = page.locator('[data-testid="retention-select"]');
  await expect(select).toHaveValue("10");
  await select.selectOption("0");
  await expect(page.locator('[data-testid="retention-confirm"]')).toHaveCount(0);
  await expect(select).toHaveValue("0");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = [...window.__invoked].reverse().find((x) => x.cmd === "set_settings");
        return c?.args?.newSettings?.retentionDays;
      }),
    )
    .toBe(0);
});

test("custom days flow through the number input", async ({ page }) => {
  await openSettings(page);

  const select = page.locator('[data-testid="retention-select"]');
  await select.selectOption("custom");
  const num = page.locator('[data-testid="retention-custom"]');
  await expect(num).toBeVisible();
  await num.fill("45");
  await page.locator('[data-testid="retention-apply"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = [...window.__invoked].reverse().find((x) => x.cmd === "set_settings");
        return c?.args?.newSettings?.retentionDays;
      }),
    )
    .toBe(45);
});

test("a single search result fills the strip without being clipped", async ({ page }) => {
  await page.setViewportSize({ width: 1215, height: 838 });
  await page.evaluate(() => {
    window.__store.setState({
      clips: [
        {
          id: 7, kind: "text", text: "投机非日内开仓", html: null, imagePath: null,
          files: null, sourceName: "Chrome", sourcePath: "", sourceColor: "#cc4444",
          sourceIcon: "", pinboardId: null, createdAt: Date.now(), pasteCount: 0,
        },
      ],
      query: "投机",
    });
  });
  await page.waitForTimeout(150);
  const geo = await page.evaluate(() => {
    const strip = document.querySelector(".card-strip");
    const row = document.querySelector(".cards-row");
    const card = document.querySelector(".card");
    const buttons = [...(card?.querySelectorAll(".card-actions button") ?? [])];
    const rowRight = row?.getBoundingClientRect().right ?? 0;
    return {
      rowFillsStrip:
        Math.abs(row.clientWidth - strip.clientWidth) < 2,
      cardRightWithinRow: card ? card.getBoundingClientRect().right <= rowRight + 1 : false,
      allButtonsVisible: buttons.every(
        (b) => b.getBoundingClientRect().right <= rowRight + 1,
      ),
      buttonCount: buttons.length,
    };
  });
  expect(geo.rowFillsStrip).toBe(true);
  expect(geo.cardRightWithinRow).toBe(true);
  expect(geo.allButtonsVisible).toBe(true); // Delete button was cut before
  expect(geo.buttonCount).toBeGreaterThan(0);
});

test("regex mode plumbing: the query carries searchMode to the backend", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.evaluate(() => {
    const s = window.__store.getState().settings;
    window.__store.setState({ settings: { ...s, searchMode: "regex" } });
  });
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("alpha");
  await page.waitForTimeout(250);
  await expect(page.locator(".card")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = [...window.__invoked].reverse().find((x) => x.cmd === "list_clips");
        return c?.args?.searchMode;
      }),
    )
    .toBe("regex");
});

test("invalid regex hint shows without breaking the page", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.evaluate(() => {
    const s = window.__store.getState().settings;
    window.__store.setState({ settings: { ...s, searchMode: "regex" } });
  });
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("([invalid");
  await page.waitForTimeout(250);
  await expect(page.locator(".search-error")).toBeVisible(); // hint, not a crash
  await expect(page.locator(".card")).toHaveCount(0); // matches paused
});

test("wildcard mode plumbing reaches the backend query", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  await page.evaluate(() => {
    const s = window.__store.getState().settings;
    window.__store.setState({ settings: { ...s, searchMode: "wildcard" } });
  });
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("alpha");
  await page.waitForTimeout(250);
  await expect(page.locator(".card")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = [...window.__invoked].reverse().find((x) => x.cmd === "list_clips");
        return c?.args?.searchMode;
      }),
    )
    .toBe("wildcard");
});

test("search syntax setting persists in the settings page", async ({ page }) => {
  await openSettings(page);
  const select = page.locator('[data-testid="search-mode-select"]');
  await expect(select).toHaveValue("plain");
  await select.selectOption("wildcard");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = [...window.__invoked].reverse().find((x) => x.cmd === "set_settings");
        return c?.args?.newSettings?.searchMode;
      }),
    )
    .toBe("wildcard");
});

test("space in an EMPTY search box toggles the preview", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  const input = page.locator(".search-input");
  await input.click(); // focus the empty box
  await input.press("Space");
  await expect(page.locator(".detail-overlay")).toBeVisible(); // preview, not a space
  await expect(input).toHaveValue(""); // box untouched
  await input.press("Space");
  await expect(page.locator(".detail-overlay")).toHaveCount(0); // toggles back
});

test("space in a FILLED search box types a character", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("alpha");
  await input.press("Space");
  await expect(page.locator(".detail-overlay")).toHaveCount(0); // no preview hijack
  await expect(input).toHaveValue("alpha ");
});

test("escape in a filled search box clears it and returns to navigation", async ({ page }) => {
  await page.evaluate((clips) => window.__store.setState({ clips }), FIXTURE_CLIPS);
  const input = page.locator(".search-input");
  await input.click();
  await input.pressSequentially("alpha ");
  await input.press("Escape");
  await expect(input).toHaveValue(""); // query cleared
  await expect(input).not.toBeFocused(); // search mode exited

  // Back in navigation mode: space toggles the preview again
  await input.press("Space");
  await expect(page.locator(".detail-overlay")).toBeVisible();
  await expect(input).toHaveValue(""); // never typed into the box
});
