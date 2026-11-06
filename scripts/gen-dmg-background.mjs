// Generates src-tauri/dmg-background.png — the installer window background
// with visible install instructions (drag to Applications, the xattr
// first-run command, the Accessibility permission step).
//
// Rendered via headless Chromium so Chinese text uses real system fonts
// (PingFang SC) instead of librsvg's fontconfig, which may lack CJK glyphs.
//
// Usage: node scripts/gen-dmg-background.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 720, H = 460;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${W}px; height: ${H}px; overflow: hidden;
    background: linear-gradient(135deg, #23232b 0%, #1a1a20 60%, #171720 100%);
    font-family: "PingFang SC", "Hiragino Sans GB", sans-serif;
    color: #e8e8ee;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }
  .title { text-align: center; font-size: 26px; font-weight: 700; padding-top: 34px; }
  .subtitle { text-align: center; font-size: 13px; color: #9a9aa8; margin-top: 8px; }
  .step { display: flex; align-items: center; gap: 12px; margin: 0 56px; }
  .num {
    flex: none; width: 26px; height: 26px; border-radius: 13px;
    background: #7c5cf6; color: #fff; font-size: 14px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .step-text { font-size: 15px; }
  .step-sub { font-size: 12px; color: #9a9aa8; margin-top: 2px; }
  .dropzone { margin: 26px 56px 0; height: 128px; display: flex; align-items: center; justify-content: space-between; padding: 0 90px; }
  .arrow { font-size: 30px; color: #7c5cf6; font-weight: 700; }
  .codebox {
    margin: 18px 56px 0; padding: 9px 14px; border-radius: 8px;
    background: rgba(124, 92, 246, 0.12); border: 1px solid rgba(124, 92, 246, 0.35);
    font-family: "SF Mono", Menlo, monospace; font-size: 13.5px; color: #c9b8ff;
  }
  .divider { margin: 16px 56px 0; border-top: 1px solid rgba(255,255,255,0.08); }
  .footer { text-align: center; font-size: 11.5px; color: #77778a; margin-top: 12px; }
  kbd {
    padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.09);
    border: 1px solid rgba(255,255,255,0.15); font-size: 11px;
  }
</style></head><body>
  <div class="title">Paste 安装指南</div>
  <div class="subtitle">Install Guide · 三步完成，粘贴到任何应用</div>

  <div class="dropzone" style="margin-top: 30px; margin-bottom: 8px;">
    <span style="font-size: 14px; color: #9a9aa8;">Paste.app</span>
    <span class="arrow">⟶</span>
    <span style="font-size: 14px; color: #9a9aa8;">Applications</span>
  </div>

  <div class="step" style="margin-top: 4px;">
    <div class="num">1</div>
    <div>
      <div class="step-text">把上面的 <b>Paste</b> 拖到右侧的 <b>Applications</b> 文件夹</div>
      <div class="step-sub">Drag Paste onto the Applications folder</div>
    </div>
  </div>

  <div class="step">
    <div class="num">2</div>
    <div>
      <div class="step-text">若首次打开提示「已损坏」，在终端执行一次：</div>
      <div class="step-sub">If macOS says "damaged", run this once in Terminal:</div>
    </div>
  </div>
  <div class="codebox">xattr -cr /Applications/Paste.app</div>

  <div class="step">
    <div class="num">3</div>
    <div>
      <div class="step-text">允许粘贴功能：<b>系统设置 → 隐私与安全性 → 辅助功能</b> → 添加 Paste</div>
      <div class="step-sub">System Settings → Privacy &amp; Security → Accessibility → enable Paste</div>
    </div>
  </div>

  <div class="divider"></div>
  <div class="footer">呼出面板 <kbd>Cmd+Shift+V</kbd> &nbsp;·&nbsp; 顶部菜单栏图标 = 退出 / 设置 &nbsp;·&nbsp; 打开面板后按 <kbd>Space</kbd> 预览、<kbd>Enter</kbd> 粘贴</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html);
await page.waitForTimeout(300);
const out = join(root, "src-tauri", "dmg-background.png");
writeFileSync(out, await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
await browser.close();
console.log("wrote", out);
