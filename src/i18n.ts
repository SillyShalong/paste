// Minimal i18n: English source strings keyed by themselves, Chinese table.
// Resolution: settings.language === "system" -> navigator.language, else fixed.
import { useStore } from "./store/useStore";

export type Lang = "en" | "zh";

const zh: Record<string, string> = {
  // Panel — search / filters
  "Search clipboard history…": "搜索剪贴板历史…",
  All: "全部",
  Text: "文本",
  Links: "链接",
  Images: "图片",
  Files: "文件",
  Colors: "颜色",
  "Clear History": "清空历史",
  "Clear all clipboard history? Pinned items are kept.": "清空全部剪贴板历史？置顶项会保留。",
  Clear: "清空",
  Cancel: "取消",
  "Toggle sidebar (Ctrl+B)": "切换侧栏 (Ctrl+B)",
  "Toggle sidebar (Cmd+B)": "切换侧栏 (Cmd+B)",
  "Pause history": "暂停记录",
  "Resume history": "恢复记录",
  Settings: "设置",

  // Panel — paused banner / empty state
  "Clipboard history is paused — new copies are not being recorded.":
    "剪贴板历史已暂停 —— 新的复制内容不会被记录。",
  "Your clipboard history is empty": "剪贴板历史还是空的",
  "No matches found": "没有匹配的结果",
  "Copy something anywhere in Windows and it will show up here instantly.":
    "在 Windows 任意位置复制内容，它会立刻出现在这里。",
  "Copy something anywhere in macOS and it will show up here instantly.":
    "在 macOS 任意位置复制内容，它会立刻出现在这里。",

  // Panel — sidebar
  Pinboards: "收藏板",
  History: "历史",
  "+ New Pinboard": "+ 新建收藏板",
  "Pinboard name…": "收藏板名称…",
  "Delete pinboard": "删除收藏板",
  "Delete pinboard — clips return to history": "删除收藏板 —— 内容会回到历史",
  "Rename pinboard": "重命名收藏板",
  "Settings…": "设置…",

  // Panel — cards / actions / context menu
  Paste: "粘贴",
  Plain: "纯文本",
  Delete: "删除",
  "Paste as Plain Text": "以纯文本粘贴",
  "Paste (Enter)": "粘贴 (Enter)",
  "Paste as plain text (Ctrl+Enter)": "以纯文本粘贴 (Ctrl+Enter)",
  "Paste as plain text (Cmd+Enter)": "以纯文本粘贴 (Cmd+Enter)",
  "Delete (Del)": "删除 (Del)",
  "Pin to": "置顶到",
  "Copy Again": "再次复制",
  "Create a Pinboard first…": "请先创建收藏板…",
  Pinned: "已置顶",
  Unknown: "未知来源",

  // Panel — detail preview
  "Image unavailable": "图片不可用",
  "Empty file selection": "空文件选择",
  "Close (Esc)": "关闭 (Esc)",
  text: "文本",
  link: "链接",
  image: "图片",
  file: "文件",
  color: "颜色",

  // Panel — footer hints
  Navigate: "切换",
  "Full content": "完整内容",
  Scroll: "滚动",
  Browse: "浏览",
  Pin: "置顶",
  Filter: "筛选",
  Close: "关闭",

  // Toasts / messages
  "History cleared": "历史已清空",
  "Copied to clipboard": "已复制到剪贴板",
  "Create a Pinboard first": "请先创建一个 Pinboard",
  Done: "完成",
  "Pinned to {name}": "已置顶到 {name}",
  "Unpinned from {name}": "已从 {name} 取消置顶",

  // Settings — general
  "Paste Settings": "Paste 设置",
  General: "常规",
  "Launch at login": "开机自动启动",
  "Start Paste automatically when Windows starts": "Windows 启动时自动运行 Paste",
  "Pause clipboard history": "暂停剪贴板历史",
  "Temporarily stop recording new copies": "临时停止记录新的复制内容",
  "Paste as plain text by default": "默认以纯文本粘贴",
  "Strip formatting when pasting rich content": "粘贴富文本时去除格式",
  Appearance: "外观",
  "Panel theme": "面板主题",
  System: "跟随系统",
  Dark: "深色",
  Light: "浅色",
  "Panel position": "面板位置",
  "Vertical placement — always on the screen you're working on":
    "垂直位置 —— 始终出现在你正在工作的屏幕上",
  "Center of screen": "屏幕居中",
  "Top of screen": "屏幕顶部",
  "Bottom of screen": "屏幕底部",
  "Wheel direction": "滚轮方向",
  "Mouse wheel over the history cards": "历史卡片上的鼠标滚轮行为",
  "Down = browse older (scroll right)": "向下 = 浏览更早（向右滚动）",
  "Down = browse newer (scroll left)": "向下 = 浏览更新（向左滚动）",
  Language: "语言",
  "Follow the operating system language": "跟随操作系统语言",

  // Settings — tray icon
  "Tray icon": "托盘图标",

  // Settings — shortcuts
  Shortcuts: "快捷键",
  "Open Paste": "打开 Paste",
  "Global shortcut to show or hide the clipboard panel": "显示/隐藏剪贴板面板的全局快捷键",
  "Press keys…": "请按下快捷键…",
  "Quick paste shortcuts": "快速粘贴快捷键",
  "Ctrl+1…9 paste the most recent clips without opening the panel":
    "Ctrl+1…9 直接粘贴最近的剪贴内容，无需打开面板",
  "Cmd+1…9 paste the most recent clips without opening the panel":
    "Cmd+1…9 直接粘贴最近的剪贴内容，无需打开面板",

  // Settings — history
  "Keep at most": "最多保留",
  "Oldest unpinned clips are removed beyond this limit": "超出上限时最旧的未置顶内容会被移除",
  Unlimited: "无限制",
  "100 clips": "100 条",
  "500 clips": "500 条",
  "1000 clips": "1000 条",
  "5000 clips": "5000 条",
  "Clear all history? Pinned items are kept.": "清空全部历史？置顶项会保留。",
  Confirm: "确认",

  // Settings — excluded apps
  "Excluded Apps": "排除的应用",
  "Copies made inside these apps are never recorded": "在这些应用中的复制行为不会被记录",
  "Use the executable file name, e.g. 1password.exe": "填写可执行文件名，例如 1password.exe",
  "Use the app's executable name, e.g. 1password": "填写应用的可执行文件名，例如 1password",
  Add: "添加",

  // Settings — pinboards
  "Delete — clips return to history": "删除 —— 内容会回到历史",

  "Start Paste automatically when you log in": "登录时自动启动 Paste",
  "Press keys… (include a modifier)": "请按下快捷键…（需包含修饰键）",

  // Settings — about
  About: "关于",
  "Create pinboards from the panel sidebar.": "在面板侧栏创建收藏板。",
  "Data stays on this machine.": "数据仅保存在本机。",
  "Inspired by Paste for macOS.": "灵感来自 Paste for macOS。",
  Build: "构建类型",
  "Compiler profile this binary was built with": "此二进制文件的编译配置",
  "Built at": "构建时间",
  "Timestamp of this build": "本次构建的时间戳",
  Commit: "提交版本",
  "Source revision this build was produced from": "本次构建对应的源码版本",
  Platform: "系统平台",
  "Operating system and CPU architecture": "操作系统与 CPU 架构",

  // Onboarding
  "Welcome to Paste": "欢迎使用 Paste",
  "Everything you copy, saved locally and one keystroke away.":
    "你复制的一切都保存在本机，一次按键即可取回。",
  "Copying is captured automatically": "复制内容自动记录",
  "Text, links, images, files and colors — no action needed.":
    "文本、链接、图片、文件和颜色——无需任何操作。",
  "Allow pasting (Accessibility permission)": "允许粘贴（需要辅助功能权限）",
  "macOS needs permission before Paste can type into other apps. Open System Settings, find Paste in the list and switch it on.":
    "macOS 要求授权后 Paste 才能在其他应用中输入。打开系统设置，在列表中找到 Paste 并打开开关。",
  "macOS needs permission before Paste can type into other apps. Tap the button — Paste is added to the Accessibility list automatically; switch it on there.":
    "macOS 要求授权后 Paste 才能在其他应用中输入。点击下方按钮——Paste 会自动加入辅助功能列表，在那里打开开关即可。",
  "Open System Settings": "打开系统设置",
  "Request Accessibility Permission": "请求辅助功能授权",
  "Request permission": "请求授权",
  "Checking…": "检测中…",
  "Granted ✓": "已授权 ✓",
  "Not granted yet": "尚未授权",
  "Open the panel with Cmd+Shift+V": "用 Cmd+Shift+V 呼出面板",
  "Or click the Paste icon in the menu bar. Enter pastes, Space previews, Esc closes.":
    "也可以点击菜单栏的 Paste 图标。Enter 粘贴，Space 预览，Esc 关闭。",
  "Granted ✓ — start using Paste": "已授权 ✓ — 开始使用 Paste",
  "You're all set. Press Cmd+Shift+V anywhere and pick a card.":
    "一切就绪。在任何地方按 Cmd+Shift+V，选一张卡片即可粘贴。",
  Finish: "完成",
  "I'll do this later": "稍后再说",
};

export function resolveLang(pref: string | undefined): Lang {
  if (pref === "zh") return "zh";
  if (pref === "en") return "en";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function translateTo(lang: Lang, en: string): string {
  return lang === "zh" ? (zh[en] ?? en) : en;
}

/// Subscribe the component to the language (derived from settings) and return
/// a translate function bound to it, so switching language re-renders.
/// Non-hook variant for store actions (no reactivity needed there).
export function tFor(pref: string | undefined): (en: string) => string {
  return (en: string) => translateTo(resolveLang(pref), en);
}

export function useT(): (en: string) => string {
  const pref = useStore((s) => s.settings?.language ?? "system");
  const lang = resolveLang(pref);
  return (en: string) => translateTo(lang, en);
}
