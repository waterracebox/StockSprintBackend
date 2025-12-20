# Admin API 測試腳本
# 使用方式: .\test-admin-api.ps1

$BASE_URL = "http://localhost:8000"

Write-Host "=== Admin API 測試腳本 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 登入取得 Token（需要先有 Admin 帳號）
Write-Host "[Step 1] 請先登入 Admin 帳號..." -ForegroundColor Yellow
Write-Host "請輸入 Admin 使用者名稱: " -NoNewline
$username = Read-Host
Write-Host "請輸入密碼: " -NoNewline
$password = Read-Host -AsSecureString
$passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

$loginBody = @{
    username = $username
    password = $passwordPlain
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/auth/login" `
        -ContentType "application/json" `
        -Body $loginBody

    $token = $loginResponse.token
    Write-Host "✓ 登入成功！Token: $($token.Substring(0, 20))..." -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "✗ 登入失敗: $_" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# 2. 測試取得遊戲參數
Write-Host "[Step 2] 測試取得遊戲參數..." -ForegroundColor Yellow
try {
    $params = Invoke-RestMethod -Method GET -Uri "$BASE_URL/api/admin/params" `
        -Headers @{ "Authorization" = "Bearer $token" }
    Write-Host "✓ 取得參數成功:" -ForegroundColor Green
    $params | ConvertTo-Json
    Write-Host ""
} catch {
    Write-Host "✗ 取得參數失敗: $_" -ForegroundColor Red
}

# 3. 測試開始遊戲
Write-Host "[Step 3] 測試開始遊戲..." -ForegroundColor Yellow
try {
    $startResponse = Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/admin/game/start" `
        -Headers @{ "Authorization" = "Bearer $token" }
    Write-Host "✓ 開始遊戲成功: $($startResponse.message)" -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Seconds 2
} catch {
    Write-Host "⚠ 開始遊戲: $_" -ForegroundColor Yellow
    Write-Host ""
}

# 4. 測試停止遊戲
Write-Host "[Step 4] 測試停止遊戲..." -ForegroundColor Yellow
try {
    $stopResponse = Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/admin/game/stop" `
        -Headers @{ "Authorization" = "Bearer $token" }
    Write-Host "✓ 停止遊戲成功: $($stopResponse.message)" -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Seconds 2
} catch {
    Write-Host "⚠ 停止遊戲: $_" -ForegroundColor Yellow
    Write-Host ""
}

# 5. 測試恢復遊戲
Write-Host "[Step 5] 測試恢復遊戲..." -ForegroundColor Yellow
try {
    $resumeResponse = Invoke-RestMethod -Method POST -Uri "$BASE_URL/api/admin/game/resume" `
        -Headers @{ "Authorization" = "Bearer $token" }
    Write-Host "✓ 恢復遊戲成功: $($resumeResponse.message)" -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Seconds 2
} catch {
    Write-Host "⚠ 恢復遊戲: $_" -ForegroundColor Yellow
    Write-Host ""
}

# 6. 測試更新參數
Write-Host "[Step 6] 測試更新參數（修改 timeRatio 為 30）..." -ForegroundColor Yellow
$updateBody = @{
    timeRatio = 30
    maxLeverage = 5
} | ConvertTo-Json

try {
    $updateResponse = Invoke-RestMethod -Method PUT -Uri "$BASE_URL/api/admin/params" `
        -Headers $headers `
        -Body $updateBody
    Write-Host "✓ 更新參數成功: $($updateResponse.message)" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "✗ 更新參數失敗: $_" -ForegroundColor Red
    Write-Host ""
}

# 7. 再次取得參數確認
Write-Host "[Step 7] 確認參數是否更新..." -ForegroundColor Yellow
try {
    $paramsAfter = Invoke-RestMethod -Method GET -Uri "$BASE_URL/api/admin/params" `
        -Headers @{ "Authorization" = "Bearer $token" }
    Write-Host "✓ 更新後的參數:" -ForegroundColor Green
    $paramsAfter | ConvertTo-Json
    Write-Host ""
} catch {
    Write-Host "✗ 取得參數失敗: $_" -ForegroundColor Red
}

Write-Host "=== 測試完成 ===" -ForegroundColor Cyan
