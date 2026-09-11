// Real market data hook — loads historical candles via REST, then layers
// live updates from the WebSocket on top. One WebSocket connection
// persists across symbol/timeframe/exchange changes; only the
// subscription changes.
//
// exchange/marketType are required alongside symbol/timeframe — the same
// pair (e.g. BTCUSDT) exists on multiple exchanges and market types, so
// all four together identify which candle stream you actually want.
//
// timeframe can be a NON-native interval (an exchange gap like Bybit's
// missing 8h, or a fully custom size like "7m" — see lib/timeframeCapability.js
// and lib/aggregate.js). The server already handles historical data for
// these transparently (routes/candles.js aggregates from 1m on the fly),
// but LIVE updates need handling here: the relay only ever broadcasts
// native-timeframe candle closes, so for a non-native timeframe this hook
// subscribes to the native "1m" stream instead and rolls those ticks up
// into the custom bucket client-side.
//
// CORRECTNESS NOTE on the bucket that's already mid-formation when the
// page loads: we can't safely reconstruct it from live 1m ticks alone,
// because we don't know which 1m candles already contributed to the
// server's historical aggregate for that bucket — re-deriving it from
// scratch would under-count (missing earlier 1m candles) or double-count
// (if a 1m candle that already contributed re-fires). Rather than guess,
// this hook keeps that one bucket exactly as the server returned it and
// only starts applying live updates once the bucket rolls over into a
// fresh one — from that point on every custom bucket is built from 1m
// ticks observed from its very first moment, so it's exactly correct with
// no edge case. Net effect: a custom-interval chart's current bar doesn't
// visibly tick until the first full bucket boundary after load, then
// updates live from then on — a small, self-resolving, one-time delay in
// exchange for guaranteed-correct volume figures.

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchCandles } from "./api.js";
import { supportsTimeframe } from "./timeframeCapability.js";
import { createLiveAggregator } from "./aggregate.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useMarketData({ exchange, marketType, symbol, timeframe }) {
  const [candles, setCandles] = useState([]);
  const [whaleEvents, setWhaleEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef(null);
  const currentChannelRef = useRef(null);
  // The connect effect below only runs once (empty deps — intentional, so
  // we don't tear down and reopen the socket on every symbol/timeframe/
  // exchange change). That means its onmessage closure would otherwise
  // capture these from the very first render and never see updates. These
  // refs are kept in sync on every change so onmessage always reads the
  // live values instead of a stale closure.
  const exchangeRef = useRef(exchange);
  const marketTypeRef = useRef(marketType);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    exchangeRef.current = exchange;
    marketTypeRef.current = marketType;
    symbolRef.current = symbol;
    timeframeRef.current = timeframe;
  }, [exchange, marketType, symbol, timeframe]);

  // isCustom + the live aggregator state both live in refs so onmessage
  // (bound once, see the WS effect below) always reads the current values.
  const isCustomRef = useRef(false);
  const liveAggRef = useRef(null); // { agg, ignoreUntilNewBucket }

  // Historical load — runs on every exchange/marketType/symbol/timeframe change.
  useEffect(() => {
    if (!symbol || !exchange || !marketType) return;
    let cancelled = false;
    setLoading(true);
    setHasMore(true);

    const custom = !supportsTimeframe(exchange, marketType, timeframe);
    isCustomRef.current = custom;
    if (custom) {
      const m = /^(\d+)(s|m|h|d|w|M)$/.exec(timeframe);
      liveAggRef.current = m
        ? { agg: createLiveAggregator(Number(m[1]), m[2]), ignoreUntilNewBucket: true }
        : null;
    } else {
      liveAggRef.current = null;
    }

    fetchCandles(symbol, timeframe, { exchange, marketType, limit: 1000 })
      .then((data) => {
        if (!cancelled) {
          setCandles(data);
          setHasMore(data.length >= 1000); // a full page means there's likely more before it
        }
      })
      .catch((err) => console.error("Failed to load candles", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exchange, marketType, symbol, timeframe]);

  // Pulls in another page of older candles and prepends them — call this
  // when the user pans/zooms near the left edge of what's currently loaded.
  // Unchanged for custom intervals: the server already aggregates
  // historical pages transparently, same as the initial load.
  const loadMore = useCallback(() => {
    setCandles((prev) => {
      if (loadingMore || !hasMore || prev.length === 0) return prev;
      const oldest = prev[0].t;
      setLoadingMore(true);
      fetchCandles(symbolRef.current, timeframeRef.current, {
        exchange: exchangeRef.current,
        marketType: marketTypeRef.current,
        limit: 1000,
        before: oldest,
      })
        .then((older) => {
          setHasMore(older.length >= 1000);
          if (older.length > 0) {
            setCandles((cur) => [...older, ...cur]);
          }
        })
        .catch((err) => console.error("Failed to load older candles", err))
        .finally(() => setLoadingMore(false));
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore]);

  // WebSocket connection — opened once, kept alive across changes.
  useEffect(() => {
    let cancelled = false;
    let reconnectAttempt = 0;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempt = 0; // reset backoff after a successful connection
        setConnected(true);
        subscribeToChannel(exchangeRef.current, marketTypeRef.current, symbolRef.current, timeframeRef.current);
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        // Custom/non-native timeframe: we're subscribed to the native "1m"
        // stream (see subscribeToChannel) and roll it up client-side.
        if (
          msg.type === "candle" &&
          isCustomRef.current &&
          liveAggRef.current &&
          msg.exchange === exchangeRef.current &&
          msg.marketType === marketTypeRef.current &&
          msg.symbol === symbolRef.current &&
          msg.timeframe === "1m"
        ) {
          const state = liveAggRef.current;
          const { bar, isNewBucket } = state.agg.ingest({
            t: msg.candle.openTime, o: msg.candle.o, h: msg.candle.h, l: msg.candle.l, c: msg.candle.c, v: msg.candle.v,
          });
          if (!bar) return;

          if (state.ignoreUntilNewBucket) {
            // Still inside the bucket that was already mid-formation at
            // load time — see the file header for why we deliberately
            // don't touch it. Wait for the first real rollover.
            if (isNewBucket) {
              state.ignoreUntilNewBucket = false;
              setCandles((prev) => [...prev, bar]);
            }
            return;
          }

          setCandles((prev) => {
            if (prev.length === 0) return prev;
            return isNewBucket ? [...prev, bar] : [...prev.slice(0, -1), bar];
          });
          return;
        }

        // Native timeframe — direct passthrough, as before.
        if (
          msg.type === "candle" &&
          !isCustomRef.current &&
          msg.exchange === exchangeRef.current &&
          msg.marketType === marketTypeRef.current &&
          msg.symbol === symbolRef.current &&
          msg.timeframe === timeframeRef.current
        ) {
          setCandles((prev) => {
            if (prev.length === 0) return prev;
            const incoming = {
              o: msg.candle.o,
              h: msg.candle.h,
              l: msg.candle.l,
              c: msg.candle.c,
              v: msg.candle.v,
              t: msg.candle.openTime,
            };
            if (msg.closed) {
              // Candle finished — append a fresh one (keep full history, don't
              // shift the window off the front anymore now that pan-to-load
              // relies on the oldest loaded candle staying put).
              return [...prev, incoming];
            }
            // Still forming — update the last candle in place
            return [...prev.slice(0, -1), incoming];
          });
        }

        if (msg.type === "whale" && msg.symbol === symbolRef.current) {
          const id = `${msg.event.hash || msg.event.from || "unknown"}-${Date.now()}`;
          setWhaleEvents((prev) => [...prev, { ...msg.event, id }]);
          // Auto-expire after 15s so the pulse list doesn't grow forever
          setTimeout(() => {
            setWhaleEvents((prev) => prev.filter((e) => e.id !== id));
          }, 15000);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
        reconnectAttempt += 1;
        setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
    // Intentionally only runs once on mount — subscription changes are
    // handled separately below so we don't reopen the socket every time
    // the user switches symbols/exchanges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeToChannel = useCallback((ex, mt, sym, tf) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sym || !ex || !mt) return;

    // Non-native timeframes ride on the native "1m" stream instead — see
    // the file header. This must match what onmessage listens for above.
    const wireTf = supportsTimeframe(ex, mt, tf) ? tf : "1m";

    if (currentChannelRef.current) {
      const [prevEx, prevMt, prevSym, prevTf] = currentChannelRef.current;
      ws.send(JSON.stringify({ type: "unsubscribe", exchange: prevEx, marketType: prevMt, symbol: prevSym, timeframe: prevTf }));
    }
    ws.send(JSON.stringify({ type: "subscribe", exchange: ex, marketType: mt, symbol: sym, timeframe: wireTf }));
    currentChannelRef.current = [ex, mt, sym, wireTf];
  }, []);

  // Re-subscribe whenever exchange/marketType/symbol/timeframe changes (after initial connect)
  useEffect(() => {
    if (connected) subscribeToChannel(exchange, marketType, symbol, timeframe);
  }, [exchange, marketType, symbol, timeframe, connected, subscribeToChannel]);

  return { candles, whaleEvents, loading, loadingMore, hasMore, loadMore, connected };
}
