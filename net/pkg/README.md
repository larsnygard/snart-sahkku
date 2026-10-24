# snart-sahkku-net — iroh P2P module for the SnartSahkku PWA

Browser WebAssembly module that gives the SnartSahkku PWA peer-to-peer
messaging over [iroh](https://iroh.computer) gossip. Rooms are identified by
a shared **seed**: the gossip topic id is `SHA-256("sahkku-room-" + seed)`,
so two browsers that know the same seed automatically find each other.

Built with `wasm-pack --target web` (see `build.sh`). The output lives in
`pkg/`.

## How it works in the browser

Browsers cannot send raw UDP, so an iroh browser endpoint never hole-punches:
all connections are relayed through iroh relay servers (the default relay set
from the iroh `presets::N0` preset; verified working against
`euc1-1.relay.n0.iroh.link`). Traffic is end-to-end encrypted — the
relay cannot read it. Browser nodes are fully wire-compatible with native
iroh nodes.

Address discovery: the N0 preset publishes this node's relay address to the
pkarr/iroh-dns network keyed by node id, and resolves other node ids the same
way — a peer is reachable from its 64-hex node id alone.

The module uses `iroh` (`default-features = false`, `tls-ring`) and
`iroh-gossip` (net feature). Randomness on wasm32 requires the
`getrandom_backend="wasm_js"` rustflag, pinned in `.cargo/config.toml`.

## Build

```sh
./build.sh        # wasm-pack build --target web --release --out-dir pkg
```

`build.sh` exits non-zero if the build fails. The release profile uses
`opt-level = "s"`, `lto = true`, `strip = true` (defined in `Cargo.toml`),
plus wasm-opt `-Oz`. Output is ~2.9 MB wasm.

## API

Load the generated bindings from `pkg/`:

```js
import init, { Net } from './pkg/snart_sahkku_net.js';
await init();
```

All type signatures below match the generated `pkg/snart_sahkku_net.d.ts`.

### `class Net`

| Method | d.ts signature | Description |
| --- | --- | --- |
| `Net.new()` | `static async new(): Promise<Net>` | Async factory. Binds an iroh endpoint on the default relays, spawns the gossip protocol and the relay accept loop. Rejects with an `Error` on bind failure. |
| `node_id()` | `node_id(): string` | This node's iroh node id as a lowercase hex string (64 chars). Stable for the session (ephemeral key: a new id per page load). |
| `join(seed)` | `async join(seed: string): Promise<void>` | Join the gossip room `SHA-256("sahkku-room-" + seed)`. Spawns an internal event pump that delivers messages and tracks neighbors. Re-joining the same seed leaves the old subscription first. Note: a fresh gossip swarm needs at least one bootstrap peer — see `joinWith`. |
| `joinWith(seed, bootstrap)` | `joinWith(seed: string, bootstrap: Array<any>): Promise<void>` | Like `join`, also dials bootstrap peers: array of node-id hex strings of peers already in the room. Once one peer is linked the HyParView swarm self-expands. |
| `leave()` | `async leave(): Promise<void>` | Leave all joined rooms. Peers are notified (`NeighborDown`) and `on_peers` fires with the shrunk set. |
| `send(seed, json)` | `async send(seed: string, json: string): Promise<void>` | Broadcast `json` (an opaque string, conventionally JSON) to the room joined under `seed`. Rejects if the seed is not joined. |
| `set_on_message(cb)` | `set_on_message(cb: Function \| null): void` | Register a callback invoked with a JSON string per received message. Pass `null` to clear. |
| `set_on_peers(cb)` | `set_on_peers(cb: Function \| null): void` | Register a callback invoked with a JSON string whenever the peer set changes. Pass `null` to clear. |
| `relay_status()` | `relay_status(): string` | Diagnostics: JSON `{"relays":[{"url":…,"connected":bool,"last_error":…}]}`. |
| `addr()` | `addr(): string` | Diagnostics: JSON `{"id":"<hex>","addrs":["relay:<url>",…]}`. |
| `resolve(id_hex)` | `async resolve(id_hex: string): Promise<string>` | Diagnostics: resolve a node id via the pkarr address lookup; returns address JSON, `"not found"`, or an error string. |
| `dial(id_hex)` | `async dial(id_hex: string): Promise<string>` | Diagnostics: try a gossip-ALPN dial of a node id; returns `"connected"` or an error string. |

### Callback payloads

`on_message` receives one JSON string per gossip message (own echoes are
filtered out):

```json
{ "from": "<sender-node-hex>", "data": "<payload string, e.g. JSON>" }
```

`on_peers` receives a JSON string listing all direct gossip neighbors across
all joined rooms (hex node ids). Change detection is a 1 s poll, so a change
is reported within ~1 s; the callback fires only when the serialized set
differs from the previous one.

```json
{ "peers": ["<node-hex>", "..."] }
```

### Example

```js
const net = await Net.new();
console.log('you are', net.node_id());

net.set_on_peers((json) => {
  const { peers } = JSON.parse(json);
  renderPeerList(peers);
});

net.set_on_message((json) => {
  const { from, data } = JSON.parse(json);
  chat.append(from.slice(0, 8), JSON.parse(data));
});

await net.join('test12');           // room seeder
// newcomer that knows a peer: await net.joinWith('test12', ['<peer-hex>']);
await net.send('test12', JSON.stringify({ t: 'ping' }));
// later:
await net.leave();
```

### Bootstrap timing (important)

Gossip dials bootstrap peers **once** at join time and does not retry.
A node's pkarr record goes live a few seconds after its relay connection is
up. Recommended newcomer pattern (implemented by `smoke-p2p.html`):

1. `await Net.new()`, then wait until `relay_status()` shows a connected relay.
2. `joinWith(seed, [knownPeerHex])`.
3. If no `on_peers` fire within ~10 s, re-issue `joinWith` (it cleanly
   replaces the previous subscription).

## Smoke tests

Serve the `net/` directory over HTTP (module + wasm need a proper origin;
`file://` won't do):

```sh
python3 -m http.server 8080   # from net/
```

- `smoke-p2p.html` — self-contained automated test: two Net endpoints in one
  page; relay-wait, bootstrap-with-retries, send/recv round-trip, `leave()`.
  Sets `document.title` to `PASS`/`FAIL`. Passed end-to-end (peers linked
  ~5 s, message round-trip, peer set emptied after leave).
- `smoke.html` — manual two-tab test. Open tab 1, copy its node id from the
  log, open `smoke.html?boot=<that-hex>` in tab 2. Tab 2 joins seed `test12`
  bootstrapped via tab 1; both tabs ping every 3 s and log `peers:` /
  `recv from …` lines.

## Native tests

`cargo test` runs native (non-wasm) tests over the real N0 default relays:

- `topic_is_sha256_of_prefixed_seed` — room id derivation.
- `gossip_roundtrip_over_default_relays` — two native endpoints, gossip join
  with node-id-only bootstrap via pkarr, broadcast round-trip.
- `relay_connect` (in `tests/relay_connect.rs`) — minimal 1:1 relay
  round-trip for connectivity triage.

## Notes & constraints

- **Node ids are ephemeral**: the module generates a fresh key per page load
  (no local persistence in this build), so `node_id()` changes across reloads.
- **Gossip delivery** is at-most-once per subscription; if the internal queue
  fills, oldest messages drop (`Lagged`).
- `on_peers` reflects *direct gossip neighbors* (the HyParView swarm layer),
  not the full transitive swarm — messages still reach the whole room via
  multicast (PlumTree).
- Message size is capped by iroh-gossip's `DEFAULT_MAX_MESSAGE_SIZE`
  (4096 bytes); larger payloads must be chunked at the game layer.
- The relay preset means an internet connection is required; this build has
  no LAN/WebRTC discovery.
- `panic = "abort"` + `console_error_panic_hook` means Rust panics surface as
  JS exceptions in the console.
