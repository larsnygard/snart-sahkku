//! Native smoke test for the gossip stack this wasm module wraps.
//!
//! Binds two iroh endpoints on the default (N0 preset) relays, joins both
//! the same `sahkku-room-<seed>` topic (id derivation shared with the wasm
//! module via `topic_for_seed_pub`), bootstraps B -> A, and verifies a
//! broadcast round-trip. Requires internet access to the default relays.

use futures::StreamExt;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_gossip::net::Gossip;
use iroh_gossip::ALPN as GOSSIP_ALPN;
use sha2::{Digest, Sha256};
use snart_sahkku_net::topic_for_seed_pub;
use std::time::Duration;

#[test]
fn topic_is_sha256_of_prefixed_seed() {
    let mut h = Sha256::new();
    h.update(b"sahkku-room-test12");
    let expected: [u8; 32] = h.finalize().into();
    assert_eq!(topic_for_seed_pub("test12").as_bytes(), &expected);
}

#[tokio::test(flavor = "multi_thread")]
async fn gossip_roundtrip_over_default_relays() {
    let topic = topic_for_seed_pub("native-smoke");

    // Gossip does not accept inbound connections itself: the endpoint must
    // route GOSSIP_ALPN connections to the gossip actor (like the wasm accept
    // loop does). Use Router, iroh's canonical acceptor.
    let ep_a = Endpoint::builder(presets::N0)
        .alpns(vec![GOSSIP_ALPN.to_vec()])
        .bind()
        .await
        .expect("bind A");
    let ep_b = Endpoint::builder(presets::N0)
        .alpns(vec![GOSSIP_ALPN.to_vec()])
        .bind()
        .await
        .expect("bind B");
    let g_a = Gossip::builder().spawn(ep_a.clone());
    let g_b = Gossip::builder().spawn(ep_b.clone());
    let _r_a = Router::builder(ep_a.clone())
        .accept(GOSSIP_ALPN, g_a.clone())
        .spawn();
    let _r_b = Router::builder(ep_b.clone())
        .accept(GOSSIP_ALPN, g_b.clone())
        .spawn();

    // Both endpoints should reach a relay.
    tokio::time::timeout(Duration::from_secs(30), ep_a.online())
        .await
        .expect("A never came online (relay unreachable?)");
    tokio::time::timeout(Duration::from_secs(30), ep_b.online())
        .await
        .expect("B never came online (relay unreachable?)");

    // No MemoryLookup here: this mimics the browser case exactly — B only
    // knows A's node id and must resolve A's relay address through the N0
    // preset's pkarr publisher/resolver.
    let (tx_a, mut rx_a) = g_a.subscribe(topic, vec![]).await.expect("A subscribe").split();
    let (_tx_b, mut rx_b) = g_b
        .subscribe(topic, vec![ep_a.id()])
        .await
        .expect("B subscribe+bootstrap")
        .split();

    // A waits for B as a direct neighbour (NeighborUp event), logging all events.
    let joined = tokio::time::timeout(Duration::from_secs(150), async {
        while let Some(ev) = rx_a.next().await {
            println!("A event: {:?}", ev);
            if let Ok(iroh_gossip::api::Event::NeighborUp(peer)) = ev {
                if peer == ep_b.id() {
                    return;
                }
            }
        }
    })
    .await;
    assert!(joined.is_ok(), "A never saw B as a neighbour (60s)");

    // B broadcasts, A must receive it.
    tx_a
        .broadcast(bytes::Bytes::from_static(b"hello-from-a"))
        .await
        .expect("broadcast");

    let got = tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(ev) = rx_b.next().await {
            if let Ok(iroh_gossip::api::Event::Received(msg)) = ev {
                if msg.content == &b"hello-from-a"[..] {
                    return true;
                }
            }
        }
        false
    })
    .await
    .expect("B never received A's broadcast (30s)");
    assert!(got);

    ep_a.close().await;
    ep_b.close().await;
}
