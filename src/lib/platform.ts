/// Platform detection for UI labels and shortcuts.
export const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/// The label for the primary modifier: ⌘ Cmd on macOS, Ctrl elsewhere.
export const modLabel = isMac ? "Cmd" : "Ctrl";

/// Human-readable OS name for user-facing copy.
export const osName = isMac ? "macOS" : "Windows";
