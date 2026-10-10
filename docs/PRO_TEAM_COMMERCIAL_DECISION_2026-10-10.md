# Light Remote pricing decision — 2026-10-10

## Approved product names and prices

| Offer | USD recurring monthly | Seats | Device / worker semantics |
|---|---:|---:|---|
| Free | $0 | 1 account | Free allowance (currently 10,000 tool calls/month) |
| Pro | $20 per account | 1 | Unlimited personal calls under Pro policy |
| Pro Team | $55 per team, not per member, not $55 + $20 | Up to 5 (owner + 4) | Maximum 3 concurrent workers per shared device |

Pro Team's paying owner retains Pro personal benefits within the $55 monthly price.
The four invited users keep their original independent plan (including Free).
Joining a Team grants only explicitly shared devices after the member's
independent Local Wall A/B authorization. It does not upgrade members to Pro.

## Metering guardrails

- Personal Pro calls are separate from shared Team-member calls.
- Team-member calls debit the owner's finite Team usage pool.
- Budget is never inherited from personal Pro unlimited calls.
- For initial commercial sizing, test 20,000 and 25,000 Team-member tool calls
  per owner per UTC month. This is an experimental range, NOT a launched cap.
- Current isolated rc.50 UAT Team grant is 5,000 modeled member calls/month.
  Do not silently replace that grant with the commercial experiment.
- Three workers is a limit per shared device, not per member.
- Race-safe SQLite UAT is not real billing or remote dispatch.

## Paddle sandbox integration contract (NOT YET ENABLED)

1. Create two distinct monthly recurring sandbox prices:
   Pro USD20 and Pro Team USD55, with distinct Paddle price IDs.
   Reuse current Pro price only after verifying actual amount and cycle.
2. Bind webhook transaction/subscription and price ID to the owner and
   product; never derive Pro Team simply from an account's Pro status.
3. Pro Team maps to Pro owner features AND a separate owner Team entitlement.
   Invited Free members remain Free outside shared devices.
4. Checkout shows Paddle verified localized taxes. Team checkout remains
   DISABLED until valid price ID plus grant/revoke/refund UAT are complete.
5. Subscription changes, renewal, cancellation, refund, failed payment and
   downgrade must suspend/revoke Team access without corrupting other plans.
6. Deduplicate webhook event, subscription and transaction IDs. Verify
   ERPNext orders, cancellations, refunds and retained payment-provider fees.
7. Keep production checkout, API keys, webhook and LXD unchanged without
   separate owner release approval.

## Staging UI

The rc.50 billing page shows the approved $55 and five-seat comparison as
a catalog card only. The View Pro Team link is NOT a checkout button.
Team Paddle checkout is not configured in staging yet. Pro Team is the only
consumer-facing Team product name, NOT Pro+.

## Annual pricing preview (rc.50 staging, NOT for checkout)

UI period tabs: Monthly / Yearly. The annual comparison rates approved for
this staging design are Pro USD 200/year and Pro Team USD 550/year: each is
equivalent to ten months of the corresponding monthly rate (2 months free,
16.67% saved). Free stays USD 0 on both tabs.

These are pricing previews, not currently configured Paddle annual price IDs.
Selecting Yearly never opens the existing monthly checkout. Annual actions
remain disabled until distinct Paddle sandbox annual prices and all
subscription/webhook/grant tests are completed. The monthly Pro checkout
continues to follow the existing real Paddle preview when available.
