/**
 * Feature flags.
 *
 * SWAP_FEATURE_ENABLED gates the BTC <-> USDB swap UI for App Store
 * compliance. Apple's review guideline 3.1.5(iii) requires per-region
 * exchange licensing or a documented third-party-exchange partnership.
 * Until that's in place, we ship the wallet without the swap entry
 * points to qualify under the standard "self-custodial wallet" path
 * (same path Phoenix, Muun, Wallet of Satoshi use).
 *
 * The underlying swap services/hooks remain in the codebase (they're
 * used internally for asset display, pricing, and transaction labelling),
 * but every user-facing entry point — quick actions, banners, settings,
 * and the swap route itself — must check this flag.
 */
export const SWAP_FEATURE_ENABLED = false as boolean;

/**
 * MULTI_ASSET_UI_ENABLED gates the BTC / USDB asset selector and all USDB-side
 * surfaces (asset pill, asset picker sheet, USDB tabs in send/receive, USDB
 * empty-state cards). For App Store v1 we ship as a BTC-only wallet — leaving
 * USDB UI visible with the swap path disabled creates a half-broken flow
 * (users could receive USDB but never convert it to BTC), which reviewers
 * would flag. Re-enable once the swap path is approved or a regulated
 * third-party conversion route is in place.
 *
 * Note: the USDB token registration in the SDK and the underlying token
 * services remain intact — only user-facing entry points are hidden, so
 * existing wallets that already hold USDB don't lose track of their balance
 * on the device; they just don't see any way to interact with it in the UI.
 */
export const MULTI_ASSET_UI_ENABLED = false as boolean;
