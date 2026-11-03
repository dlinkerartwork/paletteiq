param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$nodeVersion = (& node --version)
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.13+ is required.' }
$major = [int](($nodeVersion -replace '^v', '').Split('.')[0])
if ($major -lt 22) { throw 'Please install Node.js 22.13 or newer.' }

if (-not $SkipInstall) {
  & npm run install:ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}

if (-not (Test-Path '.dev.vars')) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $key = [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  [System.IO.File]::WriteAllText((Join-Path $projectRoot '.dev.vars'), "STUDIO_CREDENTIAL_ENCRYPTION_KEY=$key`n")
  Write-Host 'Generated local encryption key in .dev.vars (do not commit).'
} else {
  Write-Host 'Keeping existing local .dev.vars encryption key.'
}

& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

$marker = Join-Path $projectRoot '.wrangler/local-migrations-complete'
if (-not (Test-Path $marker)) {
  $sqlFiles = Get-ChildItem -Path 'drizzle' -Filter '*.sql' | Sort-Object Name
  foreach ($sqlFile in $sqlFiles) {
    Write-Host "Applying $($sqlFile.Name) ..."
    & node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file ("drizzle/" + $sqlFile.Name)
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($sqlFile.Name)" }
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $marker) -Force | Out-Null
  [System.IO.File]::WriteAllText($marker, (Get-Date).ToUniversalTime().ToString('o'))
}

Write-Host 'Local setup finished.'
Write-Host 'Run: npm run dev'
Write-Host 'Then open: http://localhost:5173/signin-with-chatgpt?return_to=/'
