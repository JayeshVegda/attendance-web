$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "Attendance & Salary.lnk"
$targetPath = "C:\Site_imp\attendance-web\Start-Attendance.bat"
$iconLocation = "C:\Site_imp\attendance-web\pb\app-icon.ico"
$workingDirectory = "C:\Site_imp\attendance-web"

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = "$iconLocation, 0"
$shortcut.Description = "Attendance & Salary Management System"
$shortcut.Save()

Write-Output "Created desktop shortcut at: $shortcutPath"
