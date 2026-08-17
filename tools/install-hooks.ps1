# tools/install-hooks.ps1
# 把 .githooks/pre-commit 安装到本仓库的 .git/hooks/，此后每次 git commit
# 都会自动校验 plugin/client.js 是否含有会锁死 DSH 启动的 module/exports 引用。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root '.githooks\pre-commit'
$gitDir = Join-Path $root '.git'
if (-not (Test-Path $gitDir)) { Write-Host '错误：这不是一个 git 仓库（找不到 .git）' -ForegroundColor Red; exit 1 }
$hooks = Join-Path $gitDir 'hooks'
New-Item -ItemType Directory -Force -Path $hooks | Out-Null
$dst = Join-Path $hooks 'pre-commit'
Copy-Item $src $dst -Force
Write-Host "已安装 pre-commit 钩子: $dst" -ForegroundColor Green
Write-Host '从此每次 git commit 都会自动校验 bundle，带病提交会被直接拒绝。' -ForegroundColor Cyan
