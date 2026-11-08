namespace GptOperator.Client;

internal sealed record SemanticVersion(int Major, int Minor, int Patch, string[] PreRelease) : IComparable<SemanticVersion>
{
    public static bool TryParse(string? value, out SemanticVersion? version)
    {
        version = null;
        var text = (value ?? "").Trim();
        if (text.StartsWith('v')) text = text[1..];
        var plus = text.IndexOf('+');
        if (plus >= 0) text = text[..plus];
        var dash = text.IndexOf('-');
        var core = dash >= 0 ? text[..dash] : text;
        var pre = dash >= 0 ? text[(dash + 1)..].Split('.', StringSplitOptions.None) : Array.Empty<string>();
        var parts = core.Split('.', StringSplitOptions.None);
        if (parts.Length != 3 || !ParseCore(parts[0], out var major) || !ParseCore(parts[1], out var minor) || !ParseCore(parts[2], out var patch)) return false;
        if (pre.Any(x => x.Length == 0 || !x.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))) return false;
        if (pre.Any(x => x.Length > 1 && x.All(char.IsDigit) && x[0] == '0')) return false;
        version = new SemanticVersion(major, minor, patch, pre);
        return true;
    }

    private static bool ParseCore(string value, out int number)
    {
        number = 0;
        if (value.Length == 0 || (value.Length > 1 && value[0] == '0')) return false;
        return int.TryParse(value, out number) && number >= 0;
    }

    public int CompareTo(SemanticVersion? other)
    {
        if (other is null) return 1;
        var core = Major.CompareTo(other.Major);
        if (core == 0) core = Minor.CompareTo(other.Minor);
        if (core == 0) core = Patch.CompareTo(other.Patch);
        if (core != 0) return core;
        if (PreRelease.Length == 0 && other.PreRelease.Length == 0) return 0;
        if (PreRelease.Length == 0) return 1;
        if (other.PreRelease.Length == 0) return -1;
        for (var i = 0; i < Math.Max(PreRelease.Length, other.PreRelease.Length); i++)
        {
            if (i >= PreRelease.Length) return -1;
            if (i >= other.PreRelease.Length) return 1;
            var a = PreRelease[i]; var b = other.PreRelease[i];
            var an = int.TryParse(a, out var ai); var bn = int.TryParse(b, out var bi);
            if (an && bn) { var n = ai.CompareTo(bi); if (n != 0) return n; continue; }
            if (an != bn) return an ? -1 : 1;
            var text = string.CompareOrdinal(a, b); if (text != 0) return text;
        }
        return 0;
    }

    public static bool IsNewer(string candidate, string current)
    {
        if (!TryParse(candidate, out var a) || !TryParse(current, out var b) || a is null || b is null) return false;
        return a.CompareTo(b) > 0;
    }
}
