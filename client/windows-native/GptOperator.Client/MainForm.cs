using System.Diagnostics;
using Microsoft.Win32;

namespace GptOperator.Client;

internal sealed class MainForm : Form
{
    private const string ProductName = "Light Remote MCP";
    private readonly AgentSupervisor _agent = new();
    private readonly UpdateClient _updates = new();
    private readonly System.Windows.Forms.Timer _refreshTimer = new() { Interval = 3000 };
    private readonly ConnectionSwitch _connectionSwitch = new();
    private readonly Label _status = new() { AutoSize = true, Font = UiTheme.Font(15, FontStyle.Bold) };
    private readonly Label _machine = new() { AutoSize = true, Font = UiTheme.Font(11.5f, FontStyle.Bold) };
    private readonly Label _heroMeta = new() { AutoSize = true, Font = UiTheme.Font(9), ForeColor = UiTheme.Muted };
    private readonly Label _enrollment = new() { AutoSize = true, MaximumSize = new Size(350, 0), TextAlign = ContentAlignment.MiddleCenter, ForeColor = UiTheme.Muted };
    private readonly Button _enroll = new() { Text = "Enroll device", Width = 154, Height = 38 };
    private readonly Label _summary = new() { AutoSize = true, ForeColor = UiTheme.Muted };
    private readonly Label _deviceIdValue = new() { AutoSize = false, Height = 40, AutoEllipsis = true, ForeColor = UiTheme.Text, Cursor = Cursors.Hand };
    private readonly Label _platformValue = new() { AutoSize = true, ForeColor = UiTheme.Text };
    private readonly Label _versionValue = new() { AutoSize = true, ForeColor = UiTheme.Text };
    private readonly FlowLayoutPanel _capabilities = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, AutoScroll = true, BackColor = UiTheme.Surface };
    private readonly RoundedPanel _detailsCard = new() { Dock = DockStyle.Right, Width = 300, Visible = false };
    private readonly Button _more = new() { Text = "⋮", Width = 38, Height = 38, TabStop = false };
    private readonly Label _updateDot = new() { Text = "●", AutoSize = true, Font = UiTheme.Font(11, FontStyle.Bold), ForeColor = UiTheme.Warning, Visible = false, BackColor = Color.Transparent };
    private readonly ToolStripMenuItem _menuUpdate = new("Check for updates");
    private readonly ToolStripMenuItem _menuDetails = new("Details view") { CheckOnClick = true };
    private readonly ToolStripMenuItem _trayConnect = new();
    private readonly ToolStripMenuItem _trayUpdate = new("Check for updates");
    private readonly NotifyIcon _tray;
    private readonly ContextMenuStrip _mainMenu;
    private bool _detailsMode;
    private bool _exiting;
    private bool _refreshing;
    private bool _closeTipShown;
    private AgentStatus? _lastStatus;
    private UpdateInfo? _availableUpdate;
    private Icon? _trayIcon;

    public MainForm()
    {
        Text = ProductName;
        ClientSize = new Size(430, 570);
        MinimumSize = new Size(430, 570);
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        BackColor = UiTheme.Background;
        ForeColor = UiTheme.Text;
        Font = UiTheme.Font(9.5f);
        AutoScaleMode = AutoScaleMode.Dpi;

        Controls.Add(BuildContent());
        Controls.Add(BuildHeader());

        _mainMenu = BuildMainMenu();
        _more.ContextMenuStrip = _mainMenu;
        _more.Click += (_, _) => _mainMenu.Show(_more, new Point(_more.Width - _mainMenu.Width, _more.Height + 3));

        _tray = new NotifyIcon {
            Visible = true,
            Text = ProductName,
            ContextMenuStrip = BuildTrayMenu()
        };
        UpdateTrayIcon(false, false);
        _tray.DoubleClick += (_, _) => ShowWindow();

        _connectionSwitch.ToggleRequested += async next => await SetConnectionAsync(next);
        _enroll.Click += async (_, _) => await EnrollAsync();
        _agent.Changed += OnAgentChanged;
        _refreshTimer.Tick += async (_, _) => await RefreshAsync();
        FormClosing += OnFormClosing;
        Resize += OnResize;
        Shown += async (_, _) => await FirstShownAsync();
        HandleCreated += (_, _) => UiTheme.ApplyDarkTitleBar(this);

        UiTheme.StyleButton(_enroll, primary: true);
        UiTheme.StyleButton(_more);
        _more.FlatAppearance.BorderSize = 0;
        _more.Font = UiTheme.Font(18, FontStyle.Bold);
    }

    private Control BuildHeader()
    {
        var header = new Panel { Dock = DockStyle.Top, Height = 68, BackColor = UiTheme.Background, Padding = new Padding(20, 13, 18, 8) };
        var mark = new Label {
            Text = "L", TextAlign = ContentAlignment.MiddleCenter, Size = new Size(36, 36),
            BackColor = UiTheme.Accent, ForeColor = Color.White, Font = UiTheme.Font(16, FontStyle.Bold),
            Location = new Point(20, 14)
        };
        var product = new Label { Text = ProductName, AutoSize = true, ForeColor = UiTheme.Text, Font = UiTheme.Font(11.5f, FontStyle.Bold), Location = new Point(68, 14) };
        var subtitle = new Label { Text = "Secure remote MCP agent", AutoSize = true, ForeColor = UiTheme.Muted, Font = UiTheme.Font(8.5f), Location = new Point(68, 35) };
        _more.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _more.Location = new Point(header.Width - 58, 11);
        _updateDot.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _updateDot.Location = new Point(header.Width - 31, 7);
        header.Controls.AddRange(new Control[] { mark, product, subtitle, _more, _updateDot });
        return header;
    }

    private Control BuildContent()
    {
        var content = new Panel { Dock = DockStyle.Fill, BackColor = UiTheme.Background, Padding = new Padding(20, 5, 20, 18) };
        _detailsCard.Margin = new Padding(14, 0, 0, 0);
        BuildDetailsCard();
        var main = BuildMainColumn();
        content.Controls.Add(main);
        content.Controls.Add(_detailsCard);
        return content;
    }

    private Control BuildMainColumn()
    {
        var main = new Panel { Dock = DockStyle.Fill, BackColor = UiTheme.Background, Padding = new Padding(0, 0, 14, 0) };
        var hero = new TableLayoutPanel {
            Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 8,
            BackColor = UiTheme.Background, Padding = new Padding(0, 28, 0, 8)
        };
        hero.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 80));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 31));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        hero.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        hero.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var eyebrow = new Label { Text = "OUTBOUND CONNECTION", AutoSize = true, ForeColor = UiTheme.Muted, Font = UiTheme.Font(8, FontStyle.Bold), Anchor = AnchorStyles.None };
        _connectionSwitch.Anchor = AnchorStyles.None;
        _status.Anchor = AnchorStyles.None;
        _machine.Anchor = AnchorStyles.None;
        _heroMeta.Anchor = AnchorStyles.None;
        _enroll.Anchor = AnchorStyles.None;
        _enrollment.Anchor = AnchorStyles.None;
        hero.Controls.Add(eyebrow, 0, 0);
        hero.Controls.Add(_connectionSwitch, 0, 1);
        hero.Controls.Add(_status, 0, 2);
        hero.Controls.Add(_machine, 0, 3);
        hero.Controls.Add(_heroMeta, 0, 4);
        hero.Controls.Add(_enrollment, 0, 5);
        hero.Controls.Add(_enroll, 0, 6);

        var summaryCard = new RoundedPanel { Dock = DockStyle.Bottom, Height = 108, Padding = new Padding(18, 16, 18, 14) };
        var summaryTitle = new Label { Text = "Secure device link", AutoSize = true, ForeColor = UiTheme.Text, Font = UiTheme.Font(10, FontStyle.Bold), Location = new Point(18, 16) };
        _summary.Location = new Point(18, 42);
        _summary.MaximumSize = new Size(340, 0);
        var hint = new Label { Text = "Closing this window keeps the device online in the system tray.", AutoSize = true, ForeColor = UiTheme.Muted, Font = UiTheme.Font(8.5f), Location = new Point(18, 70) };
        summaryCard.Controls.AddRange(new Control[] { summaryTitle, _summary, hint });

        main.Controls.Add(hero);
        main.Controls.Add(summaryCard);
        return main;
    }

    private void BuildDetailsCard()
    {
        _detailsCard.Padding = new Padding(20, 18, 20, 18);
        var title = new Label { Text = "Device details", AutoSize = true, Font = UiTheme.Font(12, FontStyle.Bold), ForeColor = UiTheme.Text, Dock = DockStyle.Top };
        var caption = new Label { Text = "Identity, runtime and granted permissions", AutoSize = true, ForeColor = UiTheme.Muted, Font = UiTheme.Font(8.5f), Dock = DockStyle.Top, Padding = new Padding(0, 4, 0, 14) };
        var rows = new TableLayoutPanel { Dock = DockStyle.Top, Height = 176, ColumnCount = 1, RowCount = 6, BackColor = UiTheme.Surface };
        rows.RowStyles.Clear();
        rows.Controls.Add(MetaCaption("DEVICE ID"), 0, 0);
        _deviceIdValue.Dock = DockStyle.Fill;
        _deviceIdValue.Padding = new Padding(0, 4, 0, 0);
        rows.Controls.Add(_deviceIdValue, 0, 1);
        rows.Controls.Add(MetaCaption("PLATFORM"), 0, 2);
        rows.Controls.Add(_platformValue, 0, 3);
        rows.Controls.Add(MetaCaption("VERSION"), 0, 4);
        rows.Controls.Add(_versionValue, 0, 5);
        for (var i = 0; i < 6; i++) rows.RowStyles.Add(new RowStyle(SizeType.Absolute, i % 2 == 0 ? 22 : i == 1 ? 40 : 30));

        var permissionsTitle = new Label { Text = "Granted permissions", AutoSize = true, ForeColor = UiTheme.Text, Font = UiTheme.Font(9.5f, FontStyle.Bold), Dock = DockStyle.Top, Padding = new Padding(0, 15, 0, 8) };
        _capabilities.Padding = new Padding(0, 4, 0, 4);

        var logs = new Button { Text = "Open logs", Dock = DockStyle.Bottom, Height = 36 };
        UiTheme.StyleButton(logs);
        logs.Click += (_, _) => OpenLogs();

        _deviceIdValue.Click += (_, _) => CopyDeviceId();
        _detailsCard.Controls.Add(_capabilities);
        _detailsCard.Controls.Add(permissionsTitle);
        _detailsCard.Controls.Add(rows);
        _detailsCard.Controls.Add(caption);
        _detailsCard.Controls.Add(title);
        _detailsCard.Controls.Add(logs);
    }

    private static Label MetaCaption(string text) => new() {
        Text = text, AutoSize = true, ForeColor = UiTheme.Muted,
        Font = UiTheme.Font(7.5f, FontStyle.Bold), Padding = new Padding(0, 6, 0, 0)
    };

    private ContextMenuStrip BuildMainMenu()
    {
        var menu = new ContextMenuStrip();
        UiTheme.StyleMenu(menu);
        _menuUpdate.Click += async (_, _) => await CheckUpdateAsync(interactive: true);
        _menuDetails.Click += (_, _) => SetDetailsMode(_menuDetails.Checked);
        var logs = new ToolStripMenuItem("Open logs", null, (_, _) => OpenLogs());
        var about = new ToolStripMenuItem("About Light Remote MCP", null, (_, _) => ShowAbout());
        var exit = new ToolStripMenuItem("Exit", null, (_, _) => ExitApplication());
        menu.Items.AddRange(new ToolStripItem[] { _menuUpdate, new ToolStripSeparator(), _menuDetails, logs, new ToolStripSeparator(), about, exit });
        return menu;
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        UiTheme.StyleMenu(menu);
        var open = new ToolStripMenuItem("Open Light Remote MCP", null, (_, _) => ShowWindow());
        _trayConnect.Click += async (_, _) => await SetConnectionAsync(!_agent.IsRunning);
        _trayUpdate.Click += async (_, _) => await CheckUpdateAsync(interactive: true);
        var logs = new ToolStripMenuItem("Open logs", null, (_, _) => OpenLogs());
        var exit = new ToolStripMenuItem("Exit", null, (_, _) => ExitApplication());
        menu.Items.AddRange(new ToolStripItem[] { open, _trayConnect, _trayUpdate, logs, new ToolStripSeparator(), exit });
        return menu;
    }

    private async Task FirstShownAsync()
    {
        AppPaths.EnsureDirectories();
        EnsureAutostart();
        await RefreshAsync();
        if (_lastStatus?.Enrolled == true) await _agent.StartAsync();
        await RefreshAsync();
        _refreshTimer.Start();
        _ = CheckForUpdateLaterAsync();
    }

    private async Task CheckForUpdateLaterAsync()
    {
        await Task.Delay(TimeSpan.FromSeconds(30));
        if (_exiting || IsDisposed) return;
        try { await CheckUpdateAsync(interactive: false); } catch { }
    }

    private void OnAgentChanged()
    {
        if (!IsHandleCreated || IsDisposed || Disposing) return;
        try { BeginInvoke(new Action(async () => await RefreshAsync())); } catch { }
    }

    private async Task RefreshAsync()
    {
        if (_refreshing || _exiting) return;
        _refreshing = true;
        try
        {
            _lastStatus = await _agent.ReadStatusAsync();
            var connected = _lastStatus.Enrolled && _agent.IsRunning;
            var stateText = connected ? "Connected" : _lastStatus.Enrolled ? "Offline" : "Not enrolled";
            _status.Text = stateText;
            _status.ForeColor = connected ? UiTheme.Success : _lastStatus.Enrolled ? UiTheme.Warning : UiTheme.Muted;
            _machine.Text = Environment.MachineName.ToLowerInvariant();
            _heroMeta.Text = _lastStatus.Enrolled
                ? $"{_lastStatus.PlatformAdapter ?? "windows"}  •  {ShortId(_lastStatus.DeviceId)}"
                : "Windows device • waiting for secure enrollment";
            _connectionSwitch.Checked = connected;
            _connectionSwitch.Enabled = _lastStatus.Enrolled;
            _connectionSwitch.Busy = false;
            _enroll.Visible = !_lastStatus.Enrolled;
            if (_lastStatus.Enrolled) _enrollment.Text = "";
            _summary.Text = connected
                ? "Outbound-only channel • signed device identity • starts with Windows"
                : _lastStatus.Enrolled ? "Device identity is ready. Connect when you want remote access." : "Enroll once to bind this Windows user to your remote MCP account.";
            _deviceIdValue.Text = _lastStatus.DeviceId ?? "Not enrolled";
            _platformValue.Text = $"{_lastStatus.PlatformAdapter ?? "win32"}  •  {System.Runtime.InteropServices.RuntimeInformation.OSArchitecture}";
            _versionValue.Text = $"Client {ClientVersion.Display}  •  Agent {_lastStatus.Version ?? "unknown"}";
            UpdateCapabilities(_lastStatus.EffectiveCapabilities);
            _trayConnect.Enabled = _lastStatus.Enrolled;
            _trayConnect.Text = connected ? "Disconnect" : "Connect";
            _tray.Text = $"{ProductName} — {stateText}";
            UpdateTrayIcon(connected, _lastStatus.Enrolled);
        }
        catch (Exception ex)
        {
            _status.Text = "Client error";
            _status.ForeColor = UiTheme.Danger;
            _heroMeta.Text = ex.Message;
            _connectionSwitch.Checked = false;
            _connectionSwitch.Enabled = false;
            UpdateTrayIcon(false, _lastStatus?.Enrolled == true);
        }
        finally { _refreshing = false; }
    }

    private void UpdateCapabilities(IEnumerable<string> capabilities)
    {
        _capabilities.SuspendLayout();
        _capabilities.Controls.Clear();
        var list = capabilities.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToArray();
        if (list.Length == 0)
        {
            _capabilities.Controls.Add(new Label { Text = "No permissions advertised", AutoSize = true, ForeColor = UiTheme.Muted, Font = UiTheme.Font(8.5f) });
        }
        else
        {
            foreach (var capability in list)
            {
                var chip = new Label {
                    Text = capability, AutoSize = true, ForeColor = UiTheme.Text, BackColor = UiTheme.SurfaceAlt,
                    Font = UiTheme.Font(8), Padding = new Padding(8, 5, 8, 5), Margin = new Padding(0, 0, 6, 6)
                };
                _capabilities.Controls.Add(chip);
            }
        }
        _capabilities.ResumeLayout();
    }

    private async Task SetConnectionAsync(bool shouldConnect)
    {
        if (_lastStatus?.Enrolled != true) return;
        _connectionSwitch.Busy = true;
        _connectionSwitch.Enabled = false;
        try
        {
            if (shouldConnect && !_agent.IsRunning) await _agent.StartAsync();
            else if (!shouldConnect && _agent.IsRunning) await _agent.StopAsync();
        }
        finally
        {
            _connectionSwitch.Enabled = true;
            _connectionSwitch.Busy = false;
            await RefreshAsync();
        }
    }

    private async Task EnrollAsync()
    {
        try
        {
            _enroll.Enabled = false;
            var info = await _agent.BeginEnrollmentAsync();
            _enrollment.Text = $"Approval code  {info.DeviceCode}\r\nA browser window has been opened for approval.";
            Process.Start(new ProcessStartInfo(info.ActivationUrl) { UseShellExecute = true });
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(60, info.ExpiresInSeconds)));
            while (!timeout.IsCancellationRequested)
            {
                await Task.Delay(3000, timeout.Token);
                if (await _agent.PollEnrollmentAsync(timeout.Token))
                {
                    _enrollment.Text = "Device approved. Starting secure connection…";
                    await _agent.StartAsync();
                    await RefreshAsync();
                    return;
                }
            }
        }
        catch (OperationCanceledException) { _enrollment.Text = "Enrollment expired. Start again when ready."; }
        catch (Exception ex) { _enrollment.Text = $"Enrollment failed: {ex.Message}"; }
        finally { _enroll.Enabled = _lastStatus?.Enrolled != true; }
    }

    private async Task CheckUpdateAsync(bool interactive)
    {
        try
        {
            var update = await _updates.CheckAsync();
            _availableUpdate = update;
            UpdateUpdateUi();
            if (update is null)
            {
                if (interactive) MessageBox.Show(this, "Light Remote MCP is up to date.", ProductName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (!interactive)
            {
                _tray.ShowBalloonTip(6000, "Light Remote MCP update", $"Version {update.Version} is available.", ToolTipIcon.Info);
                return;
            }
            var answer = MessageBox.Show(this, $"Install Light Remote MCP {update.Version} now?\r\n\r\n{update.Notes}", "Update available", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer != DialogResult.Yes) return;
            _menuUpdate.Enabled = false;
            _menuUpdate.Text = "Downloading update…";
            var installer = await _updates.DownloadAndVerifyAsync(update);
            await _agent.StopAsync();
            _updates.LaunchInstaller(installer, update);
            ExitApplication();
        }
        catch (FileNotFoundException ex)
        {
            _availableUpdate = null;
            UpdateUpdateUi();
            if (interactive) MessageBox.Show(this, ex.Message, "Light Remote MCP update", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            if (interactive) MessageBox.Show(this, ex.Message, "Update rejected", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { _menuUpdate.Enabled = true; UpdateUpdateUi(); }
    }

    private void UpdateUpdateUi()
    {
        var available = _availableUpdate is not null;
        _updateDot.Visible = available;
        _menuUpdate.Text = available ? $"Update {_availableUpdate!.Version} available" : "Check for updates";
        _menuUpdate.ForeColor = available ? UiTheme.Warning : UiTheme.Text;
        _trayUpdate.Text = _menuUpdate.Text;
    }

    private void SetDetailsMode(bool enabled)
    {
        _detailsMode = enabled;
        _menuDetails.Checked = enabled;
        _detailsCard.Visible = enabled;
        ClientSize = enabled ? new Size(760, 570) : new Size(430, 570);
    }

    private void EnsureAutostart()
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            key?.DeleteValue("GPT Operator", throwOnMissingValue: false);
            key?.SetValue(ProductName, $"\"{Application.ExecutablePath}\" --background", RegistryValueKind.String);
        }
        catch { }
    }

    private void OpenLogs()
    {
        AppPaths.EnsureDirectories();
        try { Process.Start(new ProcessStartInfo("explorer.exe", AppPaths.LogDir) { UseShellExecute = true }); } catch { }
    }

    private void CopyDeviceId()
    {
        if (string.IsNullOrWhiteSpace(_lastStatus?.DeviceId)) return;
        try { Clipboard.SetText(_lastStatus.DeviceId); } catch { }
    }

    private void ShowAbout()
    {
        MessageBox.Show(this,
            $"Light Remote MCP\r\n\r\nClient {ClientVersion.Display}\r\nAgent {_lastStatus?.Version ?? "unknown"}\r\n\r\nSecure outbound remote MCP for your own machines.",
            "About Light Remote MCP", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void UpdateTrayIcon(bool connected, bool enrolled)
    {
        var next = TrayIconFactory.Create(connected, enrolled);
        var old = _trayIcon;
        _trayIcon = next;
        if (_tray is not null) _tray.Icon = next;
        old?.Dispose();
    }

    private static string ShortId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return "unbound";
        return id.Length <= 18 ? id : $"{id[..10]}…{id[^6..]}";
    }

    private void ShowWindow()
    {
        ShowInTaskbar = true;
        Show();
        WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    private void HideToTray(bool notify)
    {
        Hide();
        ShowInTaskbar = false;
        if (notify && !_closeTipShown)
        {
            _closeTipShown = true;
            _tray.ShowBalloonTip(2500, ProductName, "Still connected in the system tray.", ToolTipIcon.Info);
        }
    }

    private void OnResize(object? sender, EventArgs e)
    {
        if (!_exiting && WindowState == FormWindowState.Minimized) HideToTray(notify: false);
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_exiting) return;
        e.Cancel = true;
        HideToTray(notify: true);
    }

    private void ExitApplication()
    {
        if (_exiting) return;
        _exiting = true;
        _refreshTimer.Stop();
        _agent.Dispose();
        _tray.Visible = false;
        _trayIcon?.Dispose();
        Close();
        Application.Exit();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _refreshTimer.Dispose();
            _tray.Dispose();
            _trayIcon?.Dispose();
            _mainMenu.Dispose();
            _agent.Dispose();
        }
        base.Dispose(disposing);
    }
}
