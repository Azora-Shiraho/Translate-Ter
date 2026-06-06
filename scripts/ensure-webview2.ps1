param(
  [string]$Version = "1.0.3967.48"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Deps = Join-Path $Root ".deps"
$Package = Join-Path $Deps "Microsoft.Web.WebView2.$Version.nupkg"
$Extracted = Join-Path $Deps "Microsoft.Web.WebView2.$Version"
$Header = Join-Path $Extracted "build\native\include\WebView2.h"

New-Item -ItemType Directory -Force -Path $Deps | Out-Null

if (-not (Test-Path -LiteralPath $Package)) {
  Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$Version" -OutFile $Package
}

if (-not (Test-Path -LiteralPath $Header)) {
  Remove-Item -LiteralPath $Extracted -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $Package -DestinationPath $Extracted -Force
}

Write-Host "WebView2 SDK ready at $Extracted"
