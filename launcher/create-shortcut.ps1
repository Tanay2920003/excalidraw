# Creates "Start Excalidraw.lnk" on the Desktop
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Start Excalidraw.lnk'))
$lnk.TargetPath      = 'C:\Windows\System32\cmd.exe'
$lnk.Arguments       = '/c "c:\Users\Tanay\Code\excalidraw\launcher\ExcalidrawLauncher.bat"'
$lnk.WorkingDirectory = 'c:\Users\Tanay\Code\excalidraw\launcher'
$lnk.WindowStyle     = 1
$lnk.Description     = 'Start Excalidraw Secure Session'
$lnk.Save()
Write-Host 'Desktop shortcut created: Start Excalidraw.lnk'
