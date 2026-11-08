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
  [System.IO.File]::WriteAllText((Join-Path $projectRoot '.dev.vars'), "STUDIO_CREDENTIAL_ENCRYPTION_KEY=$key`nPALETTEIQ_LOCAL_NO_AUTH=1`n")
  Write-Host 'Generated local encryption key in .dev.vars (do not commit).'
} else {
  Write-Host 'Keeping existing local .dev.vars encryption key.'
  $devVarsPath = Join-Path $projectRoot '.dev.vars'
  $devVarsText = [System.IO.File]::ReadAllText($devVarsPath)
  if ($devVarsText -notmatch '(?m)^PALETTEIQ_LOCAL_NO_AUTH=1\s*$') {
    [System.IO.File]::AppendAllText($devVarsPath, "`nPALETTEIQ_LOCAL_NO_AUTH=1`n")
    Write-Host 'Enabled login-free local development.'
  }
}

& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

$marker = Join-Path $projectRoot '.wrangler/local-migrations-complete'
$appliedPath = Join-Path $projectRoot '.wrangler/applied-migrations.txt'
New-Item -ItemType Directory -Path (Split-Path -Parent $appliedPath) -Force | Out-Null
$applied = @()
if (Test-Path $appliedPath) {
  $applied = @(Get-Content $appliedPath)
} elseif (Test-Path $marker) {
  # Earlier setup versions created a single marker after applying 0000 and 0001.
  $applied = @(Get-ChildItem 'drizzle' -Filter '*.sql' | Where-Object { $_.Name -match '^000[01]_' } | ForEach-Object Name)
  Set-Content -Path $appliedPath -Value $applied
}
$sqlFiles = Get-ChildItem -Path 'drizzle' -Filter '*.sql' | Sort-Object Name
$existingColumnForMigration = @{
  '0003_gemini_seo.sql' = 'gemini_credential'
  '0004_upscale_credential.sql' = 'upscale_credential'
}
foreach ($sqlFile in $sqlFiles) {
  if ($applied -contains $sqlFile.Name) { continue }
  # Some older PaletteIQ installations already contain these columns but
  # were created before the per-file migration marker existed. Check the
  # actual database schema before trying to ALTER TABLE again.
  $column = $existingColumnForMigration[$sqlFile.Name]
  if ($column) {
    $schemaOutput = & node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command 'PRAGMA table_info(studio_settings);' 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect studio_settings before $($sqlFile.Name): $schemaOutput" }
    if (($schemaOutput | Out-String) -match "(?m)\b$([regex]::Escape($column))\b") {
      Write-Host "Column $column already exists; recording $($sqlFile.Name) as applied."
      Add-Content -Path $appliedPath -Value $sqlFile.Name
      $applied += $sqlFile.Name
      continue
    }
  }
  Write-Host "Applying $($sqlFile.Name) ..."
  & node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file ("drizzle/" + $sqlFile.Name)
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($sqlFile.Name)" }
  Add-Content -Path $appliedPath -Value $sqlFile.Name
  $applied += $sqlFile.Name
}

Write-Host 'Local setup finished.'
Write-Host 'Run: npm run dev'
Write-Host 'Then open: http://localhost:5173/'
