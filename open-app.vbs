Set WshShell = CreateObject("WScript.Shell")
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")

url = "http://127.0.0.1:8091"
healthUrl = "http://127.0.0.1:8091/api/health"

isReady = False
On Error Resume Next
http.open "GET", healthUrl, False
http.setTimeouts 500, 500, 500, 1000
http.send
If Err.Number = 0 And http.status = 200 Then
    isReady = True
End If
On Error GoTo 0

If Not isReady Then
    ' Start the background Windows service silently if not already running
    WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command ""Start-Service AttendanceWeb -ErrorAction SilentlyContinue""", 0, True
    WScript.Sleep 1200
End If

' Open the web application directly in the user's default browser (zero terminal window)
WshShell.Run "rundll32 url.dll,FileProtocolHandler " & url
