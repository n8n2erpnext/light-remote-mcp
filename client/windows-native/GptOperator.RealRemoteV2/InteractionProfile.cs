namespace GptOperator.RealRemoteV2;

internal sealed record InteractionProfile(string Name,int MoveMs,int MoveSteps,int HoverMs,int DownMs,int DoubleGapMs)
{
    public static InteractionProfile Read(string name)=>name switch {
        "compatibility"=>new(name,90,8,35,40,55),
        "smooth"=>new(name,90,8,35,40,55),
        "precision"=>new(name,0,1,35,40,55),
        "responsive"=>new(name,0,1,5,12,25),
        _=>throw new InvalidOperationException("desktop_input_invalid_profile")
    };
}
