' MonitorMail Desktop Shortcut Creator
' Run this once to create a shortcut on your desktop

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the path to this script's directory (MonitorMail root)
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strBatFile = objFSO.BuildPath(strScriptPath, "MonitorMail.bat")

' Check if the batch file exists
If Not objFSO.FileExists(strBatFile) Then
    MsgBox "Error: MonitorMail.bat not found at " & strBatFile, 16, "File Not Found"
    WScript.Quit 1
End If

' Get desktop path
strDesktop = objShell.SpecialFolders("Desktop")
strShortcutPath = objFSO.BuildPath(strDesktop, "MonitorMail.lnk")

' Create the shortcut
Set objShortcut = objShell.CreateShortcut(strShortcutPath)
objShortcut.TargetPath = strBatFile
objShortcut.WorkingDirectory = strScriptPath
objShortcut.Description = "Launch MonitorMail Application"
objShortcut.IconLocation = strBatFile & ", 0"
objShortcut.WindowStyle = 1  ' Normal window
objShortcut.Save

' Show success message
MsgBox "✓ Desktop shortcut created successfully!" & vbCrLf & vbCrLf & _
        "You can now double-click 'MonitorMail' on your desktop to run the application." & vbCrLf & vbCrLf & _
        "The shortcut was created at: " & strShortcutPath, 64, "Success"

' Alternative: Also create a shortcut in the MonitorMail folder
strFolderShortcut = objFSO.BuildPath(strScriptPath, "MonitorMail.lnk")
If Not objFSO.FileExists(strFolderShortcut) Then
    Set objShortcut2 = objShell.CreateShortcut(strFolderShortcut)
    objShortcut2.TargetPath = strBatFile
    objShortcut2.WorkingDirectory = strScriptPath
    objShortcut2.Description = "Launch MonitorMail Application"
    objShortcut2.Save
End If

WScript.Quit 0
