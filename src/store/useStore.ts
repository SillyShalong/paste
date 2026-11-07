import { create } from "zustand";
import { moveSelection } from "../lib/navigation.mjs";
import { tFor } from "../i18n";
import { api } from "../lib/api";
import type { Clip, ClipKind, Pinboard, Settings, SourceInfo, View } from "../types";

interface StoreState {
  clips: Clip[];
  pinboards: Pinboard[];
  settings: Settings | null;
  sources: SourceInfo[];
  paused: boolean;
  view: View;
  query: string;
  kindFilter: ClipKind | "all";
  sel: number;
  sidebarOpen: boolean;
  toast: string | null;
  detailClipId: number | null;

  init: () => Promise<void>;
  refetch: () => Promise<void>;
  addClip: (clip: Clip) => void;
  setQuery: (q: string) => void;
  setKindFilter: (k: ClipKind | "all") => void;
  setView: (v: View) => void;
  setSel: (i: number) => void;
  moveSel: (delta: number) => number;
  toggleSidebar: () => void;
  openDetail: () => void;
  closeDetail: () => void;
  paste: (plain?: boolean) => Promise<void>;
  copyAgain: (id?: number) => Promise<void>;
  deleteClip: (id?: number) => Promise<void>;
  pinSelected: () => Promise<void>;
  clearHistory: () => Promise<void>;
  createPinboard: (name: string) => Promise<void>;
  renamePinboard: (id: number, name: string) => Promise<void>;
  deletePinboard: (id: number) => Promise<void>;
  refreshPinboards: () => Promise<void>;
  showToast: (msg: string) => void;
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<StoreState>((set, get) => ({
  clips: [],
  pinboards: [],
  settings: null,
  sources: [],
  paused: false,
  view: { type: "history" },
  query: "",
  kindFilter: "all",
  sel: 0,
  sidebarOpen: true,
  toast: null,
  detailClipId: null,

  init: async () => {
    const data = await api.getInitial();
    set({
      settings: data.settings,
      pinboards: data.pinboards,
      sources: data.sources,
      paused: data.paused,
    });
    await get().refetch();
  },

  refetch: async () => {
    const { view, query, kindFilter } = get();
    const pinboardId = view.type === "board" ? view.id : null;
    const clips = await api.listClips({
      pinboardId,
      search: query,
      kind: kindFilter === "all" ? null : kindFilter,
      limit: 100,
    });
    set({ clips, sel: 0 });
  },

  addClip: (clip) => {
    const { view, kindFilter, query } = get();
    if (query || kindFilter !== "all") {
      // Re-run the active query so newly captured items appear when they
      // match the current filter, including screenshots in the image view.
      void get().refetch();
      return;
    }
    const inView =
      view.type === "history" ? clip.pinboardId === null : clip.pinboardId === view.id;
    if (!inView) return;
    const clips = get().clips.filter((c) => c.id !== clip.id);
    set({ clips: [clip, ...clips], sel: 0 });
  },

  setQuery: (q) => {
    set({ query: q });
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => get().refetch(), 150);
  },

  setKindFilter: (k) => {
    set({ kindFilter: k });
    get().refetch();
  },

  setView: (v) => {
    set({ view: v, sel: 0 });
    get().refetch();
  },

  setSel: (i) => set({ sel: i }),

  moveSel: (delta) => {
    const n = get().clips.length;
    if (n === 0) return 0;
    const sel = moveSelection(get().sel, delta, n);
    set({ sel });
    return sel;
  },

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

  openDetail: () => {
    const clip = get().clips[get().sel];
    if (clip) set({ detailClipId: clip.id });
  },

  closeDetail: () => set({ detailClipId: null }),

  paste: async (plain = false) => {
    const { clips, sel } = get();
    const clip = clips[sel];
    if (!clip) return;
    await api.pasteClip(clip.id, plain);
  },

  copyAgain: async (id?: number) => {
    const { clips, sel } = get();
    const target = id ?? clips[sel]?.id;
    if (target == null) return;
    const ok = await api.copyClip(target);
    if (ok) get().showToast("Copied to clipboard");
  },

  deleteClip: async (id) => {
    const { clips, sel } = get();
    const target = id ?? clips[sel]?.id;
    if (target == null) return;
    await api.deleteClip(target);
    const rest = clips.filter((c) => c.id !== target);
    set({ clips: rest, sel: Math.min(sel, Math.max(0, rest.length - 1)) });
  },

  pinSelected: async () => {
    const { clips, sel, view, pinboards } = get();
    const clip = clips[sel];
    if (!clip) return;
    let targetId: number | null;
    if (view.type === "board") {
      targetId = clip.pinboardId === view.id ? null : view.id;
    } else {
      targetId = pinboards[0]?.id ?? null;
    }
    if (targetId == null) {
      get().showToast("Create a Pinboard first");
      return;
    }
    await api.setPinboard(clip.id, targetId);
    await get().refetch();
    const board = pinboards.find((p) => p.id === targetId);
    const t = tFor(get().settings?.language);
    get().showToast(
      board
        ? t(clip.pinboardId === targetId ? "Unpinned from {name}" : "Pinned to {name}").replace(
            "{name}",
            board.name,
          )
        : t("Done"),
    );
  },

  clearHistory: async () => {
    await api.clearHistory();
    await get().refetch();
    get().showToast("History cleared");
  },

  createPinboard: async (name) => {
    await api.createPinboard(name);
    await get().refreshPinboards();
  },

  renamePinboard: async (id, name) => {
    await api.renamePinboard(id, name);
    await get().refreshPinboards();
  },

  deletePinboard: async (id) => {
    await api.deletePinboard(id);
    const { view } = get();
    if (view.type === "board" && view.id === id) set({ view: { type: "history" } });
    await get().refreshPinboards();
    await get().refetch();
  },

  refreshPinboards: async () => {
    // Re-read pinboards via get_initial (cheap, local).
    const data = await api.getInitial();
    set({ pinboards: data.pinboards, sources: data.sources });
  },

  showToast: (msg) => {
    set({ toast: msg });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 1800);
  },
}));
