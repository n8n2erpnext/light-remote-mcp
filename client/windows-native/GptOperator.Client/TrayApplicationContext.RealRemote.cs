using System.Diagnostics;
using System.Text.Json;

namespace GptOperator.Client;

internal sealed partial class TrayApplicationContext
{
    private readonly ToolStripMenuItem _remote = new("Real Remote · checking…") { Enabled = false, Visible = false };
    private readonly ToolStripMenuItem _remotePermissions = new("Real Remote permissions", null, (_, _) => OpenRemotePermissions()) { Visible = false };
    private readonly RemoteControlCursorHalo _remoteCursorHalo = new();
    private readonly System.Windows.Forms.Timer _remoteActivityTimer = new() { Interval = 150 };
    private static readonly string RemoteActivityFile = Path.Combine(Path.GetDirectoryName(AppPaths.StateFile)!, "real-remote-activity.json");

    private string _remoteMode = "idle";
    private bool _remoteAvailable;
    private bool _remoteEnabled;
    private bool _remoteControlAllowed;
    private long _remoteControlTtlMs = 8000;
    private long _remoteActivityWriteTicks = -1;
    private long _remoteLastControlAt;

    private static void OpenRemotePermissions()
    {
        try { Process.Start(new ProcessStartInfo(WallUrl + "permissions") { UseShellExecute = true }); }
        catch { }
    }

    private void InitializeRealRemoteIndicator()
    {
        _remoteActivityTimer.Tick += (_, _) => RefreshRemoteControlHaloFromActivity();
        _remoteActivityTimer.Start();
    }

    private void DisposeRealRemoteIndicator()
    {
        _remoteActivityTimer.Stop();
        _remoteActivityTimer.Dispose();
        _remoteCursorHalo.SetActive(false);
        _remoteCursorHalo.Dispose();
    }

    private void ResetRealRemoteIndicator()
    {
        _remoteAvailable = false;
        _remoteEnabled = false;
        _remoteControlAllowed = false;
        _remoteCursorHalo.SetActive(false);
    }

    private void ApplyRealRemoteState(JsonElement root)
    {
        var available = false;
        var enabled = false;
        var control = false;
        var mode = "idle";

        if (root.TryGetProperty("realRemote", out var rr) && rr.ValueKind == JsonValueKind.Object)
        {
            available = rr.TryGetProperty("available", out var a) && a.GetBoolean();
            enabled = rr.TryGetProperty("enabled", out var e) && e.GetBoolean();
            control = rr.TryGetProperty("controlAllowed", out var c) && c.GetBoolean();
            mode = rr.TryGetProperty("mode", out var m) ? m.GetString() ?? "idle" : "idle";
            if (mode != "viewing" && mode != "controlling") mode = "idle";

            if (rr.TryGetProperty("controlTtlMs", out var ttl) &&
                ttl.TryGetInt64(out var ttlMs) &&
                ttlMs >= 1000 &&
                ttlMs <= 600000)
            {
                _remoteControlTtlMs = ttlMs;
            }
        }

        _remoteAvailable = available;
        _remoteEnabled = enabled;
        _remoteControlAllowed = control;
        _remote.Visible = available;
        _remotePermissions.Visible = available;
        _remote.Text = !enabled
            ? "Real Remote · Off"
            : mode == "controlling"
                ? "Real Remote · Agent controlling"
                : mode == "viewing"
                    ? "Real Remote · Agent viewing"
                    : control
                        ? "Real Remote · Ready · control allowed"
                        : "Real Remote · Ready · view only";

        // Remote state is intentionally ambient: no balloon/toast interruption.
        _remoteCursorHalo.SetActive(available && enabled && control && mode == "controlling");
        _remoteMode = available && enabled ? mode : "idle";
    }

    private void RefreshRemoteControlHaloFromActivity()
    {
        if (!_remoteAvailable || !_remoteEnabled || !_remoteControlAllowed)
        {
            _remoteCursorHalo.SetActive(false);
            return;
        }

        try
        {
            var info = new FileInfo(RemoteActivityFile);
            if (!info.Exists)
            {
                _remoteLastControlAt = 0;
                _remoteCursorHalo.SetActive(false);
                return;
            }

            var writeTicks = info.LastWriteTimeUtc.Ticks;
            if (writeTicks != _remoteActivityWriteTicks)
            {
                _remoteActivityWriteTicks = writeTicks;
                using var document = JsonDocument.Parse(File.ReadAllText(RemoteActivityFile));
                var root = document.RootElement;
                _remoteLastControlAt =
                    root.TryGetProperty("lastControlAt", out var value) && value.TryGetInt64(out var at)
                        ? Math.Max(0, at)
                        : 0;
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var controlling =
                _remoteLastControlAt > 0 &&
                now >= _remoteLastControlAt &&
                now - _remoteLastControlAt <= _remoteControlTtlMs;
            _remoteCursorHalo.SetActive(controlling);
        }
        catch
        {
            // Activity is written atomically but a transient read failure should fail quiet.
            _remoteCursorHalo.SetActive(false);
        }
    }

    private string RemoteTooltipSuffix() =>
        _remoteMode == "controlling"
            ? " · Agent controlling"
            : _remoteMode == "viewing"
                ? " · Agent viewing"
                : "";
}
