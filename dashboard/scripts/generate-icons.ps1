# generate-icons.ps1
# Script to generate PWA icons from the base SVG
# Requires ImageMagick or similar tool to convert SVG to PNG

$ProjectRoot = "C:\Users\azmunScripts\Documents\GitHub\MAHORAGA\dashboard"
$PublicDir = Join-Path $ProjectRoot "public"
$IconSvg = Join-Path $PublicDir "icon.svg"

if (-not (Test-Path $IconSvg)) {
    Write-Host "ERROR: icon.svg not found at $IconSvg" -ForegroundColor Red
    exit 1
}

# Check if ImageMagick is available
$magick = Get-Command magick -ErrorAction SilentlyContinue
if (-not $magick) {
    Write-Host "ImageMagick not found. Please install ImageMagick or use an online tool to convert:" -ForegroundColor Yellow
    Write-Host "  SVG: $IconSvg" -ForegroundColor White
    Write-Host "  Required sizes: 32, 72, 96, 128, 144, 152, 192, 384, 512" -ForegroundColor White
    Write-Host ""
    Write-Host "You can use: https://realfavicongenerator.net/ or similar tools" -ForegroundColor Cyan
    exit 0
}

Write-Host "Generating PWA icons from $IconSvg..." -ForegroundColor Green

$sizes = @(32, 72, 96, 128, 144, 152, 192, 384, 512)

foreach ($size in $sizes) {
    $outputPath = Join-Path $PublicDir "icon-$size.png"
    Write-Host "  Generating icon-$size.png..." -ForegroundColor Cyan
    & magick convert -background none -resize "${size}x${size}" $IconSvg $outputPath
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    ✓ Created $outputPath" -ForegroundColor Green
    } else {
        Write-Host "    ✗ Failed to create $outputPath" -ForegroundColor Red
    }
}

# Create maskable icon (same as 512 but with padding for safe zone)
$maskablePath = Join-Path $PublicDir "icon-maskable.png"
Write-Host "  Generating icon-maskable.png (with safe zone)..." -ForegroundColor Cyan
& magick convert -background none -resize "384x384" $IconSvg -gravity center -extent "512x512" $maskablePath
if ($LASTEXITCODE -eq 0) {
    Write-Host "    ✓ Created $maskablePath" -ForegroundColor Green
} else {
    Write-Host "    ✗ Failed to create $maskablePath" -ForegroundColor Red
}

Write-Host ""
Write-Host "Icon generation complete!" -ForegroundColor Green
Write-Host "All icons are in: $PublicDir" -ForegroundColor Cyan
