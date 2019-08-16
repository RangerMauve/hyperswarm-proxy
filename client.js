const EventEmitter = require('events')
const HyperswarmProxyStream = require('./')

const NOT_CONNECTED = 'Not connected to proxy'

module.exports = class HyperswarmProxyClient extends EventEmitter {
  constructor (options = {}) {
    super()

    const { connection, autoconnect = true } = options

    if (!connection) throw new TypeError('must specify initial `connection` in options')

    this._handleStream = this._handleStream.bind(this)
    this._handleClose = this._handleClose.bind(this)
    this._handlePeer = this._handlePeer.bind(this)

    this._protocol = null

    this._topics = []
    this._connectedPeers = new Set()
    this._seenPeers = []

    this._autoconnect = autoconnect

    this.reconnect(connection)
  }

  reconnect (connection) {
    if (this._protocol) {
      this._protocol.removeListener('close', this._handleClose)
      this._protocol.end()
      this._protocol = null
    }

    this._protocol = new HyperswarmProxyStream(connection)

    this._protocol.on('stream', this._handleStream)
    this._protocol.on('on_peer', this._handlePeer)
    this._protocol.ready()
  }

  _handleStream (stream, { topic, peer }) {
    const details = {
      type: 'proxy',
      client: true,
      peer: {
        host: peer,
        port: 0,
        local: false,
        topic
      }
    }

    this.emit('connection', stream, details)

    this._connectedPeers.add(peer)

    stream.once('close', () => {
      this.emit('disconnection', stream, details)
      this._connectedPeers.delete(peer)
    })
  }

  _handleClose () {
    this._protocol = null
    this.emit('disconnected')
  }

  _handlePeer ({ topic, peer }) {
    const peerData = {
      host: peer,
      port: 0,
      local: false,
      topic
    }

    this.emit('peer', peerData)

    if (this._autoconnect && !this._connectedPeers.has(peer)) {
      this.connect(peerData)
    } else if(!this._seenPeers.find(data => data.peer === peer)) {
      this._seenPeers.push(peerData)
    }
  }

  get connections () {
    if (!this._protocol) return new Set()
    return this._protocol.connections
  }

  join (topic) {
    if (!this._protocol) throw new Error(NOT_CONNECTED)
    this._protocol.join(topic)
    this._topics.push(topic)
  }

  leave (topic) {
    if (!this._protocol) throw new Error(NOT_CONNECTED)
    this._protocol.leave(topic)
    this._topics = this._topics.filter((other) => !other.equals(topic))
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
}

function noop () {}
