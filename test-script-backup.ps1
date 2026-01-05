# 劇本備份與還原功能測試腳本
# 使用方式：請先取得 Admin Token，然後執行此腳本

# ========== 設定區 ==========
$API_URL = "http://localhost:8000"
$TOKEN = "YOUR_ADMIN_JWT_TOKEN_HERE"  # 請替換為真實的 Admin Token

# ========== 測試函數 ==========

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "劇本備份與還原功能測試" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 檢查 Token 是否已設定
if ($TOKEN -eq "YOUR_ADMIN_JWT_TOKEN_HERE") {
    Write-Host "⚠️  請先設定 Admin Token！" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "取得 Token 的方法：" -ForegroundColor White
    Write-Host "1. 使用瀏覽器登入 Admin 帳號" -ForegroundColor Gray
    Write-Host "2. 開啟開發者工具 (F12)" -ForegroundColor Gray
    Write-Host "3. 在 Console 執行：localStorage.getItem('token')" -ForegroundColor Gray
    Write-Host "4. 將取得的 Token 貼到此腳本的 `$TOKEN 變數中" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $TOKEN"
    "Content-Type" = "application/json"
}

# ========== 測試 1: 匯出劇本 ==========
Write-Host "【測試 1】匯出劇本..." -ForegroundColor Yellow

try {
    $exportResponse = Invoke-WebRequest `
        -Uri "$API_URL/api/admin/script/export" `
        -Headers $headers `
        -Method GET `
        -OutFile "script_backup_test.json"
    
    Write-Host "✅ 匯出成功！檔案已儲存至：script_backup_test.json" -ForegroundColor Green
    
    # 顯示檔案資訊
    $fileInfo = Get-Item "script_backup_test.json"
    Write-Host "   檔案大小：$($fileInfo.Length) bytes" -ForegroundColor Gray
    
    # 預覽前 3 筆資料
    $backupData = Get-Content "script_backup_test.json" | ConvertFrom-Json
    Write-Host "   總筆數：$($backupData.Count)" -ForegroundColor Gray
    Write-Host "   前 3 天預覽：" -ForegroundColor Gray
    $backupData | Select-Object -First 3 | Format-Table day, price, effectiveTrend
} catch {
    Write-Host "❌ 匯出失敗：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ========== 測試 2: 錯誤格式驗證 ==========
Write-Host "【測試 2】上傳錯誤格式（應被拒絕）..." -ForegroundColor Yellow

try {
    $badData = @{ "invalid" = "data" }
    $badJson = $badData | ConvertTo-Json
    
    Invoke-RestMethod `
        -Uri "$API_URL/api/admin/script/import" `
        -Headers $headers `
        -Method POST `
        -Body $badJson
    
    Write-Host "❌ 測試失敗：錯誤格式應該被拒絕！" -ForegroundColor Red
} catch {
    $errorMsg = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "✅ 正確拒絕：$($errorMsg.error)" -ForegroundColor Green
}

Write-Host ""

# ========== 測試 3: 匯入劇本（還原） ==========
Write-Host "【測試 3】還原劇本（使用剛才匯出的檔案）..." -ForegroundColor Yellow
Write-Host "⚠️  此操作將覆蓋資料庫中的劇本！" -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "確定要執行還原測試嗎？(輸入 YES 確認)"

if ($confirmation -ne "YES") {
    Write-Host "❌ 已取消測試" -ForegroundColor Red
    exit 0
}

try {
    $scriptData = Get-Content "script_backup_test.json" -Raw
    
    $importResponse = Invoke-RestMethod `
        -Uri "$API_URL/api/admin/script/import" `
        -Headers $headers `
        -Method POST `
        -Body $scriptData
    
    Write-Host "✅ 還原成功！" -ForegroundColor Green
    Write-Host "   訊息：$($importResponse.message)" -ForegroundColor Gray
    Write-Host "   筆數：$($importResponse.count)" -ForegroundColor Gray
} catch {
    Write-Host "❌ 還原失敗：$($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails) {
        $errorMsg = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host "   錯誤詳情：$($errorMsg.error)" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ 所有測試通過！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 提示：測試檔案 'script_backup_test.json' 已保留，可手動刪除" -ForegroundColor Gray
