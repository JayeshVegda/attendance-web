$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "Attendance & Salary.lnk"
$targetPath = "wscript.exe"
$arguments = "`"C:\Site_imp\attendance-web\open-app.vbs`""
$iconLocation = "C:\Site_imp\attendance-web\pb\app-icon.ico"
$workingDirectory = "C:\Site_imp\attendance-web"

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = "$iconLocation, 0"
$shortcut.Description = "Kapil Attendance & Salary (Hajri Pagar)"
$shortcut.Save()

Write-Output "Updated desktop shortcut at: $shortcutPath"
