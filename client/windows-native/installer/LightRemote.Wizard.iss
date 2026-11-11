// Fresh Moryqa Windows distribution V3, frames 73:76/96/116/136/156/176.
// Layout/text are native controls. Inno's transaction, progress and RunList
// remain authoritative. Original STOCK 34:4 is an image, never text "LR".
const
  LRInk = $00432D1C;
  LRMuted = $00887669;
  LRGold = $0000C6F6;
  LRRed = $004A3BE8;
  LRCard = $00F9F7F6;
  LRFooter = $00FBF9F8;
  LRLine = $00EFEBE8;
  LRFontName = 'Google Sans';
  LRUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{A8D073F5-9792-4FA6-96A6-13C565F255F3}_is1';

var
  LRWelcome: TWizardPage;
  LRDesktopShortcut: TNewCheckBox;
  LRWelcomePanel, LRInstallingPanel, LRFinishedPanel: TPanel;
  LRWelcomeCard, LRInstallingCard, LRFinishedCard, LRRemovingCard: TPanel;
  LRNext, LRCancel: TBitmapButton;
  LRPercent: TNewStaticText;
  LRFontFile, LRMarkFile: String;
  LRFontLoaded, LRInteractiveUninstall: Boolean;
  LRModal: TSetupForm;
  LRModalPrimary, LRModalCancel: TBitmapButton;
  LRModalIsConfirm, LRModalAccepted: Boolean;
  LRPage: Integer;
  LRScale: Integer;

function LRAddFont(FileName: String; Flags: Cardinal; Reserved: UINT_PTR): Integer;
external 'AddFontResourceExW@gdi32.dll stdcall';
function LRRemoveFont(FileName: String; Flags: Cardinal; Reserved: UINT_PTR): Boolean;
external 'RemoveFontResourceExW@gdi32.dll stdcall';
function LRRoundRegion(X1, Y1, X2, Y2, W, H: Integer): UINT_PTR;
external 'CreateRoundRectRgn@gdi32.dll stdcall';
function LRSetRegion(Wnd: UINT_PTR; Region: UINT_PTR; Repaint: Boolean): Integer;
external 'SetWindowRgn@user32.dll stdcall';
function LRDeleteObject(Obj: UINT_PTR): Boolean;
external 'DeleteObject@gdi32.dll stdcall';
function LRSetWindowTheme(Wnd: UINT_PTR; SubApp, SubId: String): Integer;
external 'SetWindowTheme@uxtheme.dll stdcall';
function LRGetTextFace(DC: UINT_PTR; Count: Integer; Buffer: String): Integer;
external 'GetTextFaceW@gdi32.dll stdcall';

function LRHasFlag(Flag: String): Boolean;
var I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Flag) = 0 then Result := True;
end;

