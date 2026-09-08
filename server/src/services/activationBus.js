// In-process event bus connecting on-demand symbol activation
// (routes/candles.js) to the live relay adapters (services/exchanges/*).
//
// Why this exists: activating a symbol (flipping `active = true` when
// someone requests a pair nobody's viewed recently) used to only take
// effect for live ticks after the whole server restarted — the relay only
// read the active symbol list once, at boot. Since the HTTP route and the
// relay adapters run in the same Node process, a plain EventEmitter is
// enough to bridge them without any new infrastructure: the route emits
// "activate" the moment it flips a symbol on, and each adapter listens
// for activations matching its own exchange, adding that symbol to a live
// WebSocket subscription immediately.

import { EventEmitter } from "events";

const bus = new EventEmitter();
// Relay adapters can run many symbols; avoid Node's default 10-listener
// warning since each exchange/marketType combo registers its own handler.
bus.setMaxListeners(50);

export function emitActivation({ exchange, marketType, symbol }) {
  bus.emit("activate", { exchange, marketType, symbol });
}

export function onActivation(handler) {
  bus.on("activate", handler);
}
