param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Builder = Join-Path $Root "node_modules\electron-builder\cli.js"
$Dist = Join-Path $Root "dist"
$WinUnpacked = Join-Path $Dist "win-unpacked"
$CMake = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
if (-not (Test-Path -LiteralPath $CMake)) {
  $CMake = "cmake"
}

Push-Location $Root
try {
  npm run build
  & $CMake -S $Root -B (Join-Path $Root "build\native")
  & $CMake --build (Join-Path $Root "build\native") --config $Configuration

  if (-not (Test-Path -LiteralPath $Builder)) {
    throw "electron-builder is not installed. Run npm install first."
  }

  if (Test-Path -LiteralPath $WinUnpacked) {
    Remove-Item -LiteralPath $WinUnpacked -Recurse -Force
  }

  node $Builder --dir --win --x64 --publish never

  $Package = Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json
  $ZipName = "Translate-Ter-v$($Package.version)-windows-x64-electron.zip"
  $ZipPath = Join-Path $Dist $ZipName
  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -Path (Join-Path $WinUnpacked "*") -DestinationPath $ZipPath
  Write-Host "Electron zip package created at $ZipPath"
} finally {
  Pop-Location
}
