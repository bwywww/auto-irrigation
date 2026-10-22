$ErrorActionPreference = 'Stop'
$taskNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $taskNpm) { throw 'Install Node.js 24 LTS, reopen PowerShell, then run this script again.' }
Push-Location (Join-Path $PSScriptRoot '..\web')
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    & $taskNpm.Source ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check network access and Node.js version.' }
  }
  Write-Host 'Open http://localhost:5173 in Windows Chrome or Edge. Ctrl+C stops the web server.'
  & $taskNpm.Source run dev
  if ($LASTEXITCODE -ne 0) { throw 'Web server could not start. Check whether port 5173 is already in use.' }
} finally { Pop-Location }
