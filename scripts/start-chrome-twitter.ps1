# start-chrome-twitter.ps1
# Script para iniciar Chrome con remote debugging habilitado para Twitter Agent
# Ejecutar este script ANTES de iniciar el servicio twitter-autonomous-agent

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$chromeDebugPort = 9222
$userDataDir = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data Twitter"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Iniciar Chrome para Twitter Agent" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Detectar ruta de Chrome
$chromePaths = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromePath = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromePath = $path
        break
    }
}

if (-not $chromePath) {
    Write-Host "[ERROR] Chrome no encontrado en las rutas estándar" -ForegroundColor Red
    Write-Host "  Por favor instala Google Chrome o especifica la ruta manualmente" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Chrome encontrado: $chromePath" -ForegroundColor Green

# Crear directorio de perfil si no existe
if (-not (Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
    Write-Host "[OK] Perfil creado: $userDataDir" -ForegroundColor Green
} else {
    Write-Host "[OK] Usando perfil existente: $userDataDir" -ForegroundColor Green
}

# Verificar si Chrome ya está corriendo con debugging
try {
    $response = Invoke-WebRequest -Uri "http://localhost:$chromeDebugPort/json/version" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    Write-Host "[INFO] Chrome ya está corriendo con remote debugging en puerto $chromeDebugPort" -ForegroundColor Yellow
    Write-Host "  Puedes continuar sin reiniciar Chrome" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Para verificar que funciona:" -ForegroundColor Cyan
    Write-Host "  1. Abre Chrome y ve a https://twitter.com" -ForegroundColor White
    Write-Host "  2. Inicia sesión en Twitter si no lo has hecho" -ForegroundColor White
    Write-Host "  3. El agente podrá usar tu sesión autenticada" -ForegroundColor White
    exit 0
} catch {
    # Chrome no está corriendo con debugging, continuar
}

Write-Host ""
Write-Host "[INFO] Iniciando Chrome con remote debugging..." -ForegroundColor Yellow
Write-Host "  Puerto: $chromeDebugPort" -ForegroundColor Gray
Write-Host "  Perfil: $userDataDir" -ForegroundColor Gray
Write-Host ""

# Iniciar Chrome con debugging
$chromeArgs = @(
    "--remote-debugging-port=$chromeDebugPort",
    "--user-data-dir=`"$userDataDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "https://twitter.com/home"
)

Write-Host "[INFO] Ejecutando: $chromePath" -ForegroundColor Gray
Write-Host "[INFO] Argumentos: $($chromeArgs -join ' ')" -ForegroundColor Gray
Write-Host ""

try {
    $process = Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -PassThru -ErrorAction Stop
    Write-Host "[OK] Chrome iniciado (PID: $($process.Id))" -ForegroundColor Green
    Write-Host ""
    
    # Esperar un momento para que Chrome inicie
    Start-Sleep -Seconds 3
} catch {
    Write-Host "[ERROR] No se pudo iniciar Chrome: $_" -ForegroundColor Red
    exit 1
}

# Esperar a que Chrome esté listo
Write-Host "[INFO] Esperando a que Chrome esté listo..." -ForegroundColor Yellow
$maxAttempts = 60  # Aumentado a 60 segundos
$attempt = 0
$ready = $false

while ($attempt -lt $maxAttempts -and -not $ready) {
    Start-Sleep -Seconds 1
    $attempt++
    
    # Mostrar progreso cada 5 segundos
    if ($attempt % 5 -eq 0) {
        Write-Host "  Intentando conectar... ($attempt/$maxAttempts segundos)" -ForegroundColor Gray
    }
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$chromeDebugPort/json/version" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $ready = $true
            Write-Host "  [OK] Conexión exitosa!" -ForegroundColor Green
        }
    } catch {
        # Continuar intentando
        $errorMessage = $_.Exception.Message
        if ($attempt % 10 -eq 0) {
            Write-Host "  [DEBUG] Error: $errorMessage" -ForegroundColor DarkGray
        }
    }
}

if ($ready) {
    Write-Host "[OK] Chrome está listo con remote debugging" -ForegroundColor Green
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Próximos pasos:" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Inicia sesión en Twitter si no lo has hecho" -ForegroundColor White
    Write-Host "2. Deja esta ventana de Chrome abierta" -ForegroundColor White
    Write-Host "3. Inicia el servicio twitter-autonomous-agent con PM2" -ForegroundColor White
    Write-Host ""
    Write-Host "Para iniciar el agente:" -ForegroundColor Cyan
    Write-Host "  pm2 start ecosystem.config.cjs --only twitter-autonomous-agent" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "[ERROR] Chrome no respondió después de $maxAttempts segundos" -ForegroundColor Red
    Write-Host ""
    Write-Host "Posibles causas:" -ForegroundColor Yellow
    Write-Host "  1. Chrome no se inició correctamente" -ForegroundColor White
    Write-Host "  2. El puerto $chromeDebugPort está siendo usado por otro proceso" -ForegroundColor White
    Write-Host "  3. Firewall o antivirus bloqueando la conexión" -ForegroundColor White
    Write-Host ""
    Write-Host "Para diagnosticar:" -ForegroundColor Cyan
    Write-Host "  - Verifica que Chrome está abierto" -ForegroundColor Gray
    Write-Host "  - Intenta abrir manualmente: http://localhost:$chromeDebugPort/json/version" -ForegroundColor Gray
    Write-Host "  - Verifica procesos: Get-Process chrome" -ForegroundColor Gray
    Write-Host "  - Verifica puerto: netstat -ano | findstr :$chromeDebugPort" -ForegroundColor Gray
    Write-Host ""
    exit 1
}
