param([int]$DelaySeconds = 8)

# Read-only: identify the native window under the pointer, without capturing
# clipboard contents, screen pixels, window titles, or executable paths.
$ErrorActionPreference = 'Stop'
if (-not ('WhiteStripProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WhiteStripProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder name, int length);
}
'@
}

[void][WhiteStripProbe]::SetProcessDPIAware()
Write-Host "In $DelaySeconds seconds: open Paste, put the pointer on the WHITE STRIP, and hold it still."
Start-Sleep -Seconds $DelaySeconds
$point = New-Object WhiteStripProbe+Point
if (-not [WhiteStripProbe]::GetCursorPos([ref]$point)) { throw 'Cannot read pointer position.' }
$hit = [WhiteStripProbe]::WindowFromPoint($point)
if ($hit -eq [IntPtr]::Zero) { throw 'No window found under the pointer.' }
$root = [WhiteStripProbe]::GetAncestor($hit, 2)
if ($root -eq [IntPtr]::Zero) { $root = $hit }

function Read-NativeWindow([IntPtr]$Handle) {
    [uint32]$ownerId = 0
    [void][WhiteStripProbe]::GetWindowThreadProcessId($Handle, [ref]$ownerId)
    $name = New-Object Text.StringBuilder 256
    [void][WhiteStripProbe]::GetClassName($Handle, $name, $name.Capacity)
    $rect = New-Object WhiteStripProbe+Rect
    $hasRect = [WhiteStripProbe]::GetWindowRect($Handle, [ref]$rect)
    $owner = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
    [ordered]@{
        class = $name.ToString()
        process = $(if ($owner) { $owner.ProcessName } else { 'unavailable' })
        processId = $ownerId
        hasRect = $hasRect
        bounds = @($rect.Left, $rect.Top, ($rect.Right-$rect.Left), ($rect.Bottom-$rect.Top))
    }
}

[ordered]@{
    point = @($point.X, $point.Y)
    hitWindow = Read-NativeWindow $hit
    rootWindow = Read-NativeWindow $root
} | ConvertTo-Json -Depth 4
