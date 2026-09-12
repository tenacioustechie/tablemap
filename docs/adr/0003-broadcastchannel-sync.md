# ADR 0003 — BroadcastChannel for DM-player sync
Status: accepted

Both windows come from the same origin in the same browser, so BroadcastChannel gives near-instant, zero-setup messaging with no server. Typed, versioned message schema; snapshot-then-delta protocol. If v2 adds remote player devices, the same message schema moves onto a WebSocket/WebRTC transport — the protocol is the abstraction, not the channel.
