# Test Avatar Update API

# Step 1: Register a test user
Write-Host "=== 1. Register Test User ===" -ForegroundColor Green
$registerResponse = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/register" `
    -Method Post `
    -ContentType "application/json" `
    -Body (@{
        username = "testuser_$(Get-Random)"
        password = "Test1234"
        displayName = "Test User"
    } | ConvertTo-Json)

Write-Host "Register Success: $($registerResponse.user.username)" -ForegroundColor Cyan

# Step 2: Login to get Token
Write-Host "`n=== 2. Login to Get Token ===" -ForegroundColor Green
$loginResponse = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body (@{
        username = $registerResponse.user.username
        password = "Test1234"
    } | ConvertTo-Json)

$token = $loginResponse.token
Write-Host "Login Success, Token: $($token.Substring(0, 20))..." -ForegroundColor Cyan

# Step 3: Get user info (should have default avatar)
Write-Host "`n=== 3. Get User Info ===" -ForegroundColor Green
$meResponse = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/me" `
    -Method Get `
    -Headers @{
        "Authorization" = "Bearer $token"
    }

Write-Host "Current Avatar: $($meResponse.user.avatar)" -ForegroundColor Cyan

# Step 4: Update avatar
Write-Host "`n=== 4. Update Avatar ===" -ForegroundColor Green
$updateResponse = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/avatar" `
    -Method Patch `
    -ContentType "application/json" `
    -Headers @{
        "Authorization" = "Bearer $token"
    } `
    -Body (@{
        avatar = "avatar_25.webp"
    } | ConvertTo-Json)

Write-Host "Update Success: $($updateResponse.message)" -ForegroundColor Cyan
Write-Host "New Avatar: $($updateResponse.user.avatar)" -ForegroundColor Cyan

# Step 5: Verify user info again
Write-Host "`n=== 5. Verify User Info Again ===" -ForegroundColor Green
$meResponse2 = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/me" `
    -Method Get `
    -Headers @{
        "Authorization" = "Bearer $token"
    }

Write-Host "Confirmed Avatar Updated: $($meResponse2.user.avatar)" -ForegroundColor Cyan

Write-Host "`n=== Test Complete ===" -ForegroundColor Green
