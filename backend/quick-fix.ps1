# Quick Fix Script - Copy Data and Show Status
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host " Quick Fix: Copy Production Data" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Navigate to backend
Set-Location "c:\Users\mural\db\Sethu_Dashboard\backend"

# Run the copy
Write-Host "📋 Copying production data to test tables..." -ForegroundColor Yellow
Write-Host ""
node scripts/copy-to-test.js

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart frontend (Ctrl+C in npm start terminal, then npm start again)"
    Write-Host "  2. Refresh your browser (Ctrl+Shift+R)"
    Write-Host "  3. Data should now appear!"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Copy failed. See error above." -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible fixes:" -ForegroundColor Yellow
    Write-Host "  1. Make sure sync script ran at least once (creates test tables)"
    Write-Host "  2. Check database connection in .env file"
    Write-Host "  3. See FIX_NO_DATA.md for detailed troubleshooting"
    Write-Host ""
}

Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
