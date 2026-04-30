# Flaunch Launchpad — deployment guide

Step-by-step to turn on real on-chain launches. Phase 1 (UI, stubbed
client, flag-gated) is already shipped. This doc walks through the
one-time setup needed for Phase 2 (real contracts, real ETH).

## Decisions (already made)

| | |
|---|---|
| **Treasury address** | `0xc320f2f3608d5bd269c39bb6ea9084ed32131a76` |
| **Protocol fee** | 15% of every swap fee |
| **Chain** | Base (chainId 8453) |
| **Gating** | Open to every listing owner |
| **Data source** | Flaunch subgraph (no backend mirror day 1) |
| **Gas model** | User pays from their own wallet |
| **Token footer** | haggl attribution appended to every token description |
| **Framing** | Community memecoins (not revenue claims / securities) |

These live in `frontend/src/lib/flaunch/config.ts` and
`frontend/src/lib/flaunch/feature.ts` — the single source of truth.

## One-time setup

### 1. Deploy our RevenueManager

RevenueManager deployment is **permissionless via the Flaunch SDK** —
there's no UI, no Discord ticket, no whitelist. The base RevenueManager
(`0x48af…8763` on Base) acts as the factory; calling `deployRevenueManager`
mints your own instance from it.

We ship a ready-to-run script at `frontend/scripts/deploy-flaunch-revenue-manager.ts`
that calls the exact SDK method with our treasury + 15% already filled in.

```bash
cd frontend
# Deployer wallet needs ~0.001 ETH on Base for gas.
# This key ONLY signs the deployment — it is NOT the treasury.
# After deploy you can delete / forget this key.
PRIVATE_KEY=0x<deployer-key> npx tsx scripts/deploy-flaunch-revenue-manager.ts
```

Expected output:

```
Deploying Flaunch RevenueManager on Base
  Deployer       : 0x…
  Treasury       : 0xc320f2f3608d5bd269c39bb6ea9084ed32131a76
  Protocol fee % : 15
  Deployer ETH   : 0.00xxxx

→ Signing deployment tx…

✓ RevenueManager deployed

  Address: 0x…

Set these env vars on Vercel (Production + Preview + Development):
  NEXT_PUBLIC_FLAUNCH_REVENUE_MANAGER=0x…
  NEXT_PUBLIC_FLAUNCH_LAUNCHPAD_ENABLED=true
```

The **Address** line is your dedicated RevenueManager. Copy it.

### 2. Wire the address into the frontend

Set on Vercel (Production + Preview + Development scopes) and in
`.env.local` for anyone running the app locally:

```bash
NEXT_PUBLIC_FLAUNCH_REVENUE_MANAGER=<manager address from step 1>
NEXT_PUBLIC_FLAUNCH_LAUNCHPAD_ENABLED=true
```

`isRevenueManagerConfigured()` will now return `true`, removing the
"Preview mode" banner from the launch wizard. The UI is otherwise
unchanged.

### 3. Swap the stubbed client for real SDK calls

Open `frontend/src/lib/flaunch/launchpad.ts` — rewrite the four
exported functions to call `@flaunch/sdk`:

| Current stub | Real SDK equivalent |
|---|---|
| `launchToken(input)` | `sdk.flaunchIPFSWithRevenueManager({ ...input, revenueManagerInstance: FLAUNCH_REVENUE_MANAGER })` |
| `buyLaunchpadToken(input)` | `sdk.buyCoin({ coin, ethAmount, slippagePercent })` |
| `sellLaunchpadToken(input)` | `sdk.sellCoin({ coin, tokenAmount, slippagePercent })` |
| `getTokenForListing(id)` + `listLaunchedTokens()` | Query the Flaunch subgraph filtered by `revenueManager == FLAUNCH_REVENUE_MANAGER` |

`getReadWriteSdk()` in `frontend/src/lib/flaunch/client.ts` already
builds the SDK with the user's MetaMask wallet — reuse it directly.

No other UI file needs to change. The type contracts in
`frontend/src/lib/flaunch/types.ts` were designed to match what the
SDK returns.

### 4. Smoke-test

- Connect a wallet on Base with a small ETH balance
- Open any listing you own → "Launch token"
- Walk the wizard, confirm the "Preview mode" banner is gone
- Launch a throwaway token with a tiny premine (0.0001 ETH)
- Verify on basescan.org that the token contract exists
- Check that a swap pays the RevenueManager — small amount of ETH
  should accrue to the treasury address after a handful of trades

### 5. Claim protocol fees

Protocol fees accrue inside the RevenueManager. Claim them via the
SDK (there's no UI for this either). Sketch:

```ts
await flaunchWrite.revenueManagerProtocolClaim({
  revenueManagerInstance: FLAUNCH_REVENUE_MANAGER,
});
// → ETH is transferred to TREASURY (the protocolRecipient we set at deploy)
```

The wallet that calls claim pays gas; fees themselves go to the
treasury.

## Rollback

If anything goes wrong after step 2:

```bash
# .env.production / Vercel
NEXT_PUBLIC_FLAUNCH_LAUNCHPAD_ENABLED=false
```

This hides every launchpad surface. The existing on-chain tokens
keep trading on Flaunch — they're not "ours" to turn off.

## Notes

- The RevenueManager is **immutable** once deployed; `protocolFeePercent`
  and `protocolRecipient` cannot be edited. Deploy a new one and migrate
  if needed.
- Fair-launch mechanics (30 min fixed-price window, 0.25%-per-wallet
  max buy, no sell during window) are enforced by Flaunch's hooks and
  cannot be bypassed per-launch.
- Subgraph queries should filter by `revenueManager` so we only surface
  tokens launched through haggl — other RevenueManagers share the
  Flaunch protocol but aren't ours.
- The `PRIVATE_KEY` used for the deploy does NOT need to be the treasury
  key. Any funded Base wallet works; you can delete it after deploy.
