param([Parameter(Mandatory = $true)][string]$Installer)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ZError'
$saved = Get-ItemProperty $registry
$expectedVersion = (Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json).version
$marker = Join-Path $env:RUNNER_TEMP 'zerror-old-uninstaller-called.txt'
$sentinel = Join-Path $env:LOCALAPPDATA 'com.zerror.app\upgrade-preserved.txt'
New-Item -ItemType Directory -Force (Split-Path $sentinel) | Out-Null
Set-Content $sentinel 'keep-user-data'
$installerPath = (Resolve-Path $Installer).Path

function Invoke-UpgradeWizard {
  $process = Start-Process -FilePath $installerPath -PassThru
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  $sawWindow = $false
  try {
    while ([DateTime]::UtcNow -lt $deadline) {
      $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770'))
      $window = $windows | Where-Object { $_.Current.Name -match 'ZError' } | Select-Object -First 1
      if (!$window) {
        $process.Refresh()
        if ($sawWindow -and $process.HasExited) {
          if ($process.ExitCode -ne 0) { throw "Upgrade failed: $($process.ExitCode)" }
          return
        }
        Start-Sleep -Milliseconds 250
        continue
      }
      $sawWindow = $true
      $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      # 必须走可见向导，静默安装不会验证用户遇到的卸载选择页面。
      if ($controls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::RadioButton }) {
        throw 'Upgrade unexpectedly displayed an uninstall/maintenance choice'
      }
      # 完成页不启动桌面软件，后续由独立的安装后测试负责启动。
      foreach ($control in $controls) {
        if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox -and $control.Current.IsEnabled) {
          $toggle = $control.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $toggle.Toggle() }
        }
      }
      $next = $controls | Where-Object {
        $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
        $_.Current.AutomationId -eq '1' -and $_.Current.IsEnabled
      } | Select-Object -First 1
      if ($next) { $next.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
      Start-Sleep -Milliseconds 350
    }
    throw 'Upgrade wizard timed out'
  } finally {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installerPath } |
      Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

try {
  # 用真实安装生成的注册表模拟旧版本与同版本修复，不替换当前用户的真实安装。
  foreach ($previousVersion in @('2.3.0', $expectedVersion)) {
    Set-ItemProperty $registry DisplayVersion $previousVersion
    $command = '"' + (Join-Path $PSHOME 'pwsh.exe') + '" -NoProfile -Command "Set-Content -LiteralPath ''' + $marker + ''' called; exit 9"'
    Set-ItemProperty $registry UninstallString $command
    Invoke-UpgradeWizard
    if (Test-Path $marker) { throw 'Upgrade invoked the old uninstaller' }
    if ((Get-Content $sentinel -Raw).Trim() -ne 'keep-user-data') { throw 'Upgrade removed user data' }
    $installed = Get-ItemProperty $registry
    if ($installed.DisplayVersion -ne $expectedVersion) { throw 'Upgrade did not update the registered version' }
    if ($installed.UninstallString -eq $command) { throw 'Upgrade did not restore its real uninstaller' }
    Write-Output "Verified visible upgrade from $previousVersion to $expectedVersion without uninstall"
  }
} catch {
  Set-ItemProperty $registry DisplayVersion $saved.DisplayVersion
  Set-ItemProperty $registry UninstallString $saved.UninstallString
  throw
} finally {
  Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
}
