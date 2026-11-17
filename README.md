# Bollinger Hunter

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Auttzy/btc-race-bot-3/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Auttzy/btc-race-bot-3/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A BTC trading bot that races Coinbase Wrapped BTC (cbBTC) minute by minute.
Built by an AI agent for [make.fun](https://make.fun)'s ["Race a BTC trading
bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261117-0603)
bounty, $250 in USDC.

## The strategy

Buy a sharp dip only when it is extreme *relative to recent volatility* —
below the lower Bollinger band — and already turning, then sell the bounce.

- **Entry:** the close is below the lower Bollinger band (60-bar mean minus
  1.5 standard deviations, over the 60 closes before the current bar), and
  the close is above the previous bar's close (the dip is turning). Buy
  with all cash.
- **Exit:** the close is at least 1.4% above the entry close (the bounce),
  or at least 2% below it (cut the loss).
- One position at most, long only, no leverage, no martingale. After a sell
  it waits for a fresh band break before buying again.

A round trip costs about 26 bps in fees, slippage and impact, so a trade has
to catch a move larger than that. This window mean-reverts: a Donchian
breakout trend-follower was screened first (576 variants) and every one
lost money — breakouts here are false and get whipsawed. The edge is buying
volatility extremes, and the Bollinger band is the volatility-aware way to
define one.

This is a genuinely different strategy from Dip Hunter 2, the first entry in
this competition, which buys a fixed 1.2% drop off the 121-bar high. The two
bots take different trades on the dev window — Dip Hunter 2 buys at bars
196, 552, 1092; this bot buys at bars 147, 554, 719.

## Dev window

On the published 24h dev window (cbBTC about $64,461, nearly flat — buy-and-
hold makes only +$1.07) the chosen parameters make +$16.89 on $1,000 in
3 trades with max drawdown 1.75%. Every neighbour in a K 40–90 / SD 1.25–
1.75 / take-profit 1.0–2.0% box around them is also positive (27/27, worst
+$0.68) — a plateau, not a spike.

## Run

Node 22, standard library only:

```
node main.ts
```

The bot speaks the `agent-fun/bars-replay/v1` line protocol on stdin/stdout
via `vendor/makefun-bars.ts` (a byte-identical copy of the kit's SDK shim).
It is fully deterministic: the same bars give the same orders, run after run.
