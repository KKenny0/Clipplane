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
const
  ChromeRegistrationKey = 'Software\Google\Chrome\NativeMessagingHosts\com.clipplane.host';
  EdgeRegistrationKey = 'Software\Microsoft\Edge\NativeMessagingHosts\com.clipplane.host';

function RunPowerShellScript(const ScriptPath, WorkingDirectory, Arguments, Action: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ScriptPath + '" ' + Arguments,
    WorkingDirectory, SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if not Result then begin
    MsgBox('Clipplane could not ' + Action + ': ' + SysErrorMessage(ResultCode), mbError, MB_OK);
    exit;
  end;
  if ResultCode <> 0 then begin
    MsgBox('Clipplane could not ' + Action + ' (exit code ' + IntToStr(ResultCode) + ').', mbError, MB_OK);
    Result := False;
  end;
end;

function RunHostScript(const ScriptName, Arguments, Action: String): Boolean;
begin
  Result := RunPowerShellScript(
    ExpandConstant('{app}\' + ScriptName),
    ExpandConstant('{app}'), Arguments, Action);
end;

function CheckRegistrationWriteAccess(const Browser, SubkeyName: String): String;
var
  ExistingValue: String;
  KeyExisted: Boolean;
  ValueExisted: Boolean;
begin
  Result := '';
  KeyExisted := RegKeyExists(HKEY_CURRENT_USER, SubkeyName);
  ValueExisted := RegValueExists(HKEY_CURRENT_USER, SubkeyName, '');
  if ValueExisted and
     (not RegQueryStringValue(HKEY_CURRENT_USER, SubkeyName, '', ExistingValue)) then begin
    Result := Browser + ' has a non-string Clipplane Host registration that cannot be safely checked.';
    exit;
  end;

  if ValueExisted then begin
    if not RegWriteStringValue(HKEY_CURRENT_USER, SubkeyName, '', ExistingValue) then begin
      Result := 'Clipplane cannot write the ' + Browser + ' Host registration.';
    end;
    exit;
  end;

  if not RegWriteStringValue(HKEY_CURRENT_USER, SubkeyName, '', '__clipplane_preflight__') then begin
    Result := 'Clipplane cannot write the ' + Browser + ' Host registration.';
    exit;
  end;
  if not RegDeleteValue(HKEY_CURRENT_USER, SubkeyName, '') then begin
    Result := 'Clipplane could not restore the prior ' + Browser + ' Host registration.';
    exit;
  end;
  if (not KeyExisted) and
     (not RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, SubkeyName)) then begin
    Result := 'Clipplane could not restore the prior ' + Browser + ' Host registration.';
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := CheckRegistrationWriteAccess('Chrome', ChromeRegistrationKey);
  if Result = '' then begin
    Result := CheckRegistrationWriteAccess('Edge', EdgeRegistrationKey);
  end;
end;

function PreserveCredentialsRequested: Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do begin
    if CompareText(ParamStr(Index), '/PRESERVECREDENTIALS') = 0 then begin
      Result := True;
      exit;
    end;
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
var
  CleanupRoot, UninstallArguments: String;
begin
  if CurUninstallStep = usUninstall then begin
    CleanupRoot := ExpandConstant('{tmp}\ClipplaneHostCleanup');
    UninstallArguments := '-Browser all -HostRoot "' + ExpandConstant('{app}') + '"';
    if not PreserveCredentialsRequested then begin
      if not RunHostScript(
        'stage-uninstall-cleanup.ps1', '-Destination "' + CleanupRoot + '"',
        'prepare credential cleanup') then begin
        Abort;
      end;
    end;
    UninstallArguments := UninstallArguments + ' -PreserveCredentials';
    if not RunHostScript('uninstall-host.ps1', UninstallArguments, 'remove the local Host') then begin
      Abort;
    end;
  end else if (CurUninstallStep = usPostUninstall) and
              (not PreserveCredentialsRequested) then begin
    CleanupRoot := ExpandConstant('{tmp}\ClipplaneHostCleanup');
    if not RunPowerShellScript(
      CleanupRoot + '\uninstall-host.ps1', CleanupRoot,
      '-Browser all -HostRoot "' + CleanupRoot + '"',
      'remove Clipplane credentials') then begin
      RaiseException('Clipplane Host was removed, but its credentials could not be deleted.');
    end;
  end;
end;
