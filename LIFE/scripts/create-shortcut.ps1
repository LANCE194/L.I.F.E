# Creates a "L.I.F.E." shortcut on the Desktop that starts everything with one double-click
# (installs if needed, builds if needed, starts the server and opens the browser).
# Run:  powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'L.I.F.E..lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $root 'run_life.bat'
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root 'dashboard\public\brand\life.ico') + ',0'
$shortcut.Description = 'L.I.F.E. - Localized Intelligent First-aid Evaluator'
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output "Shortcut created: $shortcutPath"
