param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Dist = Join-Path $Root "dist\native"
$Build = Join-Path $Root "build\native"

Remove-Item -LiteralPath $Dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dist "app\frontend") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dist "app\backend") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dist "app\resources") | Out-Null

npm run build
& (Join-Path $PSScriptRoot "ensure-webview2.ps1")

$CMake = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
if (-not (Test-Path -LiteralPath $CMake)) {
  $CMake = "cmake"
}

& $CMake -S $Root -B $Build
& $CMake --build $Build --config $Configuration

Copy-Item -LiteralPath (Join-Path $Build "bin\TranslateTer.exe") -Destination (Join-Path $Dist "TranslateTer.exe") -Force
Copy-Item -LiteralPath (Join-Path $Build "bin\WebView2Loader.dll") -Destination (Join-Path $Dist "WebView2Loader.dll") -Force
Copy-Item -LiteralPath (Join-Path $Build "bin\translate-ter-backend.exe") -Destination (Join-Path $Dist "app\backend\translate-ter-backend.exe") -Force
Copy-Item -Path (Join-Path $Root "out\renderer\*") -Destination (Join-Path $Dist "app\frontend") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "resources\whisper-manifest.json") -Destination (Join-Path $Dist "app\resources\whisper-manifest.json") -Force

Write-Host "Native unzip-and-run package created at $Dist"
