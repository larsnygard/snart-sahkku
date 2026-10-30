//! sahkku-net — iroh-powered P2P networking for the SnartSahkku browser PWA.
//!
//! Exposes a `Net` class to JavaScript via wasm-bindgen. Rooms are gossip
//! topics identified by `SHA-256("sahkku-room-" + seed)`. In the browser all
//! traffic is relayed through iroh relays (default preset relays), end-to-end
//! encrypted.
//!
//! Requires the `getrandom_backend="wasm_js"` rustflag (set in
//! `.cargo/config.toml`).

use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap};
use std::rc::Rc;

use bytes::Bytes;
use futures::channel::oneshot;
use futures::future::Either;
use futures::{future, StreamExt};
use iroh::endpoint::presets;
use iroh::Watcher;
use iroh::Endpoint;
use iroh_gossip::api::{Event as GossipEvent, GossipReceiver, GossipSender};
use iroh_gossip::net::Gossip;
use iroh_gossip::TopicId;
use js_sys::Function;
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;

/// Peer-change polling interval (ms), per spec.
const PEER_POLL_MS: u32 = 1000;

struct Join {
    tx: GossipSender,
    stop: oneshot::Sender<()>,
}

struct Inner {
    endpoint: Endpoint,
    gossip: Gossip,
    joins: RefCell<HashMap<String, Join>>,
    /// seed -> set of neighbor node ids (hex)
    peers: RefCell<HashMap<String, BTreeSet<String>>>,
    on_message: RefCell<Option<Function>>,
    on_peers: RefCell<Option<Function>>,
    poll_started: Cell<bool>,
}

fn js_err(msg: impl std::fmt::Display) -> JsError {
    JsError::new(&msg.to_string())
}

fn topic_for_seed(seed: &str) -> TopicId {
    let mut h = Sha256::new();
    h.update(format!("sahkku-room-{seed}"));
    TopicId::from_bytes(h.finalize().into())
}

/// Public wrapper over the room-id derivation, exposed for native tests.
#[doc(hidden)]
pub fn topic_for_seed_pub(seed: &str) -> TopicId {
    topic_for_seed(seed)
}

/// Fire a JS callback with a JSON string argument, swallowing JS exceptions.
fn fire(cb_slot: &RefCell<Option<Function>>, json: &str) {
    if let Some(f) = cb_slot.borrow().as_ref() {
        let _ = f.call1(&JsValue::NULL, &JsValue::from_str(json));
    }
}

/// Per-join event pump: reads gossip events, forwards messages to the
/// `on_message` callback and tracks neighbors for `on_peers`. Exits when the
/// join is stopped (stop signal) or the stream ends.
fn spawn_pump(rc: Rc<Inner>, seed: String, mut rx: GossipReceiver, mut stop: oneshot::Receiver<()>) {
    let me = rc.endpoint.id().to_string();
    spawn_local(async move {
        loop {
            let next = rx.next();
            futures::pin_mut!(next);
            let ev = match future::select(next, &mut stop).await {
                Either::Left((ev, _)) => ev,
                Either::Right((_, _)) => break,
            };
            match ev {
                Some(Ok(GossipEvent::Received(msg))) => {
                    // Skip our own echoes (delivered back to us via plumtree).
                    if msg.delivered_from.to_string() != me {
                        let from = msg.delivered_from.to_string();
                        let data = String::from_utf8_lossy(&msg.content).into_owned();
                        let json = serde_json::json!({ "from": from, "data": data }).to_string();
                        fire(&rc.on_message, &json);
                    }
                }
                Some(Ok(GossipEvent::NeighborUp(id))) => {
                    rc.peers
                        .borrow_mut()
                        .entry(seed.clone())
                        .or_default()
                        .insert(id.to_string());
                }
                Some(Ok(GossipEvent::NeighborDown(id))) => {
                    if let Some(set) = rc.peers.borrow_mut().get_mut(&seed) {
                        set.remove(&id.to_string());
                    }
                }
                Some(Ok(GossipEvent::Lagged)) => {}
                Some(Err(_)) | None => break,
            }
        }
        // Leaving the topic: drop the receiver so the gossip actor leaves the
        // swarm, and clear this seed's neighbors.
        drop(rx);
        rc.peers.borrow_mut().remove(&seed);
    });
}

/// 1s poll over the merged neighbor set; fires `on_peers` with
/// `{"peers": [hex, ...]}` whenever the set changed.
fn spawn_peer_poll(rc: Rc<Inner>) {
    spawn_local(async move {
        let mut last: Option<String> = None;
        loop {
            gloo_timers::future::TimeoutFuture::new(PEER_POLL_MS).await;
            let mut merged: BTreeSet<String> = BTreeSet::new();
            for set in rc.peers.borrow().values() {
                merged.extend(set.iter().cloned());
            }
            let peers: Vec<String> = merged.into_iter().collect();
            let json = serde_json::json!({ "peers": peers }).to_string();
            if last.as_deref() != Some(json.as_str()) {
                fire(&rc.on_peers, &json);
                last = Some(json);
            }
        }
    });
}

