# 模型切换脚本
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("doubao-seed-2.0-code", "doubao-seed-2.0-pro", "doubao-seed-2.0-lite", "doubao-seed-code", "minimax-m2.5", "glm-4.7", "deepseek-v3.2", "kimi-k2.5")]
    [string]$Model
)

$settingsPath = "$env:USERPROFILE\.claude\settings.json"

if (-not (Test-Path $settingsPath)) {
    Write-Host "配置文件不存在: $settingsPath" -ForegroundColor Red
    exit 1
}

$settings = Get-Content $settingsPath | ConvertFrom-Json

# 更新 model 字段
$settings.model = $Model

# 更新 env.ANTHROPIC_MODEL 字段
if ($settings.env) {
    $settings.env.ANTHROPIC_MODEL = $Model
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath

Write-Host "已切换到模型: $Model" -ForegroundColor Green
Write-Host "请重启 Claude Code 以使更改生效" -ForegroundColor Yellow
