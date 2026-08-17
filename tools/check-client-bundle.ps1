# tools/check-client-bundle.ps1
# 验证静态 web profile bundle 不会再次锁死 DSH 启动。
#
# 背景：DSH 网页运行时的 window.__ModuleLoader__.load 的 factory 只注入 require，
# 不注入 module / exports。bundle 里一旦出现对 module / exports 的引用，
# materialize 时抛 ReferenceError: module is not defined，
# 导致启动时整屏 "Failed to load plugins / failed to import loader entry (dsh-recall-unread)"，
# 用户直接进不了 DSH。这个脚本就是那道闸门：提交前拦住带病 bundle。
#
# 用法：pwsh -NoProfile -ExecutionPolicy Bypass -File tools/check-client-bundle.ps1
# 退出码：0 = 通过；1 = 不通过（禁止提交）。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$client = Join-Path $root 'plugin\client.js'
$hostJs = Join-Path $root 'plugin\host.js'
$script:fail = $false

function Fail([string]$msg) {
  Write-Host "FAIL: $msg" -ForegroundColor Red
  $script:fail = $true
}

# 1) 语法检查（坏语法会让脚本加载即失败 -> "bundle loaded without registering" -> 同样锁死启动）
$nodeAvailable = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
foreach ($f in @($client, $hostJs)) {
  if (-not (Test-Path $f)) { Fail "缺少文件: $f"; continue }
  if (-not $nodeAvailable) {
    Write-Host "WARN: 未找到 node，跳过语法检查 $f（module/exports 闸门仍生效）" -ForegroundColor Yellow
    continue
  }
  node --check $f 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "语法错误: $f" }
}

# 2) client bundle 禁止引用 module / exports（注释除外）
#    __ModuleLoader__ 里的大写 M 不会命中大小写敏感的 \bmodule\b。
$bad = Select-String -Path $client -Pattern '\bmodule\b|\bexports\b' -CaseSensitive | Where-Object {
  $t = $_.Line.TrimStart()
  -not ($t.StartsWith('*') -or $t.StartsWith('//') -or $t.StartsWith('/*') -or $t.StartsWith('*/'))
}
foreach ($b in $bad) {
  Fail ("$client 第 $($b.LineNumber) 行引用了 module/exports（factory 只注入 require，必须直接 return 导出）: $($b.Line.Trim())")
}

if ($script:fail) {
  Write-Host ''
  Write-Host 'check-client-bundle: 不通过 —— 该 bundle 会锁死 DSH 启动，已阻止提交。' -ForegroundColor Red
  Write-Host '修复：把 factory 改成直接 return { inject, apply }，不要使用 module / exports / module.exports。' -ForegroundColor Yellow
  exit 1
}

Write-Host 'check-client-bundle: OK' -ForegroundColor Green
exit 0
