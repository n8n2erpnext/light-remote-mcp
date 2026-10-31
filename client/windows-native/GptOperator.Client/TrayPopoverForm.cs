using System.Reflection;

namespace GptOperator.Client;

// Native Windows implementation of Moryqa screens/tray-v3/windows/01-connected
// (500x740 popover). The light counterpart is generated from the same geometry
// using Windows AppsUseLightTheme; no separate account/theme preference.
//
// NOTE: Actual signed authorized Agent sessions are only exposed in Local Wall.
// We show a link rather than inventing a session count or nickname.
internal sealed class TrayPopoverForm : Form
{
    private readonly Func<string, Task> _dispatch;
    private TrayAgentSnapshot _status = new(false, false, false, "", "", "", false, null);
    private TrayVisualState _visual = TrayVisualState.Stopped;
    private bool _wallOnline;
    private bool _connected;
    private bool _fleetReady;
    private bool _advanced;
    private static readonly Dictionary<TrayVisualState, Image> Icons = new();

    public TrayPopoverForm(Func<string, Task> dispatch)
    {
        _dispatch = dispatch ?? throw new ArgumentNullException(nameof(dispatch));
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(500, 740);
        // Popup coordinates are in physical pixels; WinForms DPI autoscales
        // text controls but NOT the authored card geometry consistently.
        // On owner's Windows 10 DPI=144 (150%), this clipped headers/buttons.
        // Keep a pixel grid and use explicit pixel fonts for visual labels.
        AutoScaleMode = AutoScaleMode.None;
        BackColor = UiTheme.Border;
        Padding = new Padding(2);
        AccessibleName = "Light Remote tray";
    }

    public void UpdateState(TrayAgentSnapshot status, TrayVisualState visual,
        bool wallOnline, bool connected, bool fleetReady)
    {
        _status = status;
        _visual = visual;
        _wallOnline = wallOnline;
        _connected = connected;
        _fleetReady = fleetReady;
        if (Visible) Render();
    }

    public void Toggle(Point anchor)
    {
        if (Visible) { Hide(); return; }
        _advanced = false;
        Render();
        var area = Screen.FromPoint(anchor).WorkingArea;
        var width = Math.Min(Width, area.Width);
        var height = Math.Min(Height, area.Height);
        Location = new Point(
            Math.Clamp(anchor.X - width + 32, area.Left, area.Right - width),
            Math.Clamp(anchor.Y - height - 12, area.Top, area.Bottom - height));
        Show();
        Activate();
    }

    // CI/owner screenshot probe. Does not pair or change a device, requires
    // no Agent, and can render both pages using the exact native WinForms tree.
    internal void SavePreview(string filename, bool advanced)
    {
        _advanced = advanced;
        Render();
        using var output = new Bitmap(ClientSize.Width, ClientSize.Height);
        DrawToBitmap(output, new Rectangle(Point.Empty, ClientSize));
        output.Save(filename, System.Drawing.Imaging.ImageFormat.Png);
    }

    internal void AssertLayoutFits()
    {
        Render();
        VerifyBounds(this, "popover");
        _advanced = true;
        Render();
        VerifyBounds(this, "advanced");
    }

    private static void VerifyBounds(Control container, string prefix)
    {
        foreach (Control child in container.Controls)
        {
            var bounds = child.Bounds;
            if (bounds.Left < 0 || bounds.Top < 0 ||
                bounds.Right > container.ClientSize.Width + 1 ||
                bounds.Bottom > container.ClientSize.Height + 1)
                throw new InvalidOperationException(
                    "tray_ui_layout_overflow:" + prefix + "/" + child.Name +
                    ":" + bounds + " inside " + container.ClientSize);
            VerifyBounds(child, prefix);
        }
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        if (Visible) Hide();
    }

    private static Image IconFor(TrayVisualState state)
    {
        if (Icons.TryGetValue(state, out var existing)) return existing;
        var key = "LightRemoteTray." + state.ToString().ToLowerInvariant() + ".png";
        using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(key)
            ?? throw new InvalidOperationException("Missing Moryqa artwork: " + key);
        using var image = Image.FromStream(source);
        var bitmap = new Bitmap(image);
        Icons[state] = bitmap;
        return bitmap;
    }

    private static RoundedPanel Card(Control parent, int x, int y, int width, int height)
    {
        var panel = new RoundedPanel
        {
            Location = new Point(x, y),
            Size = new Size(width, height),
            BackColor = UiTheme.SurfaceAlt,
            BorderColor = UiTheme.Border,
            Radius = 13,
            Padding = Padding.Empty
        };
        parent.Controls.Add(panel);
        return panel;
    }

