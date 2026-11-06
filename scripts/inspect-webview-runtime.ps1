# Read-only runtime information; never print full command lines or file paths.
$ErrorActionPreference = 'Stop'
function Get-BinaryVersion([int]$ProcessId) {
    try { (Get-Process -Id $ProcessId -ErrorAction Stop).MainModule.FileVersionInfo.ProductVersion }
    catch { 'unavailable' }
}
$apps = @(Get-Process -Name paste -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ processId = $_.Id; version = Get-BinaryVersion $_.Id }
})
$browsers = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | ForEach-Object {
    $arguments = [string]$_.CommandLine
    [ordered]@{
        processId = $_.ProcessId
        parentProcessId = $_.ParentProcessId
        version = Get-BinaryVersion $_.ProcessId
        commandLineReadable = -not [string]::IsNullOrEmpty($arguments)
        browserProcess = $arguments -notmatch '--type='
        gpuDisabled = $arguments -match '(?:^|\s)--disable-gpu(?:\s|$)'
        occlusionDisabled = $arguments -match '--disable-features=[^\s]*CalculateNativeWinOcclusion'
    }
})
[ordered]@{
    windows = [Environment]::OSVersion.Version.ToString()
    paste = $apps
    webview = $browsers
} | ConvertTo-Json -Depth 5
