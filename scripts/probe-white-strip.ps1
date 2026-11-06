param([int]$DelaySeconds = 8, [string]$ProcessName = 'paste')

# Read-only: identify the native window under the pointer, without capturing
# clipboard contents, screen pixels, window titles, or executable paths.
$ErrorActionPreference = 'Stop'
if (-not ('WhiteStripProbeV3' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WhiteStripProbeV3 {
    public delegate bool EnumCallback(IntPtr h, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr data);
    public static IntPtr FindProcessWindow(uint process) {
        IntPtr best = IntPtr.Zero;
        long largest = -1;
        EnumWindows((h, data) => {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            Rect rect;
            if (owner == process && IsWindowVisible(h) && GetWindowRect(h, out rect)) {
                long area = (long)(rect.Right-rect.Left) * (rect.Bottom-rect.Top);
                if (area > largest) { best = h; largest = area; }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder name, int length);
}
'@
}

[void][WhiteStripProbeV3]::SetProcessDPIAware()
Write-Host "In $DelaySeconds seconds: open Paste, reproduce the white strip and leave the panel open. Footer sampling is automatic."
Start-Sleep -Seconds $DelaySeconds
$point = New-Object WhiteStripProbeV3+Point
if (-not [WhiteStripProbeV3]::GetCursorPos([ref]$point)) { throw 'Cannot read pointer position.' }
$hit = [WhiteStripProbeV3]::WindowFromPoint($point)
if ($hit -eq [IntPtr]::Zero) { throw 'No window found under the pointer.' }
$root = [WhiteStripProbeV3]::GetAncestor($hit, 2)
if ($root -eq [IntPtr]::Zero) { $root = $hit }

function Read-NativeWindow([IntPtr]$Handle) {
    [uint32]$ownerId = 0
    [void][WhiteStripProbeV3]::GetWindowThreadProcessId($Handle, [ref]$ownerId)
    $name = New-Object Text.StringBuilder 256
    [void][WhiteStripProbeV3]::GetClassName($Handle, $name, $name.Capacity)
    $rect = New-Object WhiteStripProbeV3+Rect
    $hasRect = [WhiteStripProbeV3]::GetWindowRect($Handle, [ref]$rect)
    $owner = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
    [ordered]@{
        class = $name.ToString()
        process = $(if ($owner) { $owner.ProcessName } else { 'unavailable' })
        processId = $ownerId
        style = ('0x{0:X8}' -f [WhiteStripProbeV3]::GetWindowLong($Handle, -16))
        extendedStyle = ('0x{0:X8}' -f [WhiteStripProbeV3]::GetWindowLong($Handle, -20))
        hasRect = $hasRect
        bounds = @($rect.Left, $rect.Top, ($rect.Right-$rect.Left), ($rect.Bottom-$rect.Top))
    }
}

function Read-Point([int]$X, [int]$Y) {
    $p = New-Object WhiteStripProbeV3+Point
    $p.X = $X
    $p.Y = $Y
    $h = [WhiteStripProbeV3]::WindowFromPoint($p)
    if ($h -eq [IntPtr]::Zero) { return $null }
    $r = [WhiteStripProbeV3]::GetAncestor($h, 2)
    if ($r -eq [IntPtr]::Zero) { $r = $h }
    [ordered]@{ point = @($X,$Y); hitWindow = Read-NativeWindow $h; rootWindow = Read-NativeWindow $r }
}

$panelHandle = [IntPtr]::Zero
foreach ($appProcess in @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)) {
    $candidate = [WhiteStripProbeV3]::FindProcessWindow([uint32]$appProcess.Id)
    if ($candidate -ne [IntPtr]::Zero) { $panelHandle = $candidate; break }
}
$panelInfo = $null
$footer = $null
$cards = $null
$bottom = $null
if ($panelHandle -ne [IntPtr]::Zero) {
    $details = Read-NativeWindow $panelHandle
    $visible = [WhiteStripProbeV3]::IsWindowVisible($panelHandle)
    $dpi = [WhiteStripProbeV3]::GetDpiForWindow($panelHandle)
    $panelInfo = [ordered]@{ window = $details; visible = $visible; dpi = $dpi }
    if ($visible) {
        $b = $details.bounds
        $center = [int]($b[0] + $b[2] / 2)
        $footerY = [int]($b[1] + $b[3] - [Math]::Round(18 * $dpi / 96))
        $footer = Read-Point $center $footerY
        $cards = Read-Point $center ([int]($footerY - [Math]::Round(80 * $dpi / 96)))
        $bottom = Read-Point $center ([int]($b[1] + $b[3] - 2))
    }
}
[ordered]@{
    pointer = Read-Point $point.X $point.Y
    panel = $panelInfo
    footer = $footer
    cards = $cards
    bottom = $bottom
} | ConvertTo-Json -Depth 8
