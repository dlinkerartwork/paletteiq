<# Build-machine helper. Downloads offline Microsoft installers; never runs them. #>
param([string]$Destination = (Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop\prerequisites'))
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$packages = @(
    @{ Name = 'vc_redist.x64.exe'; Url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'; MinimumBytes = 1000000 }
)
foreach ($package in $packages) {
    $target = Join-Path $Destination $package.Name
    if (-not (Test-Path -LiteralPath $target)) {
        $partial = "$target.download.exe"
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $package.Url -OutFile $partial
            $signature = Get-AuthenticodeSignature -LiteralPath $partial
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Invalid Microsoft signature: $($package.Name)" }
            if ((Get-Item -LiteralPath $partial).Length -lt $package.MinimumBytes) { throw "Installer is too small; an offline standalone installer is required: $($package.Name)" }
            Move-Item -LiteralPath $partial -Destination $target
        } finally { if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial } }
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation' -or (Get-Item -LiteralPath $target).Length -lt $package.MinimumBytes) { throw "Invalid offline prerequisite: $target" }
    Write-Host "Verified offline prerequisite: $target"
}