    // Figma coordinates and heights here are physical pixels, so font height
    // must be pixel-based too. 1pt = 96/72px at the authored baseline, with
    // no additional 150%-DPI inflation from Windows. All labels are readable
    // at 100%, 125%, 150% and 200% system display scaling.
    private static Font PopoverFont(float pointAtReferenceDpi, bool bold)
        => new("Segoe UI", pointAtReferenceDpi * (96f / 72f),
            bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel);

    private static Label TextLine(Control parent, string content,
        int x, int y, int width, int height, float size, Color color,
        bool bold = false, ContentAlignment alignment = ContentAlignment.MiddleLeft)
    {
        var label = new Label
        {
            Text = content,
            Location = new Point(x, y),
            Size = new Size(width, height),
            Font = PopoverFont(size, bold),
            ForeColor = color,
            BackColor = Color.Transparent,
            AutoSize = false,
            TextAlign = alignment,
            AutoEllipsis = true,
            UseMnemonic = false
        };
        parent.Controls.Add(label);
        return label;
    }

    private void Action(Control parent, string caption, string code,
        int x, int y, int width, int height, bool enabled = true)
    {
        var button = new Button
        {
            Text = caption,
            Location = new Point(x, y),
            Size = new Size(width, height),
            Enabled = enabled,
            FlatStyle = FlatStyle.Flat,
            BackColor = UiTheme.SurfaceAlt,
            ForeColor = UiTheme.Text,
            Font = PopoverFont(9.5f, true),
            TextAlign = ContentAlignment.MiddleCenter,
            UseVisualStyleBackColor = false,
            Cursor = enabled ? Cursors.Hand : Cursors.Default,
            AccessibleName = caption
        };
        button.FlatAppearance.BorderColor = UiTheme.Border;
        button.FlatAppearance.MouseOverBackColor = UiTheme.IsDark
            ? Color.FromArgb(44, 56, 73) : Color.FromArgb(234, 241, 255);
        parent.Controls.Add(button);
        button.Click += async (_, _) =>
        {
            if (code == "more" || code == "overview")
            {
                _advanced = code == "more";
                Render();
                return;
            }
            Hide();
            try { await _dispatch(code); }
            catch { /* The owning TrayApplicationContext logs action failures. */ }
        };
    }

    private static Color StatusColor(TrayVisualState state) => state switch
    {
        TrayVisualState.Connected => UiTheme.Success,
        TrayVisualState.Disconnected => UiTheme.Danger,
        TrayVisualState.Dormant => UiTheme.Warning,
        _ => UiTheme.Muted
    };

    private static string StatusText(TrayVisualState state) => state switch
    {
        TrayVisualState.Connected => "Connected",
        TrayVisualState.Disconnected => "Disconnected",
        TrayVisualState.Dormant => "Cloud dormant",
        TrayVisualState.Unlinked => "Not linked",
        _ => "Stopped"
    };

    // Advanced actions are rendered in the SAME native Figma-styled popover.
    // Do not open the legacy white ContextMenuStrip from More actions.
    private void RenderAdvanced(Control root)
    {
        TextLine(root, "Light Remote", 24, 19, 420, 29, 16f, UiTheme.Text, bold: true);
        TextLine(root, "Device controls · " + StatusText(_visual), 24, 57,
            430, 26, 10.5f, UiTheme.Muted);
        Card(root, 23, 95, 452, 1);
        Action(root, "‹  Back to overview", "overview", 23, 112, 452, 37);
        TextLine(root, "ACCOUNT", 24, 171, 430, 23, 10f, UiTheme.Muted, bold: true);
        Action(root, "Manage Account", "account", 23, 205, 452, 41);
        Action(root, "Open Local Wall", "wall", 23, 255, 219, 41, _wallOnline);
        Action(root, "Open Fleet", "fleet", 259, 255, 219, 41, _fleetReady);

        TextLine(root, "DEVICE CONTROLS", 24, 316, 430, 23, 10f, UiTheme.Muted, bold: true);
        Action(root, _connected ? "Disconnect" : "Connect", "connect",
            23, 351, 219, 42, _wallOnline && _status.Enrolled);
        if (!_connected)
            Action(root, "Link / Relink device", "relink",
                259, 351, 219, 42, _wallOnline);
        else
            Action(root, "Approve Agent / Manage", "approval",
                259, 351, 219, 42, _wallOnline);
        Action(root, "Restart Light Remote", "restart", 23, 402, 219, 42);
        Action(root, "Stop Light Remote", "service", 259, 402, 219, 42);
        Action(root, "Check for updates", "updates", 23, 453, 452, 42);
        Card(root, 23, 524, 452, 1);
        TextLine(root, "Installed locally · Device identity stays on this PC",
            25, 545, 445, 24, 10f, UiTheme.Muted);
        TextLine(root, "Background Agent remains active if you close this UI.",
            25, 576, 445, 41, 10f, UiTheme.Muted);
        Action(root, "Exit Tray UI", "quit", 23, 661, 452, 46);
    }

