param(
    [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Test-certificate trust is restricted to ephemeral GitHub-hosted runners.'
}
# Public certificate fingerprint read from the ZError [OSS] SignPath organization.
$expectedThumbprint = '518CDF31F6EE09F3B4994F7A4B03CA2E81153F6F'
$file = Get-Item -LiteralPath $Path
Write-Host "Inspecting Authenticode signature: $($file.Name)"
$signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
if ($null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Thumbprint -ne $expectedThumbprint) {
    throw "Unexpected or missing test-signing certificate: $Path"
}

# Trust only this pinned self-signed test certificate while checking the signature.
# CurrentUser\\Root can show an interactive confirmation dialog and hang CI.
# Use the elevated ephemeral runner's machine store and remove the trust afterwards.
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
$added = $false
try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    if ($store.Certificates.Find(
        [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
        $expectedThumbprint, $false
    ).Count -eq 0) {
        Write-Host 'Adding the pinned test certificate for this verification only.'
        $store.Add($signature.SignerCertificate)
        $added = $true
    }
    Write-Host 'Verifying signature integrity and certificate trust.'
    $verified = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($verified.Status -ne 'Valid') {
        throw "Invalid test signature on ${Path}: $($verified.Status) - $($verified.StatusMessage)"
    }
    Write-Host "Verified test signature: $($file.Name) [$expectedThumbprint]"
} finally {
    if ($added) { $store.Remove($signature.SignerCertificate) }
    $store.Close()
}
