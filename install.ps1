[CmdletBinding()]
param(
    [ValidateSet('auto', 'hybrid', 'uia')][string]$Mode = 'auto',
    [switch]$Check
)

$ErrorActionPreference = 'Stop'

function Find-SunatNode {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { return $nodeCommand.Source }
    foreach ($nodeCandidate in @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) { if (Test-Path -LiteralPath $nodeCandidate -PathType Leaf) { return $nodeCandidate } }
    return $null
}

function Find-SunatBrave {
    foreach ($baseDirectory in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($baseDirectory) {
            $braveCandidate = Join-Path $baseDirectory 'BraveSoftware\Brave-Browser\Application\brave.exe'
            if (Test-Path -LiteralPath $braveCandidate -PathType Leaf) { return $braveCandidate }
        }
    }
    return $null
}

function Install-SunatPrerequisite([string]$PackageId) {
    if ($Check) { throw 'Falta un requisito. Ejecuta install.ps1 sin -Check para instalarlo.' }
    $packageManager = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $packageManager) { throw 'Windows no ofrece WinGet. Codex debe instalar Node.js o Brave desde su distribuidor oficial antes de continuar.' }
    Write-Host "Instalando requisito: $PackageId"
    $packageOutput = & $packageManager.Source install --id $PackageId --exact --source winget --silent --disable-interactivity --accept-package-agreements --accept-source-agreements 2>&1
    if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar $PackageId. Comprueba permisos de Windows y conexión; no se mostraron registros privados." }
}

try {
    $nodeExecutable = Find-SunatNode
    if ($nodeExecutable) {
        $nodeVersion = & $nodeExecutable --version
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar Node.js.' }
        if ($nodeVersion -notmatch '^v(\d+)\.') { throw 'Node.js devolvió una versión no reconocida.' }
        $nodeMajor = [int]$Matches[1]
    }
    if (-not $nodeExecutable -or [int]$nodeMajor -lt 20) {
        Install-SunatPrerequisite 'OpenJS.NodeJS.LTS'
        # Prefer the just-installed official runtime over a stale PATH entry.
        $installedNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        $nodeExecutable = if (Test-Path -LiteralPath $installedNode -PathType Leaf) { $installedNode } else { Find-SunatNode }
    }
    if (-not $nodeExecutable) { throw 'Node.js no quedó disponible después de instalarlo.' }
    # Refresh only this process: npm lifecycle commands must find a newly installed Node.
    $env:Path = (Split-Path -Parent $nodeExecutable) + [IO.Path]::PathSeparator + $env:Path
    if (-not (Find-SunatBrave)) {
        Install-SunatPrerequisite 'Brave.Brave'
        if (-not (Find-SunatBrave)) { throw 'Brave no quedó disponible después de instalarlo.' }
    }
    $setupArguments = @((Join-Path $PSScriptRoot 'scripts\setup.mjs'), '--mode', $Mode)
    if ($Check) { $setupArguments += '--check' }
    & $nodeExecutable @setupArguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not $Check) {
        Write-Host 'MCP y skill registrados. Codex debe recargar sus integraciones para activarlos en esta conversación.'
        Write-Host 'El instalador no abre Brave ni cambia su depuración. El login y las autorizaciones personales se realizan en el navegador.'
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