    private void Render()
    {
        SuspendLayout();
        Controls.Clear();
        BackColor = UiTheme.Border;
        var root = new RoundedPanel
        {
            Location = new Point(1, 1),
            Size = new Size(ClientSize.Width - 2, ClientSize.Height - 2),
            BackColor = UiTheme.Surface,
            BorderColor = UiTheme.Border,
            Radius = 21,
            Padding = Padding.Empty
        };
        Controls.Add(root);
        if (_advanced)
        {
            RenderAdvanced(root);
            ResumeLayout();
            return;
        }

        var logo = new PictureBox
        {
            Location = new Point(23, 19),
            Size = new Size(45, 45),
            Image = IconFor(_visual),
            SizeMode = PictureBoxSizeMode.Zoom,
            BackColor = Color.Transparent
        };
        root.Controls.Add(logo);
        TextLine(root, "Light Remote", 80, 17, 260, 25, 13.5f, UiTheme.Text, bold: true);
        var device = string.IsNullOrWhiteSpace(_status.DeviceName)
            ? "Windows device" : _status.DeviceName;
        TextLine(root, device, 81, 44, 380, 22, 9.5f, UiTheme.Muted);
        Card(root, 23, 83, 452, 1);

        var state = Card(root, 23, 100, 454, 121);
        var stateColor = StatusColor(_visual);
        TextLine(state, "●", 19, 14, 24, 27, 15f, stateColor);
        TextLine(state, StatusText(_visual), 42, 13, 290, 27, 16f, UiTheme.Text, bold: true);
        TextLine(state, _wallOnline
            ? (_connected ? "Cloud online · Agent running" : "Local Wall online · Agent running")
            : "Local Wall unavailable", 21, 50, 410, 19, 9.5f, UiTheme.Muted);
        var on = _wallOnline && _connected;
        TextLine(state, on ? "ON" : "OFF", 370, 15, 65, 24, 9.5f,
            on ? UiTheme.Success : UiTheme.Warning, bold: true,
            alignment: ContentAlignment.MiddleRight);
        Card(state, 16, 82, 422, 1);
        var plan = string.IsNullOrWhiteSpace(_status.Plan) ? "Light Remote" : _status.Plan.ToUpperInvariant();
        TextLine(state, plan + " plan   ·   Secured connection", 20, 88, 420, 20, 8.5f, UiTheme.Muted);

        TextLine(root, "OVERVIEW", 24, 247, 430, 20, 8.5f, UiTheme.Muted, bold: true);
        var agents = Card(root, 23, 276, 454, 127);
        TextLine(agents, "Authorized sessions", 20, 16, 265, 24, 11f, UiTheme.Text, bold: true);
        TextLine(agents, "View all  ›", 335, 18, 100, 20, 9.5f, UiTheme.Success,
            alignment: ContentAlignment.MiddleRight);
        Card(agents, 16, 50, 422, 1);
        TextLine(agents, _status.Enrolled
            ? "Manage active AI agents in Local Wall"
            : "Link your Windows PC to authorize agents", 20, 65, 410, 26, 9.5f, UiTheme.Text);
        Action(agents, "View sessions", "wall", 20, 97, 132, 26, _wallOnline);

        TextLine(root, "QUICK ACCESS", 24, 424, 430, 20, 8.5f, UiTheme.Muted, bold: true);
        Action(root, "Local Wall", "wall", 23, 458, 219, 42, _wallOnline);
        Action(root, _fleetReady ? "Fleet" : (_connected ? "Disconnect" : "Connect"),
            _fleetReady ? "fleet" : "connect", 259, 458, 219, 42,
            _fleetReady || (_wallOnline && _status.Enrolled));

        TextLine(root, "DEVICE", 24, 524, 430, 20, 8.5f, UiTheme.Muted, bold: true);
        var deviceCard = Card(root, 23, 558, 454, 104);
        TextLine(deviceCard, "Device Short ID", 20, 11, 240, 22, 9.5f, UiTheme.Muted);
        TextLine(deviceCard, "View in Wall", 292, 11, 142, 22, 9.5f, UiTheme.Text,
            alignment: ContentAlignment.MiddleRight);
        Card(deviceCard, 16, 51, 422, 1);
        TextLine(deviceCard, "A/B authorization", 20, 60, 250, 24, 10f, UiTheme.Text);
        Action(deviceCard, "Approve Agent / Manage", "approval", 247, 61, 188, 30, _wallOnline);

        Card(root, 23, 691, 452, 1);
        Action(root, "Local Wall", "wall", 23, 703, 127, 28, _wallOnline);
        Action(root, "Settings", "account", 170, 703, 126, 28);
        Action(root, "More actions", "more", 317, 703, 160, 28);
        ResumeLayout();
    }
}
