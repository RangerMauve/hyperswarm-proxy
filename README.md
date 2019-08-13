# hyperswarm-proxy
Proxy p2p connections using a duplex stream and Hyperswarm

## Goals

- Should be usable with [MMST](https://github.com/RangerMauve/mostly-minimal-spanning-tree)
- Separate peer discovery from peer connections
- Protocol buffer based
  - `ready`
  - `join(topic)`
  - `leave(topic)`
  - `on-peer(topic, peerid)`
  - `connect(peerid)`
  - `on-stream-open(topic, peer, streamid)`
  - `on-stream-data(streamid, data)`
  - `on-stream-close(streamid)`
