namespace GptOperator.RealRemoteV2;

internal enum AgentCursorPhase
{
    Active,
    Moving,
    Clicking,
    Dragging,
    Scrolling
}

internal sealed record AgentCursorSnapshot(
    string Phase,
    double ClickPulse,
    string Button,
    int ClickCount
);

internal sealed class AgentCursorVisualState
{
    private readonly object _sync = new();
    private AgentCursorPhase _phase = AgentCursorPhase.Active;
    private long _phaseUntil;
    private long _clickStarted;
    private string _button = "left";
    private int _clickCount;

    public void MarkMove(int durationMs)
        => MarkPhase(AgentCursorPhase.Moving, Math.Clamp(durationMs + 110, 110, 700));

    public void MarkClick(string button, int count)
    {
        lock (_sync)
        {
            var now = Environment.TickCount64;
            _phase = AgentCursorPhase.Clicking;
            _phaseUntil = now + 250;
            _clickStarted = now;
            _button = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
            _clickCount = Math.Clamp(count, 1, 3);
        }
    }

    public void MarkDrag(int durationMs)
        => MarkPhase(AgentCursorPhase.Dragging, Math.Clamp(durationMs + 140, 180, 5_200));

    public void MarkScroll()
        => MarkPhase(AgentCursorPhase.Scrolling, 180);

    private void MarkPhase(AgentCursorPhase phase, int durationMs)
    {
        lock (_sync)
        {
            _phase = phase;
            _phaseUntil = Environment.TickCount64 + Math.Max(1, durationMs);
        }
    }

    public AgentCursorSnapshot Snapshot(long now)
    {
        lock (_sync)
        {
            if (_phase != AgentCursorPhase.Active && now >= _phaseUntil)
                _phase = AgentCursorPhase.Active;

            var pulse = 0d;
            if (_clickStarted > 0)
            {
                var elapsed = now - _clickStarted;
                if (elapsed is >= 0 and < 260)
                    pulse = 1d - Math.Clamp(elapsed / 260d, 0d, 1d);
            }

            return new AgentCursorSnapshot(
                _phase.ToString().ToLowerInvariant(),
                pulse,
                _button,
                _clickCount
            );
        }
    }

    public AgentCursorSnapshot Status() => Snapshot(Environment.TickCount64);

    internal static bool SelfTest()
    {
        var state = new AgentCursorVisualState();
        var now = Environment.TickCount64;

        state.MarkMove(90);
        if (state.Snapshot(now).Phase != "moving") return false;

        state.MarkClick("left", 2);
        var click = state.Snapshot(Environment.TickCount64);
        if (click.Phase != "clicking" || click.ClickCount != 2 || click.Button != "left" || click.ClickPulse <= 0d)
            return false;

        state.MarkDrag(250);
        if (state.Snapshot(Environment.TickCount64).Phase != "dragging") return false;

        state.MarkScroll();
        if (state.Snapshot(Environment.TickCount64).Phase != "scrolling") return false;

        return true;
    }
}
