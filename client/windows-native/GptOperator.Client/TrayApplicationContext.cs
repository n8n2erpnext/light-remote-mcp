using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GptOperator.Client;

internal sealed record TrayAgentSnapshot(
    bool StatusAvailable,
    bool Enrolled,
    bool CloudDesiredConnected,
    string CloudState,
    string Plan,
    string LastCloudError,
    bool FleetHealthy,
    string? FleetUrl,
    string? PendingEnrollmentId = null
);

internal sealed class TrayApplicationContext : ApplicationContext
{
    private const string AgentTask = "LightRemoteDeviceAgent";
    private const string UpdateTask = "LightRemoteUpdater";
    private const string WallUrl = "http://127.0.0.1:5491/";
    private const string AccountUrl = "https://light-remote.thaiduy.digital/account";
    private const string LocalFleetUrl = "http://127.0.0.1:5492/";

    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _state = new("Starting...") { Enabled = false };
    private readonly ToolStripMenuItem _openWall = new("Open Local Wall");
    private readonly ToolStripMenuItem _openFleet = new("Open Fleet") { Visible = false, Enabled = false };
    private readonly ToolStripMenuItem _account = new("Manage Account");
    private readonly ToolStripMenuItem _relink = new("Relink this Windows PC…");
    private readonly ToolStripMenuItem _connect = new("Connect");
    private readonly ToolStripMenuItem _restart = new("Restart Light Remote");
    private readonly ToolStripMenuItem _update = new("Check for updates");
    private readonly ToolStripMenuItem _serviceToggle = new("Stop Light Remote");
    private readonly ToolStripMenuItem _quit = new("Exit Tray UI");
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 5000 };

    private bool _busy;
    private bool _enrollmentStarting;
    private bool _enrollmentPollInFlight;
    private string? _fleetUrl;
    private string? _actionStatus;
    private DateTimeOffset _actionStatusUntil;

    public TrayApplicationContext()
    {
        ClientEvent("tray_started", new { version = Application.ProductVersion });

        var menu = new ContextMenuStrip();
        UiTheme.StyleMenu(menu);
        menu.Items.Add(_state);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_openWall);
        menu.Items.Add(_openFleet);
        menu.Items.Add(_account);
        menu.Items.Add(_relink);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_connect);
        menu.Items.Add(_restart);
        menu.Items.Add(_serviceToggle);
        menu.Items.Add(_update);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_quit);

        _openWall.Click += async (_, _) => await OpenWallAsync();
        _openFleet.Click += (_, _) => OpenFleet();
        _account.Click += (_, _) => OpenUrl(AccountUrl, "account_open_failed");
        _relink.Click += async (_, _) => await RelinkWindowsAsync();
        _connect.Click += async (_, _) => await ToggleConnectionAsync();
        _restart.Click += async (_, _) => await RestartLightRemoteAsync();
        _serviceToggle.Click += async (_, _) => await ToggleServiceAsync();
        _update.Click += async (_, _) => await CheckForUpdatesAsync();
        _quit.Click += (_, _) => ExitThread();

        _tray = new NotifyIcon
        {
            Visible = true,
            Text = "Light Remote",
            ContextMenuStrip = menu,
            Icon = TrayIconFactory.Create(TrayVisualState.Stopped)
        };
        _tray.DoubleClick += async (_, _) => await OpenWallAsync();

        _timer.Tick += async (_, _) => await RefreshAsync();
        _timer.Start();
        _ = RefreshAsync();
    }

    private static ProcessStartInfo AgentStart(params string[] args)
    {
        var p = new ProcessStartInfo(AppPaths.NodeExe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        p.ArgumentList.Add(AppPaths.AgentScript);
        foreach (var a in args) p.ArgumentList.Add(a);
        p.Environment["OPERATOR_AGENT_STATE"] = AppPaths.StateFile;
        p.Environment["HOME"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var c = ConnectionConfig.Load();
        p.Environment["OPERATOR_AGENT_BASE_URL"] = c.BridgeUrl;
        p.Environment["OPERATOR_AGENT_HUB_URL"] = c.HubUrl;
        AgentHost.ConfigureRealRemoteEnvironment(p);
        return p;
    }

    private static async Task<(int Code, string Out, string Err)> AgentAsync(params string[] args)
    {
        using var p = new Process { StartInfo = AgentStart(args) };
        p.Start();
        var o = p.StandardOutput.ReadToEndAsync();
        var e = p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        return (p.ExitCode, await o, await e);
    }

    private static int Schtasks(params string[] args)
    {
        using var p = new Process
        {
            StartInfo = new ProcessStartInfo("schtasks.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };
        foreach (var arg in args) p.StartInfo.ArgumentList.Add(arg);
        p.Start();
        p.WaitForExit(6000);
        return p.HasExited ? p.ExitCode : -1;
    }

    private static bool TaskRunning()
    {
        try
        {
            using var p = new Process
            {
                StartInfo = new ProcessStartInfo("schtasks.exe")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                }
            };
            p.StartInfo.ArgumentList.Add("/Query");
            p.StartInfo.ArgumentList.Add("/TN");
            p.StartInfo.ArgumentList.Add(AgentTask);
            p.StartInfo.ArgumentList.Add("/FO");
            p.StartInfo.ArgumentList.Add("LIST");
            p.StartInfo.ArgumentList.Add("/V");
            p.Start();
            var text = p.StandardOutput.ReadToEnd();
            p.WaitForExit(3000);
            return p.ExitCode == 0 && text.Contains("Running", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static bool WallPortListening()
    {
        try
        {
            foreach (var ep in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
                if (ep.Port == 5491) return true;
            return false;
        }
        catch { return false; }
    }

    private static bool WaitForWall(bool listening, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (WallPortListening() == listening)
            {
                Thread.Sleep(150);
                if (WallPortListening() == listening) return true;
            }
            Thread.Sleep(120);
        }
        return WallPortListening() == listening;
    }

    private static IReadOnlyList<int> WallListenerPids()
    {
        var result = new HashSet<int>();
        try
        {
            using var p = new Process
            {
                StartInfo = new ProcessStartInfo("netstat.exe")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                }
            };
            p.StartInfo.ArgumentList.Add("-ano");
            p.StartInfo.ArgumentList.Add("-p");
            p.StartInfo.ArgumentList.Add("TCP");
            p.Start();
            var text = p.StandardOutput.ReadToEnd();
            p.WaitForExit(4000);
            foreach (var raw in text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = raw.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5 || !parts[0].Equals("TCP", StringComparison.OrdinalIgnoreCase)) continue;
                if (!parts[1].EndsWith(":5491", StringComparison.OrdinalIgnoreCase)) continue;
                if (!parts[3].Equals("LISTENING", StringComparison.OrdinalIgnoreCase)) continue;
                if (int.TryParse(parts[^1], out var pid) && pid > 0) result.Add(pid);
            }
        }
        catch { }
        return result.ToArray();
    }

    private static bool KillStaleWallListener()
    {
        var killed = false;
        foreach (var pid in WallListenerPids())
        {
            if (pid == Environment.ProcessId) continue;
            try
            {
                using var process = Process.GetProcessById(pid);
                var file = process.MainModule?.FileName ?? "";
                var expected = Path.GetFullPath(AppPaths.NodeExe);
                if (!process.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase)) continue;
                if (!Path.GetFullPath(file).Equals(expected, StringComparison.OrdinalIgnoreCase)) continue;
                ClientEvent("restart_stale_wall_owner_kill", new { pid, file });
                process.Kill(entireProcessTree: true);
                process.WaitForExit(4000);
                killed = true;
            }
            catch (Exception ex)
            {
                ClientEvent("restart_stale_wall_owner_kill_failed", new { pid, error = ex.Message });
            }
        }
        return killed;
    }

    private static (bool Ok, string Message) StopAgentTaskVerified()
    {
        var exitCode = Schtasks("/End", "/TN", AgentTask);
        ClientEvent("agent_stop_requested", new { exitCode });
        if (WaitForWall(false, 12000)) return (true, "");

        var killed = KillStaleWallListener();
        ClientEvent("agent_stop_stale_listener", new { killed });
        if (WaitForWall(false, 5000)) return (true, "");

        return (false, "Light Remote could not release Local Wall port 5491.");
    }

    private static (bool Ok, string Message) StartAgentTaskVerified()
    {
        if (WallPortListening()) return (true, "");

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            var exitCode = Schtasks("/Run", "/TN", AgentTask);
            ClientEvent("agent_start_attempt", new { attempt, exitCode });
            if (WaitForWall(true, 6000)) return (true, "");
            Thread.Sleep(350);
        }

        return (false, "Light Remote could not restore Local Wall on port 5491.");
    }

    private static (bool Ok, string Message) RestartAgentTransactional()
    {
        ClientEvent("restart_requested");
        var stateDir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Light Remote","Updater","state");
        var request=Path.Combine(stateDir,"restart-request.json");
        try
        {
            Directory.CreateDirectory(stateDir);
            File.WriteAllText(request,JsonSerializer.Serialize(new { requestedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),pid=Environment.ProcessId }));
            var exitCode=Schtasks("/Run","/TN",UpdateTask);
            ClientEvent("restart_updater_task_requested",new { exitCode });
            if(exitCode!=0)
            {
                try{File.Delete(request);}catch{}
                return (false,$"Light Remote updater task could not start (exit {exitCode}).");
            }
            var sawDown=WaitForWall(false,20000);
            var back=WaitForWall(true,45000);
            ClientEvent("restart_updater_task_observed",new { sawDown,back });
            // A still-listening old Wall is not proof that the Agent restarted.
            // Fail closed rather than claiming a new enrollment is live.
            return sawDown && back ? (true,"") :
                (false,sawDown ? "Light Remote did not return after restart." :
                    "Restart not verified: the previous Local Wall never went offline.");
        }
        catch(Exception ex)
        {
            try{File.Delete(request);}catch{}
            ClientEvent("restart_updater_task_failed",new { error=ex.Message });
            return (false,"Light Remote restart request failed.");
        }
    }

    private static void ClientEvent(string name, object? data = null)
    {
        try
        {
            var dir = Path.Combine(AppContext.BaseDirectory, "logs");
            Directory.CreateDirectory(dir);
            var line = JsonSerializer.Serialize(new
            {
                at = DateTimeOffset.UtcNow.ToString("O"),
                @event = name,
                pid = Environment.ProcessId,
                data
            });
            File.AppendAllText(Path.Combine(dir, "client-events.jsonl"), line + Environment.NewLine);
        }
        catch { }
    }

    private static TrayVisualState VisualFor(bool wallOnline, bool statusAvailable, bool enrolled, bool desired, string cloudState)
    {
        if (!wallOnline) return TrayVisualState.Stopped;
        if (!statusAvailable) return TrayVisualState.Disconnected;
        if (!enrolled) return TrayVisualState.Unlinked;
        if (desired && cloudState.Equals("connected", StringComparison.OrdinalIgnoreCase)) return TrayVisualState.Connected;
        if (!desired || cloudState.Equals("dormant", StringComparison.OrdinalIgnoreCase)) return TrayVisualState.Dormant;
        return TrayVisualState.Disconnected;
    }

    private static string LabelFor(bool wallOnline, bool taskRunning, TrayAgentSnapshot status)
    {
        if (!wallOnline) return taskRunning ? "Wall offline" : "Stopped";
        if (!status.StatusAvailable) return "Status unavailable";
        if (!status.Enrolled) return "Not linked";

        var connected = status.CloudDesiredConnected
            && status.CloudState.Equals("connected", StringComparison.OrdinalIgnoreCase);
        if (connected)
            return "Connected" + (string.IsNullOrWhiteSpace(status.Plan) ? "" : " | " + status.Plan.ToUpperInvariant());
        if (!status.CloudDesiredConnected || status.CloudState.Equals("dormant", StringComparison.OrdinalIgnoreCase))
            return "Wall online | Cloud dormant";
        return "Disconnected";
    }

    private static string TrimTrayText(string text)
        => text.Length <= 63 ? text : text[..63];

    private static string? FleetUrl(TrayAgentSnapshot status)
    {
        if (!status.StatusAvailable || !status.Enrolled) return null;
        return status.FleetHealthy ? (string.IsNullOrWhiteSpace(status.FleetUrl) ? LocalFleetUrl : status.FleetUrl) : null;
    }

    private static async Task<TrayAgentSnapshot> ReadSnapshotAsync()
    {
        var r = await AgentAsync("status");
        if (r.Code != 0)
            return new(false, false, false, "", "", r.Err.Trim(), false, null);

        using var d = JsonDocument.Parse(r.Out);
        var root = d.RootElement;
        var enrolled = root.TryGetProperty("enrolled", out var en) && en.ValueKind == JsonValueKind.True;
        var desired = root.TryGetProperty("cloudDesiredConnected", out var dc) && dc.ValueKind == JsonValueKind.True;
        var cloudState = root.TryGetProperty("cloudState", out var cs) ? cs.GetString() ?? "" : "";
        var plan = root.TryGetProperty("connectionPlan", out var cp) ? cp.GetString() ?? "" : "";
        var pendingId = root.TryGetProperty("pendingEnrollmentId", out var pending) && pending.ValueKind == JsonValueKind.String ? pending.GetString() : null;
        var lastError = root.TryGetProperty("lastCloudError", out var le) ? le.GetString() ?? "" : "";
        var fleetHealthy = false;
        string? fleetUrl = null;
        if (root.TryGetProperty("fleetWall", out var fw) && fw.ValueKind == JsonValueKind.Object)
        {
            fleetHealthy = fw.TryGetProperty("healthy", out var fh) && fh.ValueKind == JsonValueKind.True;
            fleetUrl = fw.TryGetProperty("publicUrl", out var fu) && fu.ValueKind == JsonValueKind.String ? fu.GetString() : null;
        }
        return new(true, enrolled, desired, cloudState, plan, lastError, fleetHealthy, fleetUrl, pendingId);
    }

    private void SetActionStatus(string message, int seconds = 8)
    {
        _actionStatus = message;
        _actionStatusUntil = DateTimeOffset.UtcNow.AddSeconds(seconds);
    }

    private string EffectiveLabel(string normal)
    {
        if (!string.IsNullOrWhiteSpace(_actionStatus) && DateTimeOffset.UtcNow < _actionStatusUntil)
            return _actionStatus;
        _actionStatus = null;
        return normal;
    }

    private async Task RefreshAsync()
    {
        if (_busy) return;
        _busy = true;
        var hasPendingEnrollment = false;
        try
        {
            var status = await ReadSnapshotAsync();
            hasPendingEnrollment = status.StatusAvailable && !string.IsNullOrWhiteSpace(status.PendingEnrollmentId);
            var wallOnline = WallPortListening();
            var taskRunning = TaskRunning();
            var visual = VisualFor(wallOnline, status.StatusAvailable, status.Enrolled, status.CloudDesiredConnected, status.CloudState);
            var connected = status.StatusAvailable
                && status.Enrolled
                && status.CloudDesiredConnected
                && status.CloudState.Equals("connected", StringComparison.OrdinalIgnoreCase);

            var label = EffectiveLabel(hasPendingEnrollment ? "Waiting for account approval" : LabelFor(wallOnline, taskRunning, status));
            _state.Text = label;
            _connect.Text = connected ? "Disconnect" : "Connect";
            _connect.Enabled = wallOnline && status.StatusAvailable && status.Enrolled;
            _restart.Enabled = wallOnline;
            _serviceToggle.Text = wallOnline ? "Stop Light Remote" : "Start Light Remote";
            _account.Text = status.Enrolled ? "Manage Account" : "Sign in / Manage Account";
            _relink.Text = status.Enrolled ? "Relink this Windows PC…" : "Link this Windows PC…";
            _relink.Enabled = status.StatusAvailable && !hasPendingEnrollment && !_enrollmentStarting;

            _fleetUrl = FleetUrl(status);
            _openFleet.Visible = _fleetUrl is not null;
            _openFleet.Enabled = _fleetUrl is not null;

            var title = TrimTrayText("Light Remote - " + label);
            _tray.Text = title;
            var old = _tray.Icon;
            _tray.Icon = TrayIconFactory.Create(visual);
            old?.Dispose();
        }
        catch (Exception ex)
        {
            var wallOnline = WallPortListening();
            _state.Text = EffectiveLabel(wallOnline ? "Status unavailable" : "Stopped");
            _connect.Enabled = false;
            _relink.Enabled = false;
            _restart.Enabled = wallOnline;
            _serviceToggle.Text = wallOnline ? "Stop Light Remote" : "Start Light Remote";
            var old = _tray.Icon;
            _tray.Icon = TrayIconFactory.Create(wallOnline ? TrayVisualState.Disconnected : TrayVisualState.Stopped);
            old?.Dispose();
            ClientEvent("tray_refresh_failed", new { error = ex.Message });
        }
        finally
        {
            _busy = false;
            if (hasPendingEnrollment && !_enrollmentStarting) _ = PollEnrollmentIfNeededAsync();
        }
    }

    // Relink follows the macOS flow: keep the Ed25519 device identity and local
    // settings, issue a fresh account-approval code, then apply after approval.
    internal static string[] EnrollmentCommand(bool previouslyEnrolled) =>
        previouslyEnrolled ? new[] { "login", "--reenroll", "--no-wait" } : new[] { "login", "--no-wait" };

    private static string AgentLine(string output, string prefix)
    {
        foreach (var raw in output.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return line[prefix.Length..].Trim();
        }
        return "";
    }

    // Gold UAT can advertise a loopback activation URL (the Operator's own
    // localhost:5583). That URL does not resolve to the Operator from a
    // customer's Windows machine. Preserve only its bounded enrollment ID,
    // then link to the configured HTTPS Bridge; never follow an arbitrary URL.
    internal static Uri? TrustedEnrollmentActivationUrl(string raw, string bridgeUrl)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var source) ||
            !Uri.TryCreate(bridgeUrl, UriKind.Absolute, out var bridge) ||
            bridge.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(bridge.UserInfo) ||
            !string.IsNullOrEmpty(source.UserInfo) || source.Fragment.Length > 0 ||
            source.AbsolutePath != "/enroll")
            return null;

        var match = Regex.Match(source.Query, @"^\?id=(enr_[A-Za-z0-9-]{24,80})$",
            RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
        if (!match.Success) return null;

        var trustedPublic = source.Scheme == Uri.UriSchemeHttps &&
            source.IdnHost.Equals(bridge.IdnHost, StringComparison.OrdinalIgnoreCase) &&
            source.Port == bridge.Port;
        var knownLocalOperator = source.Scheme == Uri.UriSchemeHttp &&
            source.IsLoopback && source.Port == 5583;
        if (!trustedPublic && !knownLocalOperator) return null;

        var result = new UriBuilder(bridge.Scheme, bridge.Host, bridge.Port,
            "/enroll", "?id=" + Uri.EscapeDataString(match.Groups[1].Value));
        return result.Uri;
    }

    private async Task RelinkWindowsAsync()
    {
        if (_busy || _enrollmentStarting) return;
        _busy = true;
        _enrollmentStarting = true;
        try
        {
            var status = await ReadSnapshotAsync();
            if (!status.StatusAvailable) { SetActionStatus("Device Agent unavailable"); return; }
            if (!string.IsNullOrWhiteSpace(status.PendingEnrollmentId))
            {
                SetActionStatus("Device approval already pending", 8);
                return;
            }
            if (status.Enrolled)
            {
                var confirmation = MessageBox.Show(
                    "A new one-time device code will be issued. The existing device identity, Memory and local settings are preserved.\n\n" +
                    "Your account link changes only when you sign in and approve this Windows PC in the browser.\n\n" +
                    "Relink this Windows PC?",
                    "Light Remote — Relink this Windows PC",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                if (confirmation != DialogResult.Yes) return;
            }

            SetActionStatus("Preparing device approval…", 15);
            var command = EnrollmentCommand(status.Enrolled);
            var result = await AgentAsync(command);
            var activation = AgentLine(result.Out, "Activation URL:");
            var code = AgentLine(result.Out, "Device code:");
            var url = TrustedEnrollmentActivationUrl(activation, ConnectionConfig.Load().BridgeUrl);
            if (result.Code != 0 || url is null || string.IsNullOrWhiteSpace(code))
            {
                ClientEvent("tray_relink_begin_failed", new { result.Code });
                SetActionStatus("Could not start device approval", 12);
                MessageBox.Show("Unable to start device linking.\n\n" +
                    (result.Err.Length > 0 ? result.Err[..Math.Min(result.Err.Length, 360)] : "Please try again."),
                    "Light Remote — Device linking", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var copied = false;
            try { Clipboard.SetText(code); copied = true; } catch { /* Code is shown below even without clipboard. */ }
            ClientEvent("tray_relink_started", new { wasEnrolled = status.Enrolled });
            MessageBox.Show("One-time device code:\n\n" + code + "\n\n" +
                (copied ? "The code has been copied to your clipboard.\n\n" : "Copy the code shown above.\n\n") +
                "Click OK to open the approval page. Sign in with the intended Light Remote account, review permissions, and approve this Windows PC.\n\n" +
                "Light Remote will complete relinking and reconnect the approved device automatically after approval.",
                "Light Remote — Approve this Windows PC", MessageBoxButtons.OK, MessageBoxIcon.Information);
            OpenUrl(url.AbsoluteUri, "tray_relink_activation_open_failed");
            SetActionStatus("Waiting for account approval", 15);
        }
        catch (Exception ex)
        {
            ClientEvent("tray_relink_begin_exception", new { error = ex.GetType().Name });
            SetActionStatus("Device linking failed", 10);
            MessageBox.Show("Unable to begin device linking. Please check the installed Agent and try again.",
                "Light Remote — Device linking", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            _enrollmentStarting = false;
            _busy = false;
            await RefreshAsync();
        }
    }

    private async Task PollEnrollmentIfNeededAsync()
    {
        if (_enrollmentPollInFlight || _enrollmentStarting) return;
        _enrollmentPollInFlight = true;
        var completing = false;
        try
        {
            var response = await AgentAsync("poll");
            if (response.Code != 0) { ClientEvent("tray_relink_poll_failed", new { response.Code }); return; }
            using var document = JsonDocument.Parse(response.Out);
            var root = document.RootElement;
            var state = root.TryGetProperty("state", out var value) ? value.GetString() : "";
            if (state == "approved")
            {
                ClientEvent("tray_relink_approved");
                SetActionStatus("Device approved — restarting Agent…", 30);
                _busy = true;
                completing = true;
                var restart = await Task.Run(RestartAgentTransactional);
                var connected = false;
                if (restart.Ok)
                {
                    // Only the user-triggered Tray approval flow opts in to
                    // connecting the newly approved account. CLI and Local Wall
                    // polling continue to fail closed with Cloud dormant.
                    try
                    {
                        var cloud = await AgentAsync("connect");
                        if (cloud.Code == 0)
                        {
                            var newState = await ReadSnapshotAsync();
                            connected = newState.Enrolled && newState.CloudDesiredConnected
                                && newState.CloudState.Equals("connected", StringComparison.OrdinalIgnoreCase);
                        }
                        if (!connected) ClientEvent("tray_relink_cloud_reconnect_failed", new { cloud.Code });
                    }
                    catch (Exception error)
                    {
                        ClientEvent("tray_relink_cloud_reconnect_failed", new { error = error.GetType().Name });
                    }
                }
                SetActionStatus(connected ? "Device linked and connected" :
                    restart.Ok ? "Linked — select Connect to go online" : "Approved — restart Agent manually", 12);
                MessageBox.Show(connected
                        ? "Device approved. The Agent restarted with the new enrollment, and Cloud connection is active."
                        : restart.Ok
                            ? "Device approved and Agent restarted, but Cloud is not connected. Select Connect from the Tray menu."
                            : "Device approved, but Agent restart was not verified. Select Restart Light Remote, then Connect from the Tray menu.",
                    "Light Remote — Device approved", MessageBoxButtons.OK,
                    connected ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
            }
            else if (state is "expired" or "replaced" or "cancelled")
            {
                SetActionStatus("Device code expired — select Relink again", 12);
                ClientEvent("tray_relink_code_ended", new { state });
            }
        }
        catch (Exception ex)
        {
            ClientEvent("tray_relink_poll_exception", new { error = ex.GetType().Name });
        }
        finally
        {
            // The regular 5-second Tray timer schedules the next attempt.
            // Refreshing here would immediately recurse into another poll.
            _enrollmentPollInFlight = false;
            if (completing) _busy = false;
        }
    }

    private async Task ToggleConnectionAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            var status = await ReadSnapshotAsync();
            if (!status.StatusAvailable || !status.Enrolled || !WallPortListening())
            {
                SetActionStatus("Cloud control unavailable");
                return;
            }

            var connected = status.CloudDesiredConnected
                && status.CloudState.Equals("connected", StringComparison.OrdinalIgnoreCase);
            ClientEvent("cloud_toggle_requested", new { from = connected ? "connected" : "dormant" });
            var result = await AgentAsync(connected ? "disconnect" : "connect");
            ClientEvent("cloud_toggle_completed", new { exitCode = result.Code });
            if (result.Code != 0) SetActionStatus("Cloud action failed");
        }
        catch (Exception ex)
        {
            SetActionStatus("Cloud action failed");
            ClientEvent("cloud_toggle_failed", new { error = ex.Message });
        }
        finally
        {
            _busy = false;
            await RefreshAsync();
        }
    }

    private async Task ToggleServiceAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            var stopping = WallPortListening();
            var outcome = await Task.Run(() => stopping ? StopAgentTaskVerified() : StartAgentTaskVerified());
            ClientEvent("service_toggle_completed", new { stopping, outcome.Ok, outcome.Message });
            if (!outcome.Ok) SetActionStatus(stopping ? "Stop failed" : "Start failed");
            else SetActionStatus(stopping ? "Light Remote stopped" : "Light Remote started", 4);
        }
        catch (Exception ex)
        {
            SetActionStatus("Service action failed");
            ClientEvent("service_toggle_failed", new { error = ex.Message });
        }
        finally
        {
            _busy = false;
            await RefreshAsync();
        }
    }

    private async Task RestartLightRemoteAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            SetActionStatus("Restarting Light Remote...", 20);
            var outcome = await Task.Run(RestartAgentTransactional);
            if (outcome.Ok) SetActionStatus("Light Remote restarted", 5);
            else SetActionStatus("Restart failed - see logs", 10);
        }
        catch (Exception ex)
        {
            SetActionStatus("Restart failed - see logs", 10);
            ClientEvent("restart_failed", new { error = ex.Message });
        }
        finally
        {
            _busy = false;
            await RefreshAsync();
        }
    }

    private async Task CheckForUpdatesAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            var exitCode = await Task.Run(() => Schtasks("/Run", "/TN", UpdateTask));
            ClientEvent("update_check_requested", new { exitCode });
            SetActionStatus(exitCode == 0 ? "Update check requested" : "Update check failed", 5);
        }
        catch (Exception ex)
        {
            SetActionStatus("Update check failed", 8);
            ClientEvent("update_check_failed", new { error = ex.Message });
        }
        finally
        {
            _busy = false;
            await RefreshAsync();
        }
    }

    private async Task OpenWallAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            if (!WallPortListening())
            {
                SetActionStatus("Starting Light Remote...", 15);
                var started = await Task.Run(StartAgentTaskVerified);
                if (!started.Ok)
                {
                    SetActionStatus("Local Wall unavailable", 10);
                    ClientEvent("wall_open_restore_failed", new { started.Message });
                    return;
                }
            }
            OpenUrl(WallUrl, "wall_open_failed");
        }
        finally
        {
            _busy = false;
            await RefreshAsync();
        }
    }

    private void OpenFleet()
    {
        if (string.IsNullOrWhiteSpace(_fleetUrl)) return;
        OpenUrl(_fleetUrl, "fleet_open_failed");
    }

    private static void OpenUrl(string url, string failureEvent)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { ClientEvent(failureEvent, new { error = ex.Message, url }); }
    }

    internal static bool RelinkRuntimeSelfTest()
    {
        const string bridge = ConnectionConfig.DefaultBridgeUrl;
        const string token = "enr_e339c5b1-815d-44a9-8360-c097073b615f";
        var gold = TrustedEnrollmentActivationUrl(
            "https://gold.light-remote.thaiduy.digital/enroll?id=" + token, bridge);
        var loopback = TrustedEnrollmentActivationUrl(
            "http://127.0.0.1:5583/enroll?id=" + token, bridge);
        var localhost = TrustedEnrollmentActivationUrl(
            "http://localhost:5583/enroll?id=" + token, bridge);
        var expected = bridge + "/enroll?id=" + token;
        var p = AgentStart("status");
        var companion = Path.Combine(AppContext.BaseDirectory, "realremote-v2", "LightRemote.RM.exe");
        var present = File.Exists(companion);
        var realRemoteSelected = p.Environment.TryGetValue("LIGHT_REMOTE_REAL_REMOTE", out var enabled)
            && enabled == "1";
        var pathSelected = p.Environment.TryGetValue("LIGHT_REMOTE_CLIENT_EXE", out var actual)
            && string.Equals(actual, companion, StringComparison.OrdinalIgnoreCase);
        return gold?.AbsoluteUri == expected && loopback?.AbsoluteUri == expected
            && localhost?.AbsoluteUri == expected
            && TrustedEnrollmentActivationUrl("https://evil.example/enroll?id=" + token, bridge) is null
            && TrustedEnrollmentActivationUrl("http://192.0.2.10:5583/enroll?id=" + token, bridge) is null
            && TrustedEnrollmentActivationUrl("http://127.0.0.1:9999/enroll?id=" + token, bridge) is null
            && TrustedEnrollmentActivationUrl("http://127.0.0.1:5583/other?id=" + token, bridge) is null
            && TrustedEnrollmentActivationUrl("http://127.0.0.1:5583/enroll?id=" + token + "&next=evil", bridge) is null
            && realRemoteSelected == present && pathSelected == present;
    }

    internal static bool SelfTest()
    {
        var connected = new TrayAgentSnapshot(true, true, true, "connected", "vip", "", true, "https://fleet.example/");
        var dormant = connected with { CloudDesiredConnected = false, CloudState = "dormant" };
        var disconnected = connected with { CloudState = "error" };
        return RelinkRuntimeSelfTest()
            && VisualFor(false, true, true, true, "connected") == TrayVisualState.Stopped
            && VisualFor(true, true, false, false, "dormant") == TrayVisualState.Unlinked
            && VisualFor(true, true, true, true, "connected") == TrayVisualState.Connected
            && VisualFor(true, true, true, false, "dormant") == TrayVisualState.Dormant
            && VisualFor(true, true, true, true, "error") == TrayVisualState.Disconnected
            && LabelFor(true, true, connected) == "Connected | VIP"
            && LabelFor(true, true, dormant) == "Wall online | Cloud dormant"
            && LabelFor(true, true, disconnected) == "Disconnected"
            && FleetUrl(connected) == "https://fleet.example/"
            && FleetUrl(connected with { FleetUrl = null }) == LocalFleetUrl
            && FleetUrl(connected with { FleetHealthy = false }) is null
            && FleetUrl(connected with { Enrolled = false, FleetHealthy = false }) is null
            && EnrollmentCommand(true).SequenceEqual(new[] { "login", "--reenroll", "--no-wait" })
            && EnrollmentCommand(false).SequenceEqual(new[] { "login", "--no-wait" });
    }

    protected override void ExitThreadCore()
    {
        ClientEvent("tray_stopped");
        _timer.Stop();
        _timer.Dispose();
        _tray.Visible = false;
        _tray.Icon?.Dispose();
        _tray.Dispose();
        base.ExitThreadCore();
    }
}
