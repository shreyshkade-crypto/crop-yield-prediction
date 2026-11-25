$ErrorActionPreference = "Stop"

$backend = Join-Path $PSScriptRoot "backend"
Set-Location $backend

$pythonInVenv = Join-Path $backend "venv\Scripts\python.exe"
if (-not (Test-Path $pythonInVenv)) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv venv
    } else {
        & python -m venv venv
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the virtual environment. Install Python 3 and try again."
    }
}

function Invoke-VenvPython {
    param([string[]]$Arguments)
    & $pythonInVenv @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed: $Arguments"
    }
}

Invoke-VenvPython @("-m", "pip", "install", "--upgrade", "pip")
Invoke-VenvPython @("-m", "pip", "install", "-r", "requirements.txt")

if (-not (Test-Path "data\crop_yield.csv")) {
    Invoke-VenvPython @("make_demo_data.py")
}
$modelReady = Test-Path "models\yield_model.joblib"
if ($modelReady) {
    & $pythonInVenv -c "import joblib; joblib.load('models/yield_model.joblib')"
    $modelReady = ($LASTEXITCODE -eq 0)
}
if (-not $modelReady) {
    Write-Host "The saved model is missing or incompatible; training it for this environment."
    Invoke-VenvPython @("train_model.py")
}

function Test-PortAvailable {
    param([int]$Port)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        $listener.Stop()
    }
}

function Test-KisanServer {
    param([int]$Port)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        return ($health.success -eq $true -and $health.data.status -eq "ok")
    } catch {
        return $false
    }
}

if ($env:FLASK_PORT) {
    $port = 0
    if (-not [int]::TryParse($env:FLASK_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "FLASK_PORT must be a valid port number."
    }
    if (-not (Test-PortAvailable $port)) {
        if (Test-KisanServer $port) {
            Write-Host "Kisan Saathi is already running at http://localhost:$port"
            Write-Host "Open that address in your browser. To restart it, stop the existing server with Ctrl+C first."
            return
        }
        throw "Port $port is already in use by another app. Set FLASK_PORT to a free port and run .\run.ps1 again."
    }
} elseif (Test-PortAvailable 5001) {
    $port = 5001
} elseif (Test-PortAvailable 5002) {
    $port = 5002
} else {
    foreach ($busyPort in @(5001, 5002)) {
        if (Test-KisanServer $busyPort) {
            Write-Host "Kisan Saathi is already running at http://localhost:$busyPort"
            Write-Host "Open that address in your browser. To restart it, stop the existing server with Ctrl+C first."
            return
        }
    }
    throw "Ports 5001 and 5002 are busy with other apps. Stop one or set FLASK_PORT to a free port."
}

$env:FLASK_PORT = "$port"
Write-Host ""
Write-Host "Website ready at http://localhost:$port"
Write-Host "Press Ctrl+C to stop the server."
Write-Host ""
Invoke-VenvPython @("app.py")
