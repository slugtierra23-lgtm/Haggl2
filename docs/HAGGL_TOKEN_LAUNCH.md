# Launching the HAGGL token

This is a checklist for switching BOLTY payments on once the ERC-20 is live
on Base. No code changes are required — everything is gated on environment
variables.

## 1. Deploy the ERC-20

Deploy your BOLTY contract on **Base mainnet (chainId 8453)**. Any standard
OpenZeppelin ERC-20 works. Write down:

- Contract address (`0x…`, 42 chars)
- `decimals()` — default is 18, anything else needs the override below
- USD price per 1 BOLTY at launch (e.g. `0.05` for $0.05 / BOLTY)

## 2. Configure Render

### Backend service

```
HAGGL_TOKEN_CONTRACT=0x<token address>
PLATFORM_WALLET=0x<bolty treasury address — must already be set>
```

That's all the backend needs. It auto-detects ETH vs BOLTY payments per
transaction: if `tx.value > 0` routed to the seller it's ETH (7% fee, 93%
to seller); if `tx.value = 0` and there's an ERC-20 `Transfer(seller, …)`
log from `HAGGL_TOKEN_CONTRACT`, it's BOLTY (3% fee, 97% to seller).

### Frontend service

```
NEXT_PUBLIC_HAGGL_TOKEN_CONTRACT=0x<same address as backend>
NEXT_PUBLIC_BOLTY_USD_PRICE=0.05
# optional, defaults to 18
NEXT_PUBLIC_HAGGL_TOKEN_DECIMALS=18
```

Both variables must be set for the frontend toggle to appear. If either is
missing, the Pay-with-BOLTY option is hidden and users only see ETH.

## 3. Redeploy

After updating env vars, trigger a redeploy on both services (Render does
it automatically when you save env changes on Web services).

## 4. Smoke test

1. Open any locked repo detail page. You should see a "Pay with ETH · 7%
   fee / Pay with BOLTY · 3% fee" toggle above the Unlock button.
2. Switch to BOLTY, click Unlock. MetaMask should prompt for an ERC-20
   `transfer(seller, amount)` call to the BOLTY contract — value 0 ETH.
3. Confirm. A second prompt sends the 3% platform fee (also BOLTY).
4. Verify the purchase lands in `/orders`, `/inventory → Purchased`, the
   live ticker shows `"currency": "BOLTY"`, and the seller gets rays.

## 5. Updating the USD price

Market price moves. When you need to re-peg the quote:

1. Update `NEXT_PUBLIC_BOLTY_USD_PRICE` on the frontend Render service.
2. Redeploy (~1 min).

The backend doesn't need to know the USD price — it only checks the
ERC-20 `Transfer` log against the seller's wallet, so stale frontend
quotes just mean the buyer pays slightly more/less BOLTY than intended;
no broken purchases.

## 6. Switching to a price oracle later

When volume grows, replace the hardcoded USD price with a live oracle
(CoinGecko, CL feed, Uniswap TWAP). The plug-in point is
`frontend/src/lib/wallet/haggl-token.ts::getHagglTokenConfig`. Replace
the `usdPrice` read with a cached fetch from `/api/v1/chart/bolty-price`
(not yet implemented; add on the backend when needed).

## Rollback

Want to disable BOLTY payments temporarily? Unset
`NEXT_PUBLIC_HAGGL_TOKEN_CONTRACT` on the frontend. The toggle
disappears, existing BOLTY purchases remain verified in the DB.
