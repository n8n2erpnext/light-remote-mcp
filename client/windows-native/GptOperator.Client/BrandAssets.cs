using System.Reflection;

namespace GptOperator.Client;

internal static class BrandAssets
{
    private static readonly Lazy<Image> MarkImage = new(LoadMark);

    public static Image Mark => MarkImage.Value;

    public static Icon AppIcon => Icon.ExtractAssociatedIcon(Application.ExecutablePath)
        ?? SystemIcons.Application;

    private static Image LoadMark()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("LightRemoteMark.png")
            ?? throw new InvalidOperationException("Light Remote brand mark resource is missing.");
        using var source = Image.FromStream(stream);
        return new Bitmap(source);
    }
}
