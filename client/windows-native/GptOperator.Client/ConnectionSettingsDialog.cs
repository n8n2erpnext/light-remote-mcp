namespace GptOperator.Client;

internal sealed class ConnectionSettingsDialog : Form
{
    private readonly TextBox _bridge = new() { Dock = DockStyle.Top };
    private readonly TextBox _hub = new() { Dock = DockStyle.Top };

    public ConnectionSettingsDialog(ConnectionSettings current, bool enrolled)
    {
        Text = "Light Remote MCP — Server settings";
        ClientSize = new Size(560, 290);
        MinimumSize = new Size(560, 290);
        MaximumSize = new Size(760, 360);
        StartPosition = FormStartPosition.CenterParent;
        BackColor = UiTheme.Background;
        ForeColor = UiTheme.Text;
        Font = UiTheme.Font(9.5f);
        AutoScaleMode = AutoScaleMode.Dpi;
        _bridge.Text = current.BridgeUrl;
        _hub.Text = current.HubUrl;

        var body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 8, Padding = new Padding(20), BackColor = UiTheme.Background };
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        body.Controls.Add(new Label { Text = "Vercel bridge URL", AutoSize = true, ForeColor = UiTheme.Muted, Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft }, 0, 0);
        body.Controls.Add(_bridge, 0, 1);
        body.Controls.Add(new Label { Text = "Server / Hub URL", AutoSize = true, ForeColor = UiTheme.Muted, Dock = DockStyle.Fill, TextAlign = ContentAlignment.BottomLeft }, 0, 2);
        body.Controls.Add(_hub, 0, 3);
        body.Controls.Add(new Label {
            Text = enrolled ? "This device is already enrolled. Changing endpoints can disconnect it; re-enroll after a server migration." : "Configure these endpoints before enrolling this device.",
            AutoSize = false, Dock = DockStyle.Fill, ForeColor = enrolled ? UiTheme.Warning : UiTheme.Muted
        }, 0, 4);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, BackColor = UiTheme.Background };
        var cancel = new Button { Text = "Cancel", Width = 96, DialogResult = DialogResult.Cancel };
        var save = new Button { Text = "Save", Width = 96 };
        UiTheme.StyleButton(cancel); UiTheme.StyleButton(save, primary: true);
        save.Click += (_, _) => SaveAndClose();
        buttons.Controls.Add(save); buttons.Controls.Add(cancel);
        Controls.Add(body); Controls.Add(buttons);
        AcceptButton = save; CancelButton = cancel;
        Shown += (_, _) => _bridge.Focus();
        HandleCreated += (_, _) => UiTheme.ApplyDarkTitleBar(this);
    }
    private void SaveAndClose()
    {
        try
        {
            ConnectionConfig.Save(_bridge.Text, _hub.Text);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Invalid server settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
