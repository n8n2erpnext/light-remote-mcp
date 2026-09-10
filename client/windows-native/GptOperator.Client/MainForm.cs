using System.Diagnostics;
using Microsoft.Win32;

namespace GptOperator.Client;

internal sealed class MainForm : Form
{
    private readonly AgentSupervisor _agent = new();
    private readonly UpdateClient _updates = new();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _refreshTimer = new() { Interval = 3000 };
    private readonly Label _status = new() { AutoSize = true, Font = new Font("Segoe UI", 16, FontStyle.Bold) };
    private readonly Label _device = new() { AutoSize = true };
    private readonly Label _version = new() { AutoSize = true };
    private readonly Label _enrollment = new() { AutoSize = true, MaximumSize = new Size(420, 0) };
    private readonly Button _connect = new() { Width = 130, Height = 34 };
    private readonly Button _enroll = new() { Text = "Enroll device", Width = 130, Height = 34 };
    private readonly Button _update = new() { Text = "Check update", Width = 130, Height = 34 };
    private readonly ToolStripMenuItem _trayConnect = new();
    private bool _exiting;
    private AgentStatus? _lastStatus;

    public MainForm()
    {
        Text = "GPT Operator"; Width = 500; Height = 330;
        StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        Font = new Font("Segoe UI", 10);
        var title = new Label { Text = "GPT Operator", AutoSize = true, Font = new Font("Segoe UI", 22, FontStyle.Bold) };
        var subtitle = new Label { Text = "Outbound device agent", AutoSize = true, ForeColor = Color.DimGray };
        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
        buttons.Controls.AddRange(new Control[] { _connect, _enroll, _update });
        var panel = new FlowLayoutPanel {
            Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false,
            Padding = new Padding(24), AutoScroll = true
        };
        panel.Controls.AddRange(new Control[] { title, subtitle, Spacer(8), _status, _device, _version, _enrollment, Spacer(8), buttons });
        Controls.Add(panel);

        _tray = new NotifyIcon {
            Visible = true, Text = "GPT Operator", Icon = SystemIcons.Shield,
            ContextMenuStrip = BuildTrayMenu()
        };
        _tray.DoubleClick += (_, _) => ShowWindow();
        _connect.Click += async (_, _) => await ToggleConnectionAsync();
        _enroll.Click += async (_, _) => await EnrollAsync();
        _update.Click += async (_, _) => await CheckUpdateAsync(interactive: true);
        _agent.Changed += () => BeginInvoke(new Action(async () => await RefreshAsync()));
        _refreshTimer.Tick += async (_, _) => await RefreshAsync();
        FormClosing += OnFormClosing;
        Shown += async (_, _) => await FirstShownAsync();
    }

    private static Control Spacer(int height) => new Panel { Width = 1, Height = height };

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("Open GPT Operator", null, (_, _) => ShowWindow());
        _trayConnect.Click += async (_, _) => await ToggleConnectionAsync();
        var check = new ToolStripMenuItem("Check for updates", null, async (_, _) => await CheckUpdateAsync(true));
        var exit = new ToolStripMenuItem("Exit", null, (_, _) => ExitApplication());
        menu.Items.AddRange(new ToolStripItem[] { open, _trayConnect, check, new ToolStripSeparator(), exit });
        return menu;
    }
    private async Task FirstShownAsync()
    {
        AppPaths.EnsureDirectories();
        EnsureAutostart();
        await RefreshAsync();
        if (_lastStatus?.Enrolled == true) await _agent.StartAsync();
        _refreshTimer.Start();
        _ = Task.Run(async () => {
            await Task.Delay(TimeSpan.FromSeconds(30));
            try { await CheckUpdateAsync(interactive: false); } catch { }
        });
    }

    private async Task RefreshAsync()
    {
        try
        {
            _lastStatus = await _agent.ReadStatusAsync();
            var connected = _lastStatus.Enrolled && _agent.IsRunning;
            _status.Text = connected ? "Connected" : _lastStatus.Enrolled ? "Offline" : "Not enrolled";
            _status.ForeColor = connected ? Color.ForestGreen : Color.DarkOrange;
            _device.Text = _lastStatus.Enrolled
                ? $"Device: {_lastStatus.DeviceId}  •  {_lastStatus.PlatformAdapter}"
                : "This Windows user is not enrolled yet.";
            _version.Text = $"Client {ClientVersion.Display}  •  Agent {_lastStatus.Version ?? "unknown"}";
            _connect.Text = connected ? "Disconnect" : "Connect";
            _trayConnect.Text = _connect.Text;
            _enroll.Enabled = !_lastStatus.Enrolled;
            _tray.Text = $"GPT Operator — {_status.Text}";
        }
        catch (Exception ex)
        {
            _status.Text = "Client error"; _status.ForeColor = Color.Firebrick;
            _device.Text = ex.Message;
        }
    }

    private async Task ToggleConnectionAsync()
    {
        if (_agent.IsRunning) await _agent.StopAsync(); else await _agent.StartAsync();
        await RefreshAsync();
    }
    private async Task EnrollAsync()
    {
        try
        {
            _enroll.Enabled = false;
            var info = await _agent.BeginEnrollmentAsync();
            _enrollment.Text = $"Approval code: {info.DeviceCode}\r\nBrowser approval expires in about {info.ExpiresInSeconds / 60} minutes.";
            Process.Start(new ProcessStartInfo(info.ActivationUrl) { UseShellExecute = true });
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(60, info.ExpiresInSeconds)));
            while (!timeout.IsCancellationRequested)
            {
                await Task.Delay(3000, timeout.Token);
                if (await _agent.PollEnrollmentAsync(timeout.Token))
                {
                    _enrollment.Text = "Device approved. Starting secure outbound connection…";
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
            if (update is null)
            {
                if (interactive) MessageBox.Show(this, "This client is up to date.", "GPT Operator", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (!interactive)
            {
                _tray.ShowBalloonTip(6000, "GPT Operator update", $"Version {update.Version} is available.", ToolTipIcon.Info);
                return;
            }
            var answer = MessageBox.Show(this, $"Install GPT Operator {update.Version} now?\r\n\r\n{update.Notes}", "Update available", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (answer != DialogResult.Yes) return;
            _update.Enabled = false; _update.Text = "Downloading…";
            var installer = await _updates.DownloadAndVerifyAsync(update);
            await _agent.StopAsync();
            _updates.LaunchInstaller(installer, update);
            ExitApplication();
        }
        catch (FileNotFoundException ex) { if (interactive) MessageBox.Show(this, ex.Message, "GPT Operator update", MessageBoxButtons.OK, MessageBoxIcon.Information); }
        catch (Exception ex) { if (interactive) MessageBox.Show(this, ex.Message, "Update rejected", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { _update.Enabled = true; _update.Text = "Check update"; }
    }
    private void EnsureAutostart()
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            key?.SetValue("GPT Operator", $"\"{Application.ExecutablePath}\" --background", RegistryValueKind.String);
        }
        catch { }
    }

    private void ShowWindow()
    {
        Show(); WindowState = FormWindowState.Normal; BringToFront(); Activate();
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_exiting) return;
        e.Cancel = true;
        Hide();
        _tray.ShowBalloonTip(2500, "GPT Operator", "Still connected in the system tray.", ToolTipIcon.Info);
    }

    private void ExitApplication()
    {
        _exiting = true;
        _refreshTimer.Stop();
        _agent.Dispose();
        _tray.Visible = false;
        Close();
        Application.Exit();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _refreshTimer.Dispose(); _tray.Dispose(); _agent.Dispose(); }
        base.Dispose(disposing);
    }
}
