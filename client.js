const EventEmitter = require('events')
const HyperswarmProxyStream = require('./')

const NOT_CONNECTED = 'Not connected to proxy'

module.exports = class HyperswarmProxyClient extends EventEmitter {
  constructor (options = {}) {
    super()

    const { connection, autoconnect = true, maxPeers = 24 } = options

    this.maxPeers = maxPeers

    this._handleStream = this._handleStream.bind(this)
    this._handleClose = this._handleClose.bind(this)
    this._handlePeer = this._handlePeer.bind(this)
    this._handleError = this._handleError.bind(this)
    this._handleUpdated = this._handleUpdated.bind(this)
    this._reJoin = this._reJoin.bind(this)

    this._protocol = null
    this._connection = null

    this._topics = []
    this._connectedPeers = new Set()
    this._seenPeers = []

    this._autoconnect = autoconnect

    this.destroyed = false

    if (connection) {
      this.reconnect(connection)
    }
  }

  disconnect () {
    if (!this._protocol) {
      return
    }
    this._protocol.removeListener('close', this._handleClose)
    this._connection.end()
    this._protocol.end()

    this._connection = null
    this._protocol = null
  }

  reconnect (connection) {
    this.disconnect()

    this._connection = connection
    this._protocol = new HyperswarmProxyStream(connection)

    this._protocol.on('stream', this._handleStream)
    this._protocol.on('on_peer', this._handlePeer)
    this._protocol.once('close', this._handleClose)
    this._protocol.on('error', this._handleError)
    this._protocol.on('on_updated', this._handleUpdated)

    // Once the other side is ready, re-join known topics
    this._protocol.once('ready', this._reJoin)

    this._protocol.ready()
  }

  _handleStream (stream, { topic, peer }) {
    if (this.destroyed) {
      // Already destroyed
      stream.end()
      return
    }

    const details = new Details(peer, topic)

    this._connectedPeers.add(peer)

    this.emit('connection', stream, details)

    stream.once('close', () => {
      if (this.destroyed) {
        return
      }
      this.emit('disconnection', stream, details)
      this._connectedPeers.delete(peer)
    })
  }

  _handleClose () {
    this._protocol = null
    this.emit('disconnected')
  }

  _handleError (e) {
    this.emit('error', e)
  }

  _handlePeer ({ topic, peer }) {
    const peerData = {
      host: peer,
      port: 0,
      local: false,
      topic
    }

    this.emit('peer', peerData)

    const hasConnected = this._connectedPeers.has(peer)
    const hasMaxPeers = this._connectedPeers.size >= this.maxPeers
    const shouldConnect = this._autoconnect && !hasConnected && !hasMaxPeers

    if (shouldConnect) {
      this.connect(peerData)
    } else if (!this._seenPeers.find(data => data.peer === peer)) {
      // TODO: Do something with this, like connect to them after disconnection
      this._seenPeers.push(peerData)
    }
  }

  _handleUpdated ({ topic }) {
    this.emit('updated', { key: topic })
  }

  _reJoin () {
    for (const topic of this._topics) {
      this.join(topic)
    }
  }

  get connections () {
    if (!this._protocol) return new Set()
    return this._protocol.connections
  }

  join (topic) {
    if (!this._protocol) throw new Error(NOT_CONNECTED)
    this._protocol.join(topic)
    const hasSeen = this._topics.some((other) => other.equals(topic))
    if (!hasSeen) {
      this._topics.push(topic)
    }
  }

  leave (topic) {
    if (!this._protocol) throw new Error(NOT_CONNECTED)
    this._protocol.leave(topic)
    this._topics = this._topics.filter((other) => !other.equals(topic))
    this._seenPeers = this._seenPeers.filter(({ topic: other }) => !other.equals(topic))
  }

  connect (peer, cb = noop) {
    if (!this._protocol) return setTimeout(() => cb(new Error(NOT_CONNECTED)), 0)
    const id = peer.host

    const listenStreams = (stream, details) => {
      const foundId = details.peer.host
      if (foundId !== id) return
      cb(null, stream, details)
      this.removeListener('connection', listenStreams)
    }

    if (cb) {
      this.on('connection', listenStreams)
    }

    this._protocol.connect(id)
  }

  flush (cb = noop) {
    // No clue how to implement this.
    if (cb) process.nextTick(cb)
  }

  status () {
    // Hardcoded since we only do lookups through the proxy
    return { lookup: true, announce: false }
  }

  destroy (cb) {
    this.destroyed = true

    this.disconnect()

    this._topics = null
    this._connectedPeers = null
    this._seenPeers = null

    if (cb) process.nextTick(cb)
  }
}

function noop () {}

class Details {
  constructor (peer, topic) {
    this.type = 'proxy'
    this.client = true

    this.peer = {
      host: peer,
      port: 0,
      local: false,
      topic
    }
  }

  // Can't easily deduplicate yet?
  deduplicate () {
    return false
  }
}