procedure LRPrepareAssets(IsUninstall: Boolean);
var Base: String;
begin
  LRFontFile := ExpandConstant('{tmp}\LightRemote.Setup.GoogleSans.ttf');
  LRMarkFile := ExpandConstant('{tmp}\LightRemote.Setup.Mark.png');
  if IsUninstall then
  begin
    // Copy before the uninstaller deletes app resources. No public download,
    // font installation, registry font entry or dependency on a browser.
    Base := ExpandConstant('{app}\Assets\setup\');
    if FileExists(Base + 'LightRemote.Setup.GoogleSans.ttf') then
      CopyFile(Base + 'LightRemote.Setup.GoogleSans.ttf', LRFontFile, False);
    if FileExists(Base + 'LightRemote.Setup.Mark.png') then
      CopyFile(Base + 'LightRemote.Setup.Mark.png', LRMarkFile, False);
  end
  else
  begin
    ExtractTemporaryFile('LightRemote.Setup.GoogleSans.ttf');
    ExtractTemporaryFile('LightRemote.Setup.Mark.png');
  end;
  if FileExists(LRFontFile) then LRFontLoaded := LRAddFont(LRFontFile, $10, 0) > 0;
  if not LRFontLoaded then Log('light-remote-wizard-private-font-unavailable');
end;

procedure LRReleaseAssets();
begin
  if LRFontLoaded then
  begin
    LRRemoveFont(LRFontFile, $10, 0);
    LRFontLoaded := False;
  end;
end;

function LRWorkArea(Action, Param: Cardinal; var Area: TRect; Flags: Cardinal): Boolean;
external 'SystemParametersInfoW@user32.dll stdcall';

function LRX(Value: Integer): Integer;
begin
  Result := ScaleX(Value);
  if LRScale > 0 then Result := Int64(Result) * LRScale div 1000;
end;

function LRY(Value: Integer): Integer;
begin
  Result := ScaleY(Value);
  if LRScale > 0 then Result := Int64(Result) * LRScale div 1000;
end;


procedure LRFont(Font: TFont; Pixels: Integer; Bold: Boolean; Color: TColor);
begin
  Font.Name := LRFontName;
  Font.Height := -LRY(Pixels);
  Font.Color := Color;
  if Bold then Font.Style := [fsBold] else Font.Style := [];
end;

procedure LRSizeForm(Form: TSetupForm);
var Area: TRect; Limit, NonClientW, NonClientH: Integer;
begin
  NonClientW := Form.Width - Form.ClientWidth;
  NonClientH := Form.Height - Form.ClientHeight;
  LRScale := 1000;
  // Keep the whole window and its actions within the desktop work area at
  // 100/150/200% and on smaller displays. Scale uniformly, never crop.
  if LRWorkArea($0030, 0, Area, 0) then
  begin
    Limit := Int64(Area.Right - Area.Left - NonClientW - 24) * 1000 div ScaleX(800);
    if Limit < LRScale then LRScale := Limit;
    Limit := Int64(Area.Bottom - Area.Top - NonClientH - 24) * 1000 div ScaleY(560);
    if Limit < LRScale then LRScale := Limit;
    if LRScale < 100 then LRScale := 100;
  end;
  Form.SetBounds(Form.Left, Form.Top, LRX(800) + NonClientW, LRY(560) + NonClientH);
  Form.Color := clWhite;
  Form.Position := poScreenCenter;
  LRFont(Form.Font, 14, False, LRInk);
end;

function LRText(Parent: TWinControl; Name, Text: String;
  X, Y, W, H, Pixels: Integer; Bold: Boolean; Color: TColor): TNewStaticText;
var Probe: TBitmap; Face: String; Count, Width, MinimumHeight: Integer;
begin
  Result := TNewStaticText.Create(Parent);
  Result.Parent := Parent;
  Result.Name := Name;
  Result.AutoSize := False;
  Result.WordWrap := True;
  Result.ShowAccelChar := False;
  Result.SetBounds(LRX(X), LRY(Y), LRX(W), LRY(H));
  Result.Caption := Text;
  Result.StyleElements := [];
  Result.ParentBackground := False;
  Result.ParentColor := True;
  Result.ParentFont := False;
  LRFont(Result.Font, Pixels, Bold, Color);
  // AdjustHeight is an exported Inno 6.7.1 API. It measures DrawText using
  // this control's real font, width and wrapping; nominal Font.Height is not
  // a safe line box for the packaged Google Sans font. Reserve ink padding
  // for EVERY line, including the brand and first heading, not only line two.
  MinimumHeight := Result.Height;
  Result.AdjustHeight();
  Result.Height := Result.Height + LRY(8);
  if Result.Height < MinimumHeight then Result.Height := MinimumHeight;
  if Name = 'LRTitle' then
  begin
    // GDI objects are process-private. Resolve the exact title's TFont in
    // this process; a CI observer must not select our HFONT in its own DC.
    Probe := TBitmap.Create;
    try
      Probe.Width := 1; Probe.Height := 1;
      Probe.Canvas.Font.Assign(Result.Font);
      Width := Probe.Canvas.TextWidth('Light Remote'); // Select the real font.
      Face := StringOfChar(#0, 128);
      Count := LRGetTextFace(Probe.Canvas.Handle, 128, Face);
      if Count > 0 then
      begin
        if Pos(#0, Face) > 0 then Face := Copy(Face, 1, Pos(#0, Face) - 1);
        Log('light-remote-title-font=' + Face + ';width=' + IntToStr(Width));
      end
      else Log('light-remote-title-font=unresolved');
    finally
      Probe.Free;
    end;
  end;
end;

function LRMeasureBlock(Parent: TWinControl; Text: String; W, Pixels: Integer;
  Bold: Boolean): Integer;
var Line: TNewStaticText; Part: String; BreakAt: Integer;
begin
  Result := 0;
  repeat
    BreakAt := Pos(#13#10, Text);
    if BreakAt > 0 then Part := Copy(Text, 1, BreakAt - 1) else Part := Text;
    Line := TNewStaticText.Create(Parent);
    try
      Line.Visible := False;
      Line.Parent := Parent;
      Line.AutoSize := False;
      Line.WordWrap := True;
      Line.ShowAccelChar := False;
      Line.Width := LRX(W);
      LRFont(Line.Font, Pixels, Bold, LRInk);
      Line.Caption := Part;
      Line.AdjustHeight();
      Result := Result + Line.Height + LRY(8);
    finally
      Line.Free;
    end;
    if BreakAt > 0 then
    begin
      Result := Result + LRY(2);
      Text := Copy(Text, BreakAt + 2, Length(Text));
    end;
  until BreakAt = 0;
end;

function LRTextBlock(Parent: TWinControl; Name, Text: String; X, W, TopPx,
  Pixels: Integer; Bold: Boolean; Color: TColor): Integer;
var Line: TNewStaticText; Part: String; BreakAt: Integer;
begin
  // TopPx/result are already device pixels. Keep measured line placement in
  // that space to avoid a second DPI conversion and rounding at 150/200%.
  Result := TopPx;
  repeat
    BreakAt := Pos(#13#10, Text);
    if BreakAt > 0 then Part := Copy(Text, 1, BreakAt - 1) else Part := Text;
    Line := LRText(Parent, Name, Part, X, 0, W, 0, Pixels, Bold, Color);
    Line.Top := Result;
    Result := Line.Top + Line.Height;
    if BreakAt > 0 then
    begin
      Result := Result + LRY(2);
      Text := Copy(Text, BreakAt + 2, Length(Text));
      Name := Name + 'NextLine';
    end;
  until BreakAt = 0;
end;

function LRSurface(Parent: TWinControl; X, Y, W, H: Integer; Color: TColor; Rounded: Boolean): TPanel;
var P: TPanel; Region: UINT_PTR;
begin
  P := TPanel.Create(Parent);
  P.Parent := Parent;
  P.BevelOuter := bvNone;
  P.ParentBackground := False;
  P.StyleElements := [];
  P.Color := Color;
  P.SetBounds(LRX(X), LRY(Y), LRX(W), LRY(H));
  if Rounded then
  begin
    Region := LRRoundRegion(0, 0, P.Width + 1, P.Height + 1, LRX(32), LRY(32));
    if LRSetRegion(P.Handle, Region, True) = 0 then LRDeleteObject(Region);
  end;
  Result := P;
end;

procedure LRLogo(Parent: TWinControl; X, Y, Size: Integer);
var Image: TBitmapImage;
begin
  if not FileExists(LRMarkFile) then Exit; // Broken old install can still be removed.
  Image := TBitmapImage.Create(Parent);
  Image.Parent := Parent;
  Image.SetBounds(LRX(X), LRY(Y), LRX(Size), LRY(Size));
  Image.BackColor := clWhite;
  Image.Stretch := True;
  Image.PngImage.LoadFromFile(LRMarkFile);
end;

function LRView(Form: TSetupForm; Phase: Integer): TPanel;
var Title, Body, Role, Note, Detail, Footer: String;
  Card, FooterPanel: TPanel; TitlePixels, BodyPixels, BodyTop: Integer;
begin
  // No inherited Windows V2 sidebar, numbered steps, fake LR or blue theme.
  Role := 'Windows Setup';
  Footer := 'Your devices. Your permissions.';
  case Phase of
    1: begin
      Title := 'Your AI workspace,' + #13#10 + 'on this PC.';
      Body := 'Connect your AI to files, terminals and desktop apps.' + #13#10 + 'You choose what it can access.';
      Note := 'Installs for your Windows account';
      Detail := 'Your linked devices and saved settings stay yours.';
    end;
    2: begin
      Role := 'Installing';
      Title := 'Making room for' + #13#10 + 'what''s next.';
      Body := 'Light Remote is being installed.' + #13#10 + 'Keep this window open until setup finishes.';
      Note := '';
      Detail := 'Setting up your workspace';
    end;
    3: begin
      Role := 'Setup complete';
      Title := 'Ready when' + #13#10 + 'you are.';
      Body := 'Light Remote is installed.' + #13#10 + 'Open the app to link this PC and choose permissions.';
      Note := 'Everything is in place';
      Detail := 'Your linked devices and saved settings are kept.';
    end;
    4: begin
      Role := 'Uninstall';
      Title := 'Remove the app.' + #13#10 + 'Keep your work.';
      Body := 'The app will stop and be removed from this PC.' + #13#10 + 'Your saved settings and local work will stay.';
      Note := 'Your data stays on this PC';
      Detail := 'Device identity, saved settings and local activity are kept.';
      Footer := 'Your account stays unchanged.';
    end;
    5: begin
      Role := 'Uninstall';
      Title := 'Leaving things' + #13#10 + 'in good order.';
      Body := 'Removing Light Remote from this PC.' + #13#10 + 'Your saved work is being kept.';
      Note := '';
      Detail := 'Saved settings will remain on this PC.';
    end;
    6: begin
      Role := 'Uninstall complete';
      Title := 'Light Remote' + #13#10 + 'is uninstalled.';
      Body := 'Your saved settings and local work are still here.' + #13#10 + 'Thanks for making room for Light Remote.';
      if FileExists(ExpandConstant('{app}\LightRemote.exe')) or
         FileExists(ExpandConstant('{app}\GptOperator.Client.exe')) then
      begin
        Title := 'One last step.';
        Body := 'Restart Windows to finish removing Light Remote.' + #13#10 + 'Your saved settings and local work are still here.';
      end;
      Note := 'Your saved data is kept';
      Detail := 'Reinstall to use this PC with Light Remote again.';
      Footer := 'Until next time.';
    end;
  end;
  Result := TPanel.Create(Form);
  Result.Parent := Form;
  Result.SetBounds(0, 0, LRX(800), LRY(560));
  Result.BevelOuter := bvNone;
  Result.ParentBackground := False;
  Result.StyleElements := [];
  Result.Color := clWhite;
  LRSurface(Result, 0, 78, 800, 1, LRLine, False);
  // Native child controls must have the actual colored surface as parent.
  // A sibling painted behind a STATIC/checkbox does not supply its erase
  // background and can leave white bands even when Color is assigned.
  Card := LRSurface(Result, 40, 322, 720, 116, LRCard, True);
  FooterPanel := LRSurface(Result, 0, 480, 800, 80, LRFooter, False);
  case Phase of
    1: LRWelcomeCard := Card;
    2: LRInstallingCard := Card;
    3: LRFinishedCard := Card;
    5: LRRemovingCard := Card;
  end;
  LRSurface(Result, 0, 480, 800, 1, LRLine, False);
  LRLogo(Result, 28, 22, 28);
  LRLogo(Result, 580, 124, 128);
  LRText(Result, 'LRWordmark', 'Light Remote', 68, 24, 210, 30, 20, True, LRInk);
  LRText(Result, 'LRRole', Role, 620, 30, 150, 22, 12, False, LRMuted);
  TitlePixels := 32;
  BodyPixels := 15;
  // Fit by the installed font's measured line boxes, then flow the body
  // below the complete heading. Never reduce label height to fit the art.
  while (TitlePixels > 26) and
    (LRMeasureBlock(Result, Title, 470, TitlePixels, True) + LRY(8) +
     LRMeasureBlock(Result, Body, 480, BodyPixels, False) > LRY(194)) do
    TitlePixels := TitlePixels - 1;
  BodyTop := LRTextBlock(Result, 'LRTitle', Title, 40, 470, LRY(104), TitlePixels, True, LRInk) + LRY(8);
  LRTextBlock(Result, 'LRBody', Body, 40, 480, BodyTop, BodyPixels, False, LRMuted);
  if Note <> '' then LRText(Card, 'LRNote', Note, 18, 16, 660, 0, 15, True, LRInk);
  if (Phase = 2) or (Phase = 5) then
    LRText(Card, 'LRDetail', Detail, 18, 78, 660, 0, 13, False, LRMuted)
  else
    LRText(Card, 'LRDetail', Detail, 18, 49, 675, 0, 13, False, LRMuted);
  if Phase = 4 then LRText(Card, 'LRKeepNote', 'Reinstall later to use your saved setup.', 18, 78, 675, 0, 13, False, LRMuted);
  if Phase = 6 then LRText(Card, 'LRAccountNote', 'Your online account has not been changed.', 18, 78, 675, 0, 13, False, LRMuted);
  LRText(FooterPanel, 'LRFooterNote', Footer, 32, 35, 440, 0, 12, False, LRMuted);
end;

function LRButton(Parent: TWinControl; Name, Caption: String;
  X, W: Integer; Fill, TextColor: TColor; Click: TNotifyEvent): TBitmapButton;
var B: TBitmap; H: Integer; Bounds: TRect;
begin
  Result := TBitmapButton.Create(Parent);
  Result.Parent := Parent;
  Result.Name := Name;
  Result.AutoSize := False;
  // Inno's accessible native BUTTON adds a 2px focus rectangle on each side.
  Result.SetBounds(LRX(X) - 2, LRY(502) - 2, LRX(W) + 4, LRY(38) + 4);
  Result.BackColor := LRFooter;
  Result.Caption := Caption;
  Result.Center := True;
  Result.TabStop := True;
  B := TBitmap.Create;
  try
    B.Width := LRX(W);
    B.Height := LRY(38);
    B.Canvas.Brush.Color := LRFooter;
    Bounds.Left := 0; Bounds.Top := 0; Bounds.Right := B.Width; Bounds.Bottom := B.Height;
    B.Canvas.FillRect(Bounds);
    B.Canvas.Brush.Color := Fill;
    if Fill = clWhite then B.Canvas.Pen.Color := LRLine else B.Canvas.Pen.Color := Fill;
    B.Canvas.RoundRect(0, 0, B.Width, B.Height, LRX(16), LRY(16));
    LRFont(B.Canvas.Font, 14, True, TextColor);
    B.Canvas.Brush.Style := bsClear;
    H := B.Canvas.TextHeight(Caption);
    B.Canvas.TextOut((B.Width - B.Canvas.TextWidth(Caption)) div 2, (B.Height - H) div 2, Caption);
    Result.Bitmap := B;
  finally
    B.Free;
  end;
  Result.OnClick := Click;
end;

procedure LRForwardNext(Sender: TObject);
begin
  if WizardForm.NextButton.Enabled then WizardForm.NextButton.OnClick(WizardForm.NextButton);
end;

procedure LRForwardCancel(Sender: TObject);
begin
  if WizardForm.CancelButton.Enabled then WizardForm.CancelButton.OnClick(WizardForm.CancelButton);
end;

procedure LRWizardKey(Sender: TObject; var Key: Word; Shift: TShiftState);
begin
  if (LRWelcomePanel = nil) or not LRWelcomePanel.Parent.Visible then Exit;
  if (LRPage <> LRWelcome.ID) and (LRPage <> wpInstalling) and (LRPage <> wpFinished) then Exit;
  if Key = 27 then begin Key := 0; LRForwardCancel(Sender); end
  else if Key = 13 then
  begin
    Key := 0;
    if WizardForm.ActiveControl = LRCancel then LRForwardCancel(Sender)
    else LRForwardNext(Sender);
  end;
end;

procedure LRProgressStyle(Progress: TNewProgressBar);
begin
  // Brand color without simulated progress. The native range/position are
  // changed exclusively by Inno.
  LRSetWindowTheme(Progress.Handle, '', '');
  SendMessage(Progress.Handle, $0409, 0, LRGold);
  SendMessage(Progress.Handle, $2001, 0, LRLine);
end;

procedure InitializeWizard();
begin
  if WizardSilent then Exit;
  LRPrepareAssets(False);
  LRSizeForm(WizardForm);
  LRWelcome := CreateCustomPage(wpWelcome, 'Light Remote', 'Install for this Windows account');
  LRWelcomePanel := LRView(WizardForm, 1);
  LRInstallingPanel := LRView(WizardForm, 2);
  LRFinishedPanel := LRView(WizardForm, 3);
  LRWelcomePanel.Visible := False;
  LRInstallingPanel.Visible := False;
  LRFinishedPanel.Visible := False;
  LRDesktopShortcut := TNewCheckBox.Create(WizardForm);
  LRDesktopShortcut.Parent := LRWelcomeCard;
  LRDesktopShortcut.Name := 'LRDesktopShortcut';
  LRDesktopShortcut.SetBounds(LRX(18), LRY(78), LRX(650),
    LRMeasureBlock(LRWelcomeCard, 'Create a desktop shortcut', 650, 14, False));
  LRDesktopShortcut.Caption := 'Create a desktop shortcut';
  LRDesktopShortcut.Checked := True;
  LRDesktopShortcut.Color := LRCard;
  LRDesktopShortcut.ParentBackground := False;
  LRDesktopShortcut.StyleElements := [];
  LRFont(LRDesktopShortcut.Font, 14, False, LRInk);
  LRPercent := LRText(LRInstallingCard, 'LRPercent', '100%', 650, 16, 52, 0, 13, False, LRMuted);
  LRPercent.Caption := '';
  LRPercent.Alignment := taRightJustify;
  // Buttons belong to the form so they stay above whichever view is shown.
  LRCancel := LRButton(WizardForm, 'LRCancel', 'Cancel', 516, 104, clWhite, LRInk, @LRForwardCancel);
  LRNext := LRButton(WizardForm, 'LRNext', 'Install', 632, 136, LRGold, LRInk, @LRForwardNext);
  WizardForm.KeyPreview := True;
  WizardForm.OnKeyDown := @LRWizardKey;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := PageID = wpSelectTasks;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if LRWelcome = nil then Exit;
  if CurPageID = LRWelcome.ID then
  begin
    if LRDesktopShortcut.Checked then WizardSelectTasks('desktopicon')
    else WizardSelectTasks('!desktopicon');
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
var Branded: Boolean;
begin
  LRPage := CurPageID;
  if LRWelcome = nil then Exit;
  Branded := (CurPageID = LRWelcome.ID) or (CurPageID = wpInstalling) or (CurPageID = wpFinished);
  LRWelcomePanel.Visible := CurPageID = LRWelcome.ID;
  LRInstallingPanel.Visible := CurPageID = wpInstalling;
  LRFinishedPanel.Visible := CurPageID = wpFinished;
  // Preserve stock error/prerequisite/restart pages; never cover a failure.
  WizardForm.NextButton.Visible := not Branded;
  WizardForm.CancelButton.Visible := not Branded;
  WizardForm.BackButton.Visible := not Branded;
  LRNext.Visible := Branded and (CurPageID <> wpInstalling);
  LRCancel.Visible := Branded and (CurPageID <> wpFinished);
  if CurPageID = LRWelcome.ID then LRWelcomePanel.BringToFront();
  if CurPageID = wpInstalling then
  begin
    WizardForm.ProgressGauge.Parent := LRInstallingCard;
    WizardForm.ProgressGauge.SetBounds(LRX(18), LRY(56), LRX(684), LRY(10));
    LRProgressStyle(WizardForm.ProgressGauge);
    WizardForm.StatusLabel.Parent := LRInstallingCard;
    WizardForm.StatusLabel.AutoSize := False;
    WizardForm.StatusLabel.WordWrap := False;
    WizardForm.StatusLabel.SetBounds(LRX(18), LRY(16), LRX(620),
      LRMeasureBlock(LRInstallingCard, 'Installing Light Remote', 620, 15, True));
    WizardForm.StatusLabel.StyleElements := [];
    WizardForm.StatusLabel.ParentBackground := False;
    WizardForm.StatusLabel.ParentColor := True;
    WizardForm.StatusLabel.ShowAccelChar := False;
    LRFont(WizardForm.StatusLabel.Font, 15, True, LRInk);
    WizardForm.FilenameLabel.Visible := False;
    LRInstallingPanel.BringToFront();
  end;
  if CurPageID = wpFinished then
  begin
    WizardForm.RunList.Parent := LRFinishedCard;
    WizardForm.RunList.SetBounds(LRX(18), LRY(78), LRX(684),
      LRMeasureBlock(LRFinishedCard, 'Open Light Remote', 684, 14, False));
    WizardForm.RunList.MinItemHeight := WizardForm.RunList.Height;
    WizardForm.RunList.Color := LRCard;
    WizardForm.RunList.ParentBackground := False;
    WizardForm.RunList.StyleElements := [];
    WizardForm.RunList.BorderStyle := bsNone;
    LRFont(WizardForm.RunList.Font, 14, False, LRInk);
    LRFinishedPanel.BringToFront();
    LRNext.Free;
    LRNext := LRButton(WizardForm, 'LRNext', 'Finish', 632, 136, LRGold, LRInk, @LRForwardNext);
  end;
  LRNext.BringToFront();
  LRCancel.BringToFront();
  if LRNext.Visible then WizardForm.ActiveControl := LRNext;
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
begin
  if LRPercent = nil then Exit;
  if MaxProgress > 0 then LRPercent.Caption := IntToStr(Int64(CurProgress) * 100 div MaxProgress) + '%';
  LRCancel.Enabled := WizardForm.CancelButton.Enabled;
end;

procedure LRRegisterUninstallUI();
var Command: String;
begin
  // Windows Apps invokes the SAME Inno uninstaller. /SILENT suppresses the
  // duplicate stock prompts while leaving its real progress window visible.
  // QuietUninstallString and /VERYSILENT retain the unattended contract.
  Command := '"' + ExpandConstant('{uninstallexe}') + '" /SILENT /NORESTART /LIGHTREMOTEINTERACTIVE';
  if not RegWriteStringValue(HKCU64, LRUninstallKey, 'UninstallString', Command) then
    Log('light-remote-uninstall-ui-registration-failed');
end;

procedure LRModalAccept(Sender: TObject);
begin
  LRModalAccepted := True;
  LRModal.Close;
end;

procedure LRModalKeep(Sender: TObject);
begin
  LRModalAccepted := False;
  LRModal.Close;
end;

procedure LRModalKey(Sender: TObject; var Key: Word; Shift: TShiftState);
begin
  if Key = 27 then begin Key := 0; LRModalKeep(Sender); end
  else if Key = 13 then
  begin
    Key := 0;
    // Destructive action is never the default focused action.
    if LRModalIsConfirm and (LRModal.ActiveControl <> LRModalPrimary) then LRModalKeep(Sender)
    else LRModalAccept(Sender);
  end;
end;

function LRShowUninstallDialog(Confirm: Boolean): Boolean;
var Surface: TPanel; Phase: Integer;
begin
#if VER >= 0x06060000
  LRModal := CreateCustomForm(800, 560, True, True);
#else
  LRModal := CreateCustomForm;
#endif
  try
    LRSizeForm(LRModal);
    LRModalIsConfirm := Confirm;
    LRModal.Caption := 'Light Remote';
    if Confirm then Phase := 4 else Phase := 6;
    Surface := LRView(LRModal, Phase);
    LRModalCancel := nil;
    if Confirm then
    begin
      LRModalCancel := LRButton(Surface, 'LRKeepApp', 'Keep app', 516, 104, clWhite, LRInk, @LRModalKeep);
      LRModalPrimary := LRButton(Surface, 'LRRemoveApp', 'Uninstall', 632, 136, LRRed, clWhite, @LRModalAccept);
      LRModal.ActiveControl := LRModalCancel;
    end
    else
    begin
      LRModalPrimary := LRButton(Surface, 'LRUninstallClose', 'Close', 632, 136, LRGold, LRInk, @LRModalAccept);
      LRModal.ActiveControl := LRModalPrimary;
    end;
    LRModal.KeyPreview := True;
    LRModal.OnKeyDown := @LRModalKey;
    LRModalAccepted := False;
    LRModal.ShowModal();
    Result := LRModalAccepted;
  finally
    LRModal.Free;
    LRModal := nil;
    LRModalPrimary := nil;
    LRModalCancel := nil;
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  LRInteractiveUninstall := LRHasFlag('/LIGHTREMOTEINTERACTIVE') and not LRHasFlag('/VERYSILENT');
  if UninstallSilent and not LRInteractiveUninstall then Exit;
  LRPrepareAssets(True);
  if LRInteractiveUninstall then Result := LRShowUninstallDialog(True);
  // Keep app exits before task/process shutdown or file/registry mutation.
end;

procedure InitializeUninstallProgressForm();
var Surface: TPanel;
begin
  if UninstallSilent and not LRInteractiveUninstall then Exit;
  LRSizeForm(UninstallProgressForm);
  Surface := LRView(UninstallProgressForm, 5);
  UninstallProgressForm.ProgressBar.Parent := LRRemovingCard;
  UninstallProgressForm.ProgressBar.SetBounds(LRX(18), LRY(56), LRX(684), LRY(10));
  LRProgressStyle(UninstallProgressForm.ProgressBar);
  UninstallProgressForm.StatusLabel.Parent := LRRemovingCard;
  UninstallProgressForm.StatusLabel.AutoSize := False;
  UninstallProgressForm.StatusLabel.WordWrap := False;
  UninstallProgressForm.StatusLabel.SetBounds(LRX(18), LRY(16), LRX(684),
    LRMeasureBlock(LRRemovingCard, 'Removing Light Remote', 684, 15, True));
  UninstallProgressForm.StatusLabel.StyleElements := [];
  UninstallProgressForm.StatusLabel.ParentBackground := False;
  UninstallProgressForm.StatusLabel.ParentColor := True;
  UninstallProgressForm.StatusLabel.ShowAccelChar := False;
  LRFont(UninstallProgressForm.StatusLabel.Font, 15, True, LRInk);
  UninstallProgressForm.CancelButton.Visible := False;
  Surface.BringToFront();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usAppMutexCheck then QuiesceInstalledRuntime();
  if (CurUninstallStep = usDone) and LRInteractiveUninstall then
  begin
    // Inno has already destroyed its progress form before usDone.
    LRShowUninstallDialog(False);
  end;
end;

procedure DeinitializeUninstall();
begin
  LRReleaseAssets();
end;
