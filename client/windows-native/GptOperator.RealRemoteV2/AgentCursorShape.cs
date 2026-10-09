using System.Drawing;
using System.Linq;

namespace GptOperator.RealRemoteV2;

/// <summary>
/// One geometry for both the Windows black cursor AND the WPF glow.
/// All coordinates are measured from the exact upper-left arrow hotspot.
/// Reference: owner screenshot #1, short black tapered pointer with a fine
/// white edge and no colored stroke inside the pointer.
/// </summary>
internal static class AgentCursorShape
{
    internal const float DesignSize=48f;
    internal const float HotspotX=12f;
    internal const float HotspotY=10f;

    internal static readonly PointF[] RelativeOutline =
    {
        new(0f,0f),        // pointed NW tip, exact hotspot
        new(.8f,24f),      // near-vertical left flank
        new(6.3f,18.7f),   // inner shoulder
        new(11.6f,29f),   // slim diagonal stem
        new(15.6f,27f),
        new(10.2f,17f),   // return along the stem
        new(20f,16.4f)    // crisp upper-right wing
    };

    internal static PointF[] BitmapOutline() =>
        RelativeOutline.Select(p=>new PointF(HotspotX+p.X,HotspotY+p.Y)).ToArray();
}