fn stop_join(rc: &Rc<Inner>, seed: &str) {
    if let Some(join) = rc.joins.borrow_mut().remove(seed) {
        let _ = join.stop.send(()); // pump exits and drops the receiver
    }
}

/// The P2P network handle. Create with `await Net.new()`.
#[wasm_bindgen]
pub struct Net {
    rc: Rc<Inner>,
}

#[wasm_bindgen]
impl Net {
    /// Async factory: binds an iroh endpoint on the default (preset) relays,
    /// spawns the gossip protocol and the relay-accept loop.
    #[wasm_bindgen(js_name = new)]
    pub async fn new_net() -> Result<Net, JsError> {
        console_error_panic_hook::set_once();
        let endpoint = Endpoint::builder(presets::N0)
            .bind()
            .await
            .map_err(js_err)?;
        let gossip = Gossip::builder().spawn(endpoint.clone());
        endpoint.set_alpns(vec![iroh_gossip::ALPN.to_vec()]);

        let rc = Rc::new(Inner {
            endpoint,
            gossip,
            joins: RefCell::new(HashMap::new()),
            peers: RefCell::new(HashMap::new()),
            on_message: RefCell::new(None),
            on_peers: RefCell::new(None),
            poll_started: Cell::new(false),
        });
        if !rc.poll_started.get() {
            rc.poll_started.set(true);
            spawn_peer_poll(rc.clone());
        }

        // Browser endpoints cannot hole-punch; all connections arrive via
        // relays. Route gossip connections to the gossip actor, AND attach the
        // inbound peer to every topic we already subscribed to. Without the
        // join_peers call the peer could send to us while we could not send to
        // it (or the other way round) — one-way rooms, which is what made
        // online games hang.
        {
            let rc2 = rc.clone();
            spawn_local(async move {
                let endpoint = rc2.endpoint.clone();
                let gossip = rc2.gossip.clone();
                loop {
                    let accepting = match endpoint.accept().await {
                        Some(a) => a,
                        None => break, // endpoint closed
                    };
                    let conn = match accepting.await {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    if conn.alpn() != iroh_gossip::ALPN {
                        continue;
                    }
                    let remote = conn.remote_id();
                    if gossip.handle_connection(conn).await.is_ok() {
                        let txs: Vec<_> = rc2.joins.borrow().values().map(|j| j.tx.clone()).collect();
                        for tx in txs {
                            let _ = tx.join_peers(vec![remote]).await;
                        }
                    }
                }
            });
        }
        Ok(Net { rc })
    }

    /// This node's iroh node id as a hex string (stable for the session).
    pub fn node_id(&self) -> String {
        self.rc.endpoint.id().to_string()
    }

    /// Debug aid: JSON with this node's relay connection states, e.g.
    /// `{"relays":[{"url":"https://euc1-1…/","state":"Connected"}]}`.
    pub fn relay_status(&self) -> String {
        let relays: Vec<_> = self
            .rc
            .endpoint
            .home_relay_status()
            .get()
            .iter()
            .map(|s| {
                serde_json::json!({
                    "url": s.url().to_string(),
                    "connected": s.is_connected(),
                    "last_error": s.last_error().map(|e| e.to_string()),
                })
            })
            .collect();
        serde_json::json!({ "relays": relays }).to_string()
    }

    /// Join the gossip room `SHA-256("sahkku-room-" + seed)`. Re-joining the
    /// same seed leaves the old subscription first. Spawns the event pump.
    pub async fn join(&self, seed: &str) -> Result<(), JsError> {
        self.join_with(seed, &js_sys::Array::new()).await
    }

    /// Like `join`, but also dials bootstrap peers: an array of node-id hex
    /// strings of peers already in the room. A gossip swarm cannot be entered
    /// without at least one known peer (browsers exchange node ids via
    /// links/tickets); once one peer is dialed the swarm self-expands.
    #[wasm_bindgen(js_name = joinWith)]
    pub async fn join_with(&self, seed: &str, bootstrap: &js_sys::Array) -> Result<(), JsError> {
        use std::str::FromStr;
        let rc = self.rc.clone();
        stop_join(&rc, seed);
        let mut boot = Vec::new();
        for v in bootstrap.iter() {
            let s = v.as_string().ok_or_else(|| js_err("bootstrap entries must be strings"))?;
            boot.push(
                iroh::EndpointId::from_str(&s)
                    .map_err(|_| js_err(format!("bad node id '{s}'")))?,
            );
        }
        let (tx, rx) = rc
            .gossip
            .subscribe(topic_for_seed(seed), vec![])
            .await
            .map_err(js_err)?
            .split();
        let (stop_tx, stop_rx) = oneshot::channel();
        rc.joins.borrow_mut().insert(
            seed.to_string(),
            Join {
                tx,
                stop: stop_tx,
            },
        );
        rc.peers.borrow_mut().entry(seed.to_string()).or_default();
        spawn_pump(rc.clone(), seed.to_string(), rx, stop_rx);
        // Abonner UTEN bootstrap: gossip-svermen sender SUBSCRIBE på alle
        // forbindelser den kjenner. Bootstrap-peeren ringes opp i bakgrunnen
        // med retries (vertens pkarr-post kan være uferdig ennå) og mates inn
        // via handle_connection — da blir den med i svermen med en gang.
        if !boot.is_empty() {
            let gossip = rc.gossip.clone();
            let endpoint = rc.endpoint.clone();
            let tx_join = rc
                .joins
                .borrow()
                .get(seed)
                .map(|j| j.tx.clone())
                .ok_or_else(|| js_err("join vanished"))?;
            spawn_local(async move {
                for id in boot {
                    for attempt in 0..8 {
                        match endpoint.connect(id, iroh_gossip::ALPN).await {
                            Ok(conn) => {
                                if gossip.handle_connection(conn).await.is_ok() {
                                    // be proto-aktøren legge topic-et til denne
                                    // forbindelsen -> SWARM_UPGRADE-håndtrykk
                                    let _ = tx_join.join_peers(vec![id]).await;
                                    break;
                                }
                                gloo_timers::future::TimeoutFuture::new(2000).await;
                            }
                            Err(_) => {
                                gloo_timers::future::TimeoutFuture::new(3000 + attempt * 2000)
                                    .await;
                            }
                        }
                    }
                }
            });
        }
        Ok(())
    }

    /// Leave all rooms (drops gossip subscriptions; peers get NeighborDown).
    pub async fn leave(&self) -> Result<(), JsError> {
        let seeds: Vec<String> = self.rc.joins.borrow().keys().cloned().collect();
        for seed in seeds {
            stop_join(&self.rc, &seed);
        }
        Ok(())
    }

    /// Broadcast a JSON payload to the room joined under `seed`.
    pub async fn send(&self, seed: &str, json: &str) -> Result<(), JsError> {
        let tx = self
            .rc
            .joins
            .borrow()
            .get(seed)
            .map(|j| j.tx.clone())
            .ok_or_else(|| js_err(format!("not joined to room '{seed}'")))?;
        tx.broadcast(Bytes::from(json.to_string()))
            .await
            .map_err(js_err)?;
        Ok(())
    }

    /// Register a callback invoked with a JSON string
    /// `{"from": "<sender-node-hex>", "data": <payload-string>}` for every
    /// received gossip message. Pass `null` to clear.
    pub fn set_on_message(&self, cb: Option<Function>) {
        *self.rc.on_message.borrow_mut() = cb;
    }

    /// Register a callback invoked with a JSON string
    /// `{"peers": ["<node-hex>", ...]}` whenever the peer set changes
    /// (checked on a 1 s poll). Pass `null` to clear.
    pub fn set_on_peers(&self, cb: Option<Function>) {
        *self.rc.on_peers.borrow_mut() = cb;
    }

    /// Diagnostics: this endpoint's address as JSON
    /// `{"id": "<hex>", "addrs": ["relay:<url>", "ip:<sockaddr>", ...]}`.
    pub fn addr(&self) -> String {
        let a = self.rc.endpoint.addr();
        let addrs: Vec<String> = a.addrs.iter().map(|t| t.to_string()).collect();
        serde_json::json!({ "id": a.id.to_string(), "addrs": addrs }).to_string()
    }

    /// Diagnostics: resolve a node id through the configured address lookup
    /// services (PkarrResolver in browsers). Returns the resolved address
    /// JSON, `"not found"`, or an error string.
    pub async fn resolve(&self, id_hex: String) -> String {
        use futures::StreamExt;
        use std::str::FromStr;
        let Ok(id) = iroh::EndpointId::from_str(&id_hex) else {
            return "bad id".into();
        };
        let Ok(lookup) = self.rc.endpoint.address_lookup() else {
            return "no lookup services".into();
        };
        let mut stream = lookup.resolve(id);
        while let Some(next) = stream.next().await {
            match next {
                Ok(Ok(item)) => {
                    let addr = iroh::EndpointAddr::from(item.endpoint_info().clone());
                    let addrs: Vec<String> = addr.addrs.iter().map(|t| t.to_string()).collect();
                    return serde_json::json!({ "id": addr.id.to_string(), "addrs": addrs, "provenance": item.provenance() }).to_string();
                }
                Ok(Err(e)) => return format!("resolve error: {e}"),
                Err(e) => return format!("resolve failed: {e}"),
            }
        }
        "not found".into()
    }

    /// Diagnostics: try dialing a node id over the gossip ALPN and report
    /// the outcome as a string. Closes the connection immediately.
    pub async fn dial(&self, id_hex: String) -> String {
        use std::str::FromStr;
        let Ok(id) = iroh::EndpointId::from_str(&id_hex) else {
            return "bad id".into();
        };
        match self
            .rc
            .endpoint
            .connect(id, iroh_gossip::ALPN)
            .await
        {
            Ok(conn) => {
                conn.close(0u32.into(), b"diag");
                "connected".into()
            }
            Err(e) => format!("dial error: {e}"),
        }
    }
}
