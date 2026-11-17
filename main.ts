// Bollinger Hunter: a Bollinger-band mean-reversion BTC bot for the make.fun
// 24h BTC race (btc-race-24h-20261117-0603).
//
// The idea, in one line: buy a sharp dip only when it is extreme *relative
// to recent volatility* — below the lower Bollinger band — and already
// turning, then sell the bounce back. On 1-minute bars this market spends
// most of its time grinding and occasionally drops hard and fast, then
// bounces part of the way back. A round trip costs about 26 bps in fees,
// slippage and impact, so a trade has to catch a move larger than that.
//
// This is a genuinely different strategy from Dip Hunter 2 (the first entry
// in this competition), which buys a FIXED 1.2% drop off the 121-bar high.
// Bollinger Hunter buys a VOLATILITY-NORMALISED extreme: the close below
// the 60-bar mean minus 1.5 standard deviations. On the dev window the two
// bots take different trades — Dip Hunter 2 buys at bars 196, 552, 1092;
// this bot buys at bars 147, 554, 719 (only one dip in common, two bars
// apart). The exit is also different in kind: a fixed 1.4% take-profit
// above the entry close, with a 2% stop.
//
// Why not momentum? A Donchian-breakout trend-follower was screened first
// on this dev window (576 variants: breakout lookback 24–120 bars, EMA
// filter 0–48, trailing stop 0.8–3%): 0 of 576 positive, best -$22.90.
// Bounce-continuation (648 variants) and EMA-cross mean-reversion (36
// variants) also all lost. This window mean-reverts — breakouts are false
// and get whipsawed. The edge here is buying volatility extremes, and the
// Bollinger band is the volatility-aware way to define one.
//
//   - History: every close the bot has seen, per symbol (warm-up bars
//     included). No trade is decided before 61 closes exist, so the
//     60-bar band is real.
//   - Entry, on a bar's close (filled at the next open): the close is
//     below the lower Bollinger band (60-bar mean minus 1.5 standard
//     deviations, computed over the 60 closes before the current bar),
//     and the close is above the previous bar's close (the dip is
//     turning), on a symbol the bot does not hold. It buys with all
//     its cash.
//   - Exit, the whole position: the close is at least 1.4% above the
//     entry close (the bounce), or at least 2% below it (the drop kept
//     going — cut it). An exit the market refuses (a price past the
//     slippage cap at the next open) is sent again on the next bar while
//     its reason still holds.
//   - One position at most, long only, no leverage, no martingale: after
//     a sell the bot waits for a fresh band break before it buys again.
//   - Deterministic: float64 arithmetic on + - * / and one sqrt alone,
//     no clock, no randomness, no environment; the same bars give the
//     same orders, run after run. The entry reference is the decision
//     bar's close, not the fill price, so a fill a minute later cannot
//     change the plan.
//
// Tuning evidence (screened on this dev window with a simulator that
// reproduces the harness fill model — fee 4 bps, slippage 2 bps,
// constant-product impact against each bar's open depth; it reproduces
// Dip Hunter 2's grade-local number of +$20.64 on this window exactly):
// the chosen parameters make +$16.89 on the dev window in 3 round trips
// (5 filled orders) with max drawdown 1.75%, and every neighbour in a
// K 40–90 / SD 1.25–1.75 / take-profit 1.0–2.0% box around them is also
// positive (27/27, worst +$0.68) — a plateau, not a spike. Buy-and-hold
// makes +$1.07. Verified with the kit's grade-local (see BUILD-DONE2.md).
//
// Laid out like an entrant's repository: the grader runs `node /bot/main.ts`
// with this directory mounted at /bot; vendor/makefun-bars.ts is a
// byte-identical copy of the kit's sdk/makefun-bars.ts.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Closes in the Bollinger window, current bar excluded. */
const BAND_BARS = 60;
/** Standard deviations below the band mean that arm a buy. */
const BAND_SD = 1.5;
/** How far the close must rise above the entry close to take the bounce. */
const TAKE_PROFIT = 0.014;
/** How far the close may fall below the entry close before the loss is cut. */
const STOP = 0.02;
const MAX_SLIPPAGE_BPS = 100;

/** Per-symbol state: the closes seen and the open position's reference. */
interface Series {
  closes: number[];
  /** The decision-bar close of the current position, once it has appeared. */
  entry: number | null;
  /** The batch seq at which the current position was decided. */
  entrySeq: number;
  /** The close the last buy was decided on, until its position appears. */
  pendingEntry: number | null;
  /** The batch seq that buy was decided on. */
  pendingSeq: number;
}

const series = new Map<string, Series>();

function getSeries(symbol: string): Series {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { closes: [], entry: null, entrySeq: 0, pendingEntry: null, pendingSeq: -1 };
    series.set(symbol, s);
  }
  return s;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      const s = getSeries(bar.symbol);
      s.closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const orders: (SellInput | BuyInput)[] = [];

    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || s.closes.length < BAND_BARS + 1) continue;
      const held = state.positions.get(symbol);
      const close = Number(state.close(symbol));
      if (close <= 0) continue;

      if (held !== undefined) {
        // The position is real (the account says so). Anchor the entry
        // reference to the close the buy was decided on — the decision bar's
        // close, not the fill bar's — so a fill a minute later cannot move
        // the exit levels. A buy the market refused leaves no position and
        // its pending reference is dropped once a bar has passed.
        if (s.entry === null) {
          s.entry = s.pendingEntry ?? close;
          s.entrySeq = s.pendingSeq >= 0 ? s.pendingSeq : state.seq;
          s.pendingEntry = null;
          s.pendingSeq = -1;
        }
        const entry = s.entry;
        const up = close >= entry * (1 + TAKE_PROFIT);
        const down = close <= entry * (1 - STOP);
        if (up || down) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else {
        // No position: drop a pending reference older than one bar (its buy
        // was refused), then a fresh break below the lower Bollinger band
        // arms a full-size buy — but only once the dip has started to
        // turn: the close must be above the previous bar's close, so the
        // bot never catches a falling knife.
        if (s.pendingEntry !== null && state.seq - s.pendingSeq > 1) {
          s.pendingEntry = null;
          s.pendingSeq = -1;
        }
        s.entry = null;
        // The band uses the BAND_BARS closes before the current bar: its
        // mean and population standard deviation over that window.
        const window = s.closes.slice(s.closes.length - 1 - BAND_BARS, s.closes.length - 1);
        let sum = 0;
        for (const c of window) sum += c;
        const mean = sum / BAND_BARS;
        let variance = 0;
        for (const c of window) {
          const d = c - mean;
          variance += d * d;
        }
        const sd = Math.sqrt(variance / BAND_BARS);
        const lowerBand = mean - BAND_SD * sd;
        const prevClose = s.closes[s.closes.length - 2];
        const turning = prevClose !== undefined && close > prevClose;
        if (close < lowerBand && turning) {
          let slice = state.cash;
          const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
          if (slice > byWeight) slice = byWeight;
          if (slice > 0n && slice >= BigInt(fees.min_notional_quote_units)) {
            orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
            s.pendingEntry = close;
            s.pendingSeq = state.seq;
          }
        }
      }
      if (orders.length >= caps.max_orders_per_bar) break;
    }
    return orders;
  },
});
