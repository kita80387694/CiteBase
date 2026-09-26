param([int]$Port = 8080, [string]$DatabaseUrl = 'jdbc:postgresql://127.0.0.1:5432/citebase', [switch]$Mock)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (Test-Path '.env') {
    foreach ($line in Get-Content '.env') {
        if ($line -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"', "'"), 'Process') }
    }
}
if ($Mock) { $env:MODEL_MODE = 'mock' }
$env:DB_URL = $DatabaseUrl
$env:PORT = "$Port"
if (-not $env:DB_USER) { $env:DB_USER = 'citebase' }
$javaCommand = if (Test-Path '.tools/jdk-21.0.12.1+1/bin/java.exe') { Join-Path $root '.tools/jdk-21.0.12.1+1/bin/java.exe' } else { (Get-Command java).Source }
$jar = Join-Path $root 'backend/target/citebase-0.1.0.jar'
if (-not (Test-Path $jar)) { throw '先执行 mvn -f backend/pom.xml package' }
& $javaCommand -jar $jar
