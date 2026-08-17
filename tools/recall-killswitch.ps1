# tools/recall-killswitch.ps1
# 撤回插件「急救开关」：万一 dsh-recall-unread 再次出问题导致 DSH 启动卡在
# "Failed to load plugins"，用本脚本一键禁用该插件，重启 DSH 即可正常进入。
# 恢复时再启用（插件会重新随 DSH 加载）。
#
# 用法：
#   pwsh -NoProfile -ExecutionPolicy Bypass -File tools/recall-killswitch.ps1            # 禁用（默认）
#   pwsh -NoProfile -ExecutionPolicy Bypass -File tools/recall-killswitch.ps1 -Action enable
#
# 原理：在 ~/.dsh/profiles/web/cordis.patch.yml 的 recall-unread insert 条目上
# 加/删 `disabled: true`（loader 对 disabled 条目直接跳过，不再导入该插件）。
# 每次禁用前自动备份 patch 文件。
param(
  [ValidateSet('disable', 'enable')]
  [string]$Action = 'disable',
  [string]$PatchFile = (Join-Path $HOME '.dsh\profiles\web\cordis.patch.yml')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $PatchFile)) {
  Write-Host "错误：找不到 patch 文件 $PatchFile" -ForegroundColor Red
  exit 1
}

$lines = [System.Collections.Generic.List[string]]([System.IO.File]::ReadAllLines($PatchFile))

# 定位 recall-unread 条目
$idx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*-\s*id:\s*recall-unread\s*$') { $idx = $i; break }
}
if ($idx -lt 0) {
  Write-Host "未在 $PatchFile 中找到 recall-unread 条目（可能已被移除或改名）" -ForegroundColor Yellow
  exit 1
}
if ($idx + 1 -ge $lines.Count -or $lines[$idx + 1] -notmatch '^\s*name:\s*dsh-recall-unread\s*$') {
  Write-Host '错误：recall-unread 条目格式异常（id 后不是 name: dsh-recall-unread），请手动检查 patch 文件' -ForegroundColor Red
  exit 1
}

$disabledIdx = $idx + 2
$alreadyDisabled = ($disabledIdx -lt $lines.Count) -and ($lines[$disabledIdx] -match '^\s*disabled:\s*true\s*$')

if ($Action -eq 'disable') {
  if ($alreadyDisabled) {
    Write-Host '撤回插件当前已处于禁用状态，无需重复操作。' -ForegroundColor Yellow
  } else {
    # 备份
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$PatchFile.bak-killswitch-$stamp"
    Copy-Item $PatchFile $backup
    # 插入 disabled: true（缩进与 name 行一致）
    $null = $lines[$idx + 1] -match '^(\s*)'
    $pad = ' ' * $Matches[1].Length
    $lines.Insert($disabledIdx, "$pad`disabled: true")
    [System.IO.File]::WriteAllLines($PatchFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "已禁用撤回插件（recall-unread -> disabled: true）。" -ForegroundColor Green
    Write-Host "备份: $backup"
  }
  Write-Host ''
  Write-Host '请【重启 DSH】生效：重启后插件不再加载，GUI 可正常进入。' -ForegroundColor Cyan
  Write-Host '恢复方法：pwsh -NoProfile -ExecutionPolicy Bypass -File tools/recall-killswitch.ps1 -Action enable 后重启 DSH。' -ForegroundColor Cyan
} else {
  if (-not $alreadyDisabled) {
    Write-Host '撤回插件当前未被禁用，无需恢复。' -ForegroundColor Yellow
  } else {
    $lines.RemoveAt($disabledIdx)
    [System.IO.File]::WriteAllLines($PatchFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host '已恢复撤回插件（移除 disabled: true）。' -ForegroundColor Green
  }
  Write-Host ''
  Write-Host '请【重启 DSH】生效。' -ForegroundColor Cyan
}
