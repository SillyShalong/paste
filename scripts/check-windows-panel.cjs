// Runs against a debug Tauri executable with WebView2 remote debugging enabled.
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH);
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const output = path.resolve('ui-results');
fs.mkdirSync(output, { recursive: true });
const native = (body) => execFileSync('powershell.exe', ['-NoProfile', '-Command', `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PanelProbe {
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c,string t);
 public struct Rect { public int Left,Top,Right,Bottom; }
}'
$h=[PanelProbe]::FindWindow($null,'Paste')
$r=New-Object PanelProbe+Rect
[void][PanelProbe]::GetWindowRect($h,[ref]$r)
${body}`], { encoding: 'utf8' }).trim();

(async () => {
  let browser;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  if (!browser) throw new Error('WebView2 debugging endpoint did not start');
  const context = browser.contexts()[0];
  let page;
  for (let attempt = 0; attempt < 60; attempt++) {
    page = context.pages().find(p => !p.url().startsWith('about:'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!page) throw new Error('Panel page did not load');
  await page.waitForSelector('.panel-footer');
  await page.waitForTimeout(1000);
  const measurements = [];
  async function capture(label) {
    const dom = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY },
      elements: Object.fromEntries(['html', 'body', '#root', '.panel', '.panel-footer', '.cards-row'].map(selector => {
        const el = document.querySelector(selector);
        if (!el) return [selector, null];
        const r = el.getBoundingClientRect();
        return [selector, { x:r.x, y:r.y, width:r.width, height:r.height, background:getComputedStyle(el).backgroundColor }];
      }))
    }));
    measurements.push({ label, dom, native: native('$c=New-Object PanelProbe+Rect; [void][PanelProbe]::GetClientRect($h,[ref]$c); @{window=$r;client=$c}|ConvertTo-Json -Compress') });
    await page.screenshot({ path: path.join(output, label + '-webview.png') });
    native(`$b=New-Object Drawing.Bitmap ($r.Right-$r.Left),($r.Bottom-$r.Top); $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size); $b.Save('${path.join(output,label+'-desktop.png').replaceAll("'", "''")}'); $g.Dispose(); $b.Dispose()`);
    fs.writeFileSync(path.join(output, 'bounds.json'), JSON.stringify(measurements, null, 2));
    if (dom.elements['.panel-footer'].y + dom.elements['.panel-footer'].height > dom.viewport.height + 1) throw new Error('Footer outside viewport');
  }
  await capture('open');
  const footer = await page.locator('.panel-footer').boundingBox();
  const dpr = await page.evaluate(() => devicePixelRatio);
  native(`[void][PanelProbe]::SetCursorPos($r.Left+${Math.round((footer.x+footer.width/2)*dpr)},$r.Top+${Math.round((footer.y+footer.height/2)*dpr)})`);
  await page.waitForTimeout(300);
  await capture('footer-hover');
  native(`[void][PanelProbe]::SetCursorPos($r.Left+400,$r.Top+150)`);
  await page.waitForTimeout(300);
  await capture('moved-up');
  native(`[void][PanelProbe]::SetCursorPos(0,0)`);
  await page.waitForTimeout(300);
  await capture('moved-out');
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
