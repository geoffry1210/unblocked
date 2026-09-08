// Splits a symbol list into shards sized so that (symbols-per-shard x
// timeframes-per-symbol) stays under maxStreamsPerConnection, and manages
// one independently-reconnecting WebSocket connection per shard.
//
// Why this exists: with a handful of curated symbols, cramming everything
// into one connection was fine. Once the symbol list can grow into the
// hundreds (all USDT/USD/USDC pairs, plus anything on-demand-activated —
// see routes/candles.js), a single connection either hits the exchange's
// own per-connection stream cap or — in Binance's case, historically —
// produces a WebSocket URL far too long to even open. Sharding into
// several smaller connections sidesteps both problems.
//
// ShardGroup additionally supports adding a symbol AFTER startup (live
// on-demand activation, see activationBus.js): it finds a shard with
// spare capacity and sends a live subscribe message, or opens a fresh
// shard connection if none has room. Each shard's `symbols` array is
// mutable and read fresh on every (re)connect, so live-added symbols
// automatically get re-subscribed if that shard's connection ever drops
// and reconnects — no separate bookkeeping needed for that case.

export function shardSymbols(symbols, timeframesPerSymbol, maxStreamsPerConnection = 200) {
  const perShard = Math.max(1, Math.floor(maxStreamsPerConnection / timeframesPerSymbol));
  const shards = [];
  for (let i = 0; i < symbols.length; i += perShard) {
    shards.push(symbols.slice(i, i + perShard));
  }
  return shards;
}

/**
 * Creates a shard group and starts one connection per initial shard via
 * `connectShard(shardDescriptor, shardIndex)`. `connectShard` is
 * responsible for setting `shardDescriptor.ws` once connected (and again
 * on every reconnect) so `addSymbol` can find shards with an open,
 * writable connection.
 */
export function createShardGroup(symbols, timeframesPerSymbol, connectShard, { label, maxStreamsPerConnection = 200 } = {}) {
  const group = { label, timeframesPerSymbol, maxStreamsPerConnection, shards: [], connectShard };

  const initial = shardSymbols(symbols, timeframesPerSymbol, maxStreamsPerConnection);
  if (initial.length > 1) {
    console.log(`${label}: ${symbols.length} symbols split across ${initial.length} connections (~${initial[0].length} symbols each)`);
  }
  initial.forEach((shardSymbols, i) => {
    const shard = { symbols: shardSymbols, ws: null };
    group.shards.push(shard);
    connectShard(shard, i);
  });

  return group;
}

/**
 * Live-adds a symbol to an existing shard with spare capacity (sending
 * `buildSubscribeForSymbol(symbol)` on that shard's open connection), or
 * opens a brand-new shard connection if none has room. No-ops if the
 * symbol is already tracked in some shard.
 */
export function addSymbolToShardGroup(group, symbol, buildSubscribeForSymbol) {
  if (group.shards.some((s) => s.symbols.includes(symbol))) return; // already subscribed somewhere

  const roomy = group.shards.find(
    (s) => s.ws && s.ws.readyState === s.ws.OPEN && (s.symbols.length + 1) * group.timeframesPerSymbol <= group.maxStreamsPerConnection
  );

  if (roomy) {
    roomy.symbols.push(symbol);
    roomy.ws.send(JSON.stringify(buildSubscribeForSymbol(symbol)));
    console.log(`${group.label}: live-subscribed ${symbol} on existing shard (${roomy.symbols.length} symbols now)`);
    return;
  }

  const shard = { symbols: [symbol], ws: null };
  group.shards.push(shard);
  group.connectShard(shard, group.shards.length - 1);
  console.log(`${group.label}: opened a new shard connection for live-added ${symbol}`);
}
