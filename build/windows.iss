; Offline Windows installer: stable release layout, bundled Electron/Claude, per-user shell integration.
; Compiled only by scripts/package-windows.mjs with pinned Inno Setup. No Node/npm/Git on the target PC.
#ifndef Payload
  #error Build with npm run package:windows
#endif

[Setup]
AppId={{6D54894A-5193-47B6-9761-6B6998F524E8}
AppName=second-brain
AppVersion={#AppVersion}
AppPublisher=second-brain contributors
DefaultDirName={localappdata}\second-brain
UsePreviousAppDir=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename={#OutputName}
SetupIconFile={#Payload}\icon.ico
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2/fast
SolidCompression=yes
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
DisableStartupPrompt=yes
CloseApplications=no
RestartApplications=no
Uninstallable=not IsIsolated
CreateUninstallRegKey=not IsIsolated
WizardStyle=modern

[Files]
; Inno never writes active/bootstrap/immutable assets outside the common release-writer lock.
Source: "{#Payload}\*"; DestDir: "{app}\.installer\{#ReleaseId}\{code:InstallerToken}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{code:DesktopShortcut}\second-brain"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "second-brain"
Name: "{code:MenuShortcut}\second-brain"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; AppUserModelID: "second-brain"

[UninstallDelete]
Type: files; Name: "{app}\launch.cmd"
Type: files; Name: "{app}\launch.vbs"
Type: files; Name: "{app}\current.json"
Type: files; Name: "{app}\launch-result.json"
Type: files; Name: "{app}\release.mjs"
Type: files; Name: "{app}\update.mjs"
Type: files; Name: "{app}\icon.ico"
Type: files; Name: "{app}\LICENSE"
Type: filesandordirs; Name: "{app}\releases"
Type: filesandordirs; Name: "{app}\electron"
Type: filesandordirs; Name: "{app}\engines"
Type: filesandordirs; Name: "{app}\staged"
Type: filesandordirs; Name: "{app}\.installer"

[Code]
var
  UninstallLock, UninstallOwner, UninstallToken: String;
  UninstallMutating, UninstallComplete: Boolean;

function NativeCreateDirectory(Name: String; Security: Integer): Boolean;
  external 'CreateDirectoryW@kernel32.dll stdcall';
function NativeAttributes(Name: String): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';
function NativeProcessId: Cardinal;
  external 'GetCurrentProcessId@kernel32.dll stdcall';
function SetEnvironmentVariable(Name, Value: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

function InstallerToken(Param: String): String;
begin
  { The installer-owned temp directory is unique per running Setup; concurrent builds never share a payload. }
  Result := GetSHA256OfString(ExpandConstant('{tmp}'));
end;

function JournalName(Index: Integer): String;
begin
  case Index of
    0: Result := 'release.mjs'; 1: Result := 'update.mjs'; 2: Result := 'icon.ico';
    3: Result := 'LICENSE'; 4: Result := 'current.json'; 5: Result := 'launch.cmd';
    6: Result := 'launch.vbs'; 7: Result := 'launch.sh'; 8: Result := 'second-brain.command';
  end;
end;

procedure AssertNoReparse(Name: String; Recursive: Boolean);
var
  Attributes: Cardinal;
  Entry: TFindRec;
begin
  Attributes := NativeAttributes(Name);
  if Attributes = $FFFFFFFF then exit;
  if (Attributes and $400) <> 0 then RaiseException('Reparse paths are not supported during uninstall. Preserve the installation for maintenance.');
  if Recursive and ((Attributes and $10) <> 0) then begin
    if FindFirst(AddBackslash(Name) + '*', Entry) then begin
      try
        repeat
          if (Entry.Name <> '.') and (Entry.Name <> '..') then AssertNoReparse(AddBackslash(Name) + Entry.Name, True);
        until not FindNext(Entry);
      finally FindClose(Entry); end;
    end;
  end;
end;

function InitializeUninstall: Boolean;
var
  Parent, OwnerPath: String;
  ExitCode: Integer;
begin
  Result := False;
  Parent := ExpandFileName(ExpandConstant('{app}'));
  while Length(Parent) > 3 do begin
    AssertNoReparse(Parent, False);
    Parent := ExtractFileDir(Parent);
  end;
  UninstallLock := ExpandConstant('{app}\.release-writer-lock');
  if not NativeCreateDirectory(UninstallLock, 0) then begin
    MsgBox('Another release operation or an interrupted operation owns this installation. Preserve its lock and journal; uninstall was cancelled.', mbError, MB_OK);
    exit;
  end;
  UninstallToken := IntToStr(NativeProcessId) + '-' + GetDateTimeString('yyyymmddhhnnss', '-', ':') + '-' + IntToStr(Random(2147483647));
  UninstallOwner := '{"protocol":1,"operation":"uninstall","pid":' + IntToStr(NativeProcessId) + ',"token":"' + UninstallToken + '","dirty":false}';
  OwnerPath := AddBackslash(UninstallLock) + 'owner.json';
  if not SaveStringToFile(OwnerPath, UninstallOwner, False) then RaiseException('Cannot persist uninstall lock; preserve it for maintenance.');
  SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', '1');
  SetEnvironmentVariable('SB_RELEASES_ROOT', ExpandConstant('{app}'));
  if not Exec(ExpandConstant('{app}\electron\{#ElectronVersion}\electron.exe'), ExpandConstant('"{app}\release.mjs" uninstall-check ') + UninstallToken,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then exit;
  Result := ExitCode = 0;
  if not Result then MsgBox('Close second-brain before uninstalling. No running instance was stopped. If a release operation was interrupted, preserve its journal for maintenance.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(Step: TUninstallStep);
var
  I: Integer;
  Source, Before, Journal: String;
  Disk: AnsiString;
begin
  if Step = usUninstall then begin
    AssertNoReparse(UninstallLock, True);
    if not LoadStringFromFile(AddBackslash(UninstallLock) + 'owner.json', Disk) or (String(Disk) <> UninstallOwner) then RaiseException('Uninstall lock ownership changed; preserve it.');
    AssertNoReparse(ExpandConstant('{app}\releases'), True);
    AssertNoReparse(ExpandConstant('{app}\electron'), True);
    AssertNoReparse(ExpandConstant('{app}\engines'), True);
    AssertNoReparse(ExpandConstant('{app}\staged'), True);
    AssertNoReparse(ExpandConstant('{app}\.installer'), True);
    Before := AddBackslash(UninstallLock) + 'before';
    if not NativeCreateDirectory(Before, 0) then RaiseException('Cannot prepare uninstall journal.');
    Journal := '{';
    for I := 0 to 8 do begin
      Source := ExpandConstant('{app}\') + JournalName(I);
      AssertNoReparse(Source, False);
      if I > 0 then Journal := Journal + ',';
      Journal := Journal + '"' + JournalName(I) + '":';
      if FileExists(Source) then begin
        if not FileCopy(Source, AddBackslash(Before) + JournalName(I), True) then RaiseException('Cannot preserve uninstall journal.');
        Journal := Journal + '"' + GetSHA256OfFile(AddBackslash(Before) + JournalName(I)) + '"';
      end else Journal := Journal + 'null';
    end;
    UninstallOwner := '{"protocol":1,"operation":"uninstall","pid":' + IntToStr(NativeProcessId) + ',"token":"' + UninstallToken + '","dirty":true,"before":' + Journal + '}}';
    if not SaveStringToFile(AddBackslash(UninstallLock) + 'owner.json', UninstallOwner, False) then RaiseException('Cannot persist dirty uninstall journal.');
    UninstallMutating := True;
  end;
  if Step = usPostUninstall then UninstallComplete := True;
end;

procedure DeinitializeUninstall;
var
  Disk: AnsiString;
  I: Integer;
begin
  if (UninstallLock = '') or (UninstallOwner = '') then exit;
  if UninstallMutating and not UninstallComplete then exit; { Dirty failures/crashes must never discard recovery evidence. }
  AssertNoReparse(UninstallLock, True);
  if not LoadStringFromFile(AddBackslash(UninstallLock) + 'owner.json', Disk) or (String(Disk) <> UninstallOwner) then exit;
  for I := 0 to 8 do DeleteFile(AddBackslash(UninstallLock) + 'before\' + JournalName(I));
  RemoveDir(AddBackslash(UninstallLock) + 'before');
  DeleteFile(AddBackslash(UninstallLock) + 'owner.json');
  RemoveDir(UninstallLock);
end;

function IsIsolated: Boolean;
begin
  Result := ExpandConstant('{param:SBTEST|0}') = '1';
end;

function DesktopShortcut(Param: String): String;
begin
  if IsIsolated then Result := ExpandConstant('{app}\test-shortcuts\Desktop')
  else Result := ExpandConstant('{userdesktop}');
end;

function MenuShortcut(Param: String): String;
begin
  if IsIsolated then Result := ExpandConstant('{app}\test-shortcuts\Programs')
  else Result := ExpandConstant('{userprograms}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  { No input is needed: the user already chose to run this per-user installer. }
  Result := PageID = wpReady;
end;

procedure InitializeWizard;
begin
  if not IsIsolated then WizardForm.DirEdit.Text := ExpandConstant('{localappdata}\second-brain');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Target, TempRoot, ProfileRoot: String;
begin
  Result := '';
  if IsIsolated then begin
    Target := AddBackslash(ExpandFileName(WizardDirValue));
    TempRoot := AddBackslash(ExpandFileName(GetEnv('TEMP')));
    ProfileRoot := AddBackslash(ExpandFileName(GetEnv('SB_USER_DATA')));
    if (CompareText(Copy(Target, 1, Length(TempRoot)), TempRoot) <> 0) or
       (GetEnv('SB_HIDDEN') <> '1') or
       (CompareText(ProfileRoot, AddBackslash(Target + 'test-user-data')) <> 0) then
      Result := 'Isolated installer tests require a temporary folder, SB_HIDDEN=1 and SB_USER_DATA=<install>/test-user-data.';
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', '1');
    SetEnvironmentVariable('SB_RELEASES_ROOT', ExpandConstant('{app}'));
    SetEnvironmentVariable('SB_NO_SYNC', '1');
    if not Exec(ExpandConstant('{app}\.installer\{#ReleaseId}\{code:InstallerToken}\electron\{#ElectronVersion}\electron.exe'),
      ExpandConstant('"{app}\.installer\{#ReleaseId}\{code:InstallerToken}\release.mjs" install-payload {#ReleaseId} {#PayloadManifestSha256}'), ExpandConstant('{app}'),
      SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Cannot initialize the installed release. No application was started.');
    if ExitCode <> 0 then RaiseException('Release initialization failed. No application was started.');
    SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', '');
    if not ShellExec('', ExpandConstant('{sys}\wscript.exe'), ExpandConstant('"{app}\launch.vbs"'),
      ExpandConstant('{app}'), SW_HIDE, ewNoWait, ExitCode) then
      RaiseException('The application is installed, but could not be started.');
  end;
end;
