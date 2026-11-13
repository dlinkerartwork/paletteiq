# The packaging pipeline invokes this as a file (not an inline -Command string)
# so the Windows PowerShell parsing is identical locally and on CI.
$ErrorActionPreference = 'Stop'
$target = $env:PALETTEIQ_BUILD_VC_REDIST
if ([string]::IsNullOrWhiteSpace($target) -or -not (Test-Path -LiteralPath $target)) {
    throw 'Microsoft VC++ prerequisite is missing'
}
$signature = Get-AuthenticodeSignature -LiteralPath $target
if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "Microsoft VC++ prerequisite signature validation failed: $($signature.Status)"
}
if ((Get-Item -LiteralPath $target).Length -lt 1000000) {
    throw 'Microsoft VC++ prerequisite installer is incomplete'
}
Write-Host 'Verified signed Microsoft Visual C++ prerequisite'
