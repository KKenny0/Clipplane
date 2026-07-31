#ifndef HostVersion
  #error HostVersion must be provided by the packaging script.
#endif
#ifndef BundleDir
  #error BundleDir must be provided by the packaging script.
#endif
#ifndef OutputDir
  #error OutputDir must be provided by the packaging script.
#endif
#ifndef OutputBaseName
  #error OutputBaseName must be provided by the packaging script.
#endif

[Setup]
AppId=ClipplaneHost
AppName=Clipplane Host
AppVersion={#HostVersion}
AppPublisher=Clipplane
DefaultDirName={localappdata}\Clipplane Host
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseName}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible and not arm64
ArchitecturesInstallIn64BitMode=x64compatible and not arm64
Compression=lzma2
SolidCompression=yes
UninstallDisplayName=Clipplane Host

#ifdef SignToolName
SignTool={#SignToolName}
SignedUninstaller=yes
#endif

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
function RunHostScript(const ScriptName, Arguments, Action: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\' + ScriptName) + '" ' + Arguments,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if not Result then begin
    MsgBox('Clipplane could not ' + Action + ': ' + SysErrorMessage(ResultCode), mbError, MB_OK);
    exit;
  end;
  if ResultCode <> 0 then begin
    MsgBox('Clipplane could not ' + Action + ' (exit code ' + IntToStr(ResultCode) + ').', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and
     (not RunHostScript('install-host.ps1', '-Browser all', 'register the local Host')) then begin
    RaiseException('Clipplane Host registration failed. Repair the installation before using Clipplane.');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usUninstall) and
     (not RunHostScript('uninstall-host.ps1', '-Browser all -HostRoot "' + ExpandConstant('{app}') + '"', 'remove the local Host')) then begin
    Abort;
  end;
end;
