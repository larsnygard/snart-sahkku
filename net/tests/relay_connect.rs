//! Minimal relay connectivity check: two endpoints on the default relays,
//! B dials A by node id (address via MemoryLookup) and exchanges bytes.
//! No gossip involved — isolates relay/QUIC connectivity.

use iroh::{endpoint::presets, Endpoint, Watcher};
use std::time::Duration;

const TEST_ALPN: &[u8] = b"sahkku-test/0";

#[tokio::test(flavor = "multi_thread")]
async fn relay_connection_roundtrip() {
    let ep_a = Endpoint::builder(presets::N0)
        .alpns(vec![TEST_ALPN.to_vec()])
        .bind()
        .await
        .expect("bind A");
    let ep_b = Endpoint::builder(presets::N0)
        .alpns(vec![TEST_ALPN.to_vec()])
        .bind()
        .await
        .expect("bind B");

    tokio::time::timeout(Duration::from_secs(30), ep_a.online())
        .await
        .expect("A offline");
    tokio::time::timeout(Duration::from_secs(30), ep_b.online())
        .await
        .expect("B offline");
    println!("A home relay: {:?}", ep_a.home_relay_status().get());
    println!("B home relay: {:?}", ep_b.home_relay_status().get());

    let a_id = ep_a.id();
    let lookup = iroh::address_lookup::MemoryLookup::new();
    lookup.add_endpoint_info(ep_a.addr());
    ep_b.address_lookup().expect("lookup").add(lookup);

    let ep_accept = ep_a.clone();
    let accept = tokio::spawn(async move {
        let conn = ep_accept.accept().await.expect("accept").await.expect("handshake");
        let (mut send, mut recv) = conn.accept_bi().await.expect("accept_bi");
        let mut buf = [0u8; 4];
        recv.read_exact(&mut buf).await.expect("read ping");
        assert_eq!(&buf, b"ping");
        send.write_all(b"pong").await.expect("write");
        send.finish().expect("finish");
        // Keep the connection alive briefly so the pong flushes before close.
        tokio::time::sleep(Duration::from_millis(500)).await;
        conn.close(0u32.into(), b"done");
    });

    let conn =
        tokio::time::timeout(Duration::from_secs(45), ep_b.connect(a_id, TEST_ALPN))
            .await
            .expect("dial timeout")
            .expect("dial failed");

    let (mut send, mut recv) = conn.open_bi().await.expect("open_bi");
    send.write_all(b"ping").await.expect("write");
    send.finish().expect("finish");
    let mut buf = [0u8; 4];
    tokio::time::timeout(Duration::from_secs(10), recv.read_exact(&mut buf))
        .await
        .expect("pong timeout")
        .expect("read pong");
    assert_eq!(&buf, b"pong");
    accept.await.unwrap();
    ep_a.close().await;
    ep_b.close().await;
}
