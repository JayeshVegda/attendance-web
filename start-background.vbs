Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Start PocketBase on port 8091 silently in the background
WshShell.Run """" & currentDir & "\pb\pocketbase.exe"" serve --http=127.0.0.1:8091 --dir=""" & currentDir & "\pb\pb_data""", 0, False

' 2. Start Vite dev server on port 5173 silently in the background
WshShell.Run "cmd.exe /c ""cd /d """ & currentDir & """ && pnpm dev --port 5173""", 0, False
