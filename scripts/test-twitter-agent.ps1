# test-twitter-agent.ps1
# Script para probar el Twitter Autonomous Agent

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$chromeDebugPort = 9222
$agentUrl = "http://localhost:8788"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Prueba de Twitter Autonomous Agent" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar Chrome con debugging
Write-Host "[1/5] Verificando Chrome con remote debugging..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:$chromeDebugPort/json/version" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    Write-Host "  [OK] Chrome está corriendo con debugging en puerto $chromeDebugPort" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Chrome no está corriendo con debugging" -ForegroundColor Red
    Write-Host "  Ejecuta: .\scripts\start-chrome-twitter.ps1" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# 2. Verificar servicio agent
Write-Host "[2/5] Verificando servicio agent..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$agentUrl/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        $health = $response.Content | ConvertFrom-Json
        if ($health.healthy) {
            Write-Host "  [OK] Servicio agent está corriendo y saludable" -ForegroundColor Green
            Write-Host "  [INFO] Mensaje: $($health.message)" -ForegroundColor Cyan
        } else {
            Write-Host "  [WARNING] Servicio agent responde pero no está saludable" -ForegroundColor Yellow
            Write-Host "  [INFO] Mensaje: $($health.message)" -ForegroundColor Cyan
        }
    }
} catch {
    Write-Host "  [ERROR] Servicio agent no está corriendo o no responde" -ForegroundColor Red
    Write-Host "  Inicia con: pm2 start ecosystem.config.cjs --only twitter-autonomous-agent" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# 3. Probar búsqueda simple
Write-Host "[3/5] Probando búsqueda de tweets..." -ForegroundColor Yellow
try {
    $testQuery = "AAPL stock"
    $body = @{
        query = $testQuery
        maxResults = 5
    } | ConvertTo-Json

    $response = Invoke-WebRequest -Uri "$agentUrl/twitter/search" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 60 -UseBasicParsing -ErrorAction Stop

    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        if ($data.success) {
            Write-Host "  [OK] Búsqueda exitosa" -ForegroundColor Green
            Write-Host "  [INFO] Tweets encontrados: $($data.count)" -ForegroundColor Cyan
            if ($data.tweets.Count -gt 0) {
                Write-Host "  [INFO] Primer tweet:" -ForegroundColor Cyan
                $firstTweet = $data.tweets[0]
                Write-Host "    Autor: $($firstTweet.author)" -ForegroundColor Gray
                Write-Host "    Texto: $($firstTweet.text.Substring(0, [Math]::Min(100, $firstTweet.text.Length)))..." -ForegroundColor Gray
            }
        } else {
            Write-Host "  [ERROR] Búsqueda falló: $($data.error)" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "  [ERROR] Error al buscar tweets: $_" -ForegroundColor Red
    Write-Host "  Verifica los logs del agente: pm2 logs twitter-autonomous-agent" -ForegroundColor Yellow
}
Write-Host ""

# 4. Probar breaking news
Write-Host "[4/5] Probando breaking news..." -ForegroundColor Yellow
try {
    $body = @{
        symbols = @("AAPL", "TSLA")
    } | ConvertTo-Json

    $response = Invoke-WebRequest -Uri "$agentUrl/twitter/breaking-news" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 60 -UseBasicParsing -ErrorAction Stop

    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        if ($data.success) {
            Write-Host "  [OK] Breaking news check exitoso" -ForegroundColor Green
            Write-Host "  [INFO] Noticias encontradas: $($data.count)" -ForegroundColor Cyan
            if ($data.news.Count -gt 0) {
                foreach ($news in $data.news) {
                    Write-Host "    [$($news.symbol)] $($news.headline.Substring(0, [Math]::Min(60, $news.headline.Length)))..." -ForegroundColor Gray
                }
            }
        } else {
            Write-Host "  [WARNING] No se encontraron noticias breaking" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "  [WARNING] Error al buscar breaking news: $_" -ForegroundColor Yellow
}
Write-Host ""

# 5. Resumen
Write-Host "[5/5] Resumen" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Estado del sistema:" -ForegroundColor White
Write-Host "  ✓ Chrome con debugging: OK" -ForegroundColor Green
Write-Host "  ✓ Servicio agent: OK" -ForegroundColor Green
Write-Host ""
Write-Host "Para ver logs en tiempo real:" -ForegroundColor Cyan
Write-Host "  pm2 logs twitter-autonomous-agent" -ForegroundColor Gray
Write-Host ""
Write-Host "Para reiniciar el servicio:" -ForegroundColor Cyan
Write-Host "  pm2 restart twitter-autonomous-agent" -ForegroundColor Gray
Write-Host ""
