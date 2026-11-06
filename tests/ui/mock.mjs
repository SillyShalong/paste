// Tauri IPC mock injected before the app loads. The panel frontend runs its
// real store/components against this seam: the mock is STATEFUL (delete/pause/
// settings/pinboards mutate fixtures like the SQLite layer would), query
// semantics match list_clips, and every call is recorded on window.__invoked
// for wiring assertions. Events never fire.
export const FIXTURE_CLIPS = [
  {
    id: 1, kind: "text", text: "alpha note", html: null, imagePath: null, files: null,
    sourceName: "Notes", sourcePath: "", sourceColor: "#4f8ef7", sourceIcon: "",
    pinboardId: null, createdAt: 1700000000004, pasteCount: 0,
  },
  {
    id: 2, kind: "link", text: "https://example.com", html: null, imagePath: null, files: null,
    sourceName: "Notes", sourcePath: "", sourceColor: "#4f8ef7", sourceIcon: "",
    pinboardId: null, createdAt: 1700000000003, pasteCount: 0,
  },
  {
    id: 3, kind: "color", text: "#22c55e", html: null, imagePath: null, files: null,
    sourceName: "Picker", sourcePath: "", sourceColor: "#22c55e", sourceIcon: "",
    pinboardId: null, createdAt: 1700000000002, pasteCount: 0,
  },
  {
    id: 4, kind: "color", text: "#7c5cf6", html: null, imagePath: null, files: null,
    sourceName: "Picker", sourcePath: "", sourceColor: "#7c5cf6", sourceIcon: "",
    pinboardId: null, createdAt: 1700000000001, pasteCount: 0,
  },
];

const SETTINGS = {
  hotkey: "CmdOrCtrl+Shift+V", quickPaste: false, maxClips: 0,
  alwaysPlainText: false, excludedApps: [], paused: false, autostart: false,
  theme: "dark", panelPosition: "center", wheelDirection: "default",
  trayIcon: "classic", language: "en",
};

export const MOCK_SCRIPT = `
  window.__invoked = [];
  const state = {
    clips: ${JSON.stringify(FIXTURE_CLIPS)},
    paused: false,
    settings: ${JSON.stringify(SETTINGS)},
    pinboards: [],
  };
  window.__ipcState = state;
  window.__TAURI_INTERNALS__ = {
    invoke(cmd, args = {}) {
      window.__invoked.push({ cmd, args });
      switch (cmd) {
        case "get_initial":
          return Promise.resolve({
            settings: state.settings,
            pinboards: state.pinboards,
            clips: state.clips,
            sources: [],
            paused: state.paused,
          });
        case "list_clips": {
          let out = state.clips.filter((c) => c.pinboardId === (args.pinboardId ?? null));
          if (args.kind && args.kind !== "all") out = out.filter((c) => c.kind === args.kind);
          if (args.search) {
            const q = String(args.search).toLowerCase();
            out = out.filter((c) => (c.text || "").toLowerCase().includes(q));
          }
          return Promise.resolve(out);
        }
        case "delete_clip": {
          const before = state.clips.length;
          state.clips = state.clips.filter((c) => c.id !== args.id);
          return Promise.resolve(state.clips.length < before);
        }
        case "toggle_pause":
          state.paused = !state.paused;
          return Promise.resolve(state.paused);
        case "get_settings":
          return Promise.resolve(state.settings);
        case "set_settings":
          state.settings = { ...state.settings, ...args.newSettings };
          return Promise.resolve(null);
        case "create_pinboard": {
          const board = {
            id: state.pinboards.length + 1,
            name: String(args.name),
            position: state.pinboards.length,
            createdAt: Date.now(),
          };
          state.pinboards.push(board);
          return Promise.resolve(board);
        }
        case "plugin:event|listen":
        case "plugin:event|unlisten":
          return Promise.resolve(1);
        default:
          return Promise.resolve(null);
      }
    },
    transformCallback: (cb) => cb,
  };
`;
