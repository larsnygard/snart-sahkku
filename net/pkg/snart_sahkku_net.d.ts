/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * The P2P network handle. Create with `await Net.new()`.
 */
export class Net {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * This node's iroh node id as a hex string (stable for the session).
     * Kor mange innkommande gossip-samband vi har teke imot (diagnostikk).
     */
    accepted(): number;
    /**
     * Diagnostics: this endpoint's address as JSON
     * `{"id": "<hex>", "addrs": ["relay:<url>", "ip:<sockaddr>", ...]}`.
     */
    addr(): string;
    /**
     * Diagnostics: try dialing a node id over the gossip ALPN and report
     * the outcome as a string. Closes the connection immediately.
     */
    dial(id_hex: string): Promise<string>;
    /**
     * Join the gossip room `SHA-256("sahkku-room-" + seed)`. Re-joining the
     * same seed leaves the old subscription first. Spawns the event pump.
     */
    join(seed: string): Promise<void>;
    /**
     * Like `join`, but also dials bootstrap peers: an array of node-id hex
     * strings of peers already in the room. A gossip swarm cannot be entered
     * without at least one known peer (browsers exchange node ids via
     * links/tickets); once one peer is dialed the swarm self-expands.
     */
    joinWith(seed: string, bootstrap: Array<any>): Promise<void>;
    /**
     * Leave all rooms (drops gossip subscriptions; peers get NeighborDown).
     */
    leave(): Promise<void>;
    /**
     * Async factory: binds an iroh endpoint on the default (preset) relays,
     * spawns the gossip protocol and the relay-accept loop.
     */
    static new(): Promise<Net>;
    node_id(): string;
    /**
     * Debug aid: JSON with this node's relay connection states, e.g.
     * `{"relays":[{"url":"https://euc1-1…/","state":"Connected"}]}`.
     */
    relay_status(): string;
    /**
     * Diagnostics: resolve a node id through the configured address lookup
     * services (PkarrResolver in browsers). Returns the resolved address
     * JSON, `"not found"`, or an error string.
     */
    resolve(id_hex: string): Promise<string>;
    /**
     * Broadcast a JSON payload to the room joined under `seed`.
     */
    send(seed: string, json: string): Promise<void>;
    /**
     * Register a callback invoked with a JSON string
     * `{"from": "<sender-node-hex>", "data": <payload-string>}` for every
     * received gossip message. Pass `null` to clear.
     */
    set_on_message(cb?: Function | null): void;
    /**
     * Register a callback invoked with a JSON string
     * `{"peers": ["<node-hex>", ...]}` whenever the peer set changes
     * (checked on a 1 s poll). Pass `null` to clear.
     */
    set_on_peers(cb?: Function | null): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_net_free: (a: number, b: number) => void;
    readonly net_accepted: (a: number) => number;
    readonly net_addr: (a: number, b: number) => void;
    readonly net_dial: (a: number, b: number, c: number) => number;
    readonly net_join: (a: number, b: number, c: number) => number;
    readonly net_joinWith: (a: number, b: number, c: number, d: number) => number;
    readonly net_leave: (a: number) => number;
    readonly net_new: () => number;
    readonly net_node_id: (a: number, b: number) => void;
    readonly net_relay_status: (a: number, b: number) => void;
    readonly net_resolve: (a: number, b: number, c: number) => number;
    readonly net_send: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly net_set_on_message: (a: number, b: number) => void;
    readonly net_set_on_peers: (a: number, b: number) => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: number) => number;
    readonly intounderlyingbytesource_start: (a: number, b: number) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: number) => number;
    readonly intounderlyingsink_close: (a: number) => number;
    readonly intounderlyingsink_write: (a: number, b: number) => number;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: number) => number;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly __wasm_bindgen_func_elem_11017: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_11019: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_4995: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_3092: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_6214: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_4858: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_5630: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_5671: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_10917: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
