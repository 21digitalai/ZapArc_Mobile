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
 *
 * ──────────────────────────────────────────────────────────────────────
 * BEFORE FLIPPING THIS BACK TO `true` FOR AN APP STORE BUILD — READ:
 * ──────────────────────────────────────────────────────────────────────
 *
 * The original 3.1.5(iii) rejection (submission 1508cc69-…, May 2026)
 * asked for the items below. They MUST accompany the resubmission, or
 * Apple will reject again with the same canned response. The DeFi/AMM
 * framing (Flashnet on Spark) is the path we've publicly committed to
 * in the prior reply to App Review — don't switch to the centralized-
 * exchange framing without re-reading what was promised.
 *
 *   1. Technical/protocol documentation showing what the app connects to.
 *      ➜ Link to Flashnet's public AMM docs + Spark L2 docs in the
 *        review notes. Frame it as a permissionless smart-contract-style
 *        AMM (Uniswap-v3-equivalent), NOT a centralized exchange.
 *
 *   2. Written statement on geographic App Store distribution.
 *      ➜ Choose territories where DeFi AMM interaction is clearly
 *        permitted. Sensible default: block US (MSB rules), block UK
 *        (FCA — see #3), block all OFAC-sanctioned regions. Most of EU
 *        and LATAM is fine. This is a POLICY call, not engineering.
 *
 *   3. UK FCA crypto-asset promotion compliance.
 *      ➜ EITHER (a) block UK App Store distribution outright (easiest), OR
 *      ➜ (b) obtain a UK crypto-law legal opinion that ZapArc's swap
 *        does not constitute a "crypto-asset promotion" under the FCA's
 *        2023 financial-promotions regime. Plan ~£2–5k of attorney time.
 *
 * Frame the app at all times as: self-custodial wallet, no developer
 * custody, no developer intermediation of exchange transactions, no
 * partnership with any centralized exchange. The user signs directly
 * to the on-chain AMM contract from their own keys.
 *
 * Apple's checklist for the centralized-exchange / first-party path
 * (MSB registration, state-by-state licenses, KYC/AML programme, etc.)
 * is NOT the path we've committed to and should not be touched without
 * an explicit pivot decision.
 * ──────────────────────────────────────────────────────────────────────
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

/**
 * CONTACTS_BACKUP_ENABLED gates including the address book in cloud backups and
 * the merge-on-restore prompt. The full implementation (encryption, opt-in
 * toggle, dedup-by-lightning-address merge) stays in the codebase — this flag
 * just hides the option and ensures no contacts are written to backups for now.
 * Flip to `true` to ship the feature.
 */
export const CONTACTS_BACKUP_ENABLED = false as boolean;
