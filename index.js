const Duplex = require('stream').Duplex
const lps = require('length-prefixed-stream')
const { SwarmEvent, EventType } = require('./messages')
const ProxyStream = require('./proxystream')
const pump = require('pump')

module.exports = class HyperswarmProxyStream extends Duplex {
  constructor (stream) {
    super({
      emitClose: true
    })
    this.connections = new Set()

    // There's going to be a lot of listeners
    this.setMaxListeners(256)

    pump(
      stream,
      lps.decode(),
      this,
      lps.encode(),
      stream, () => {
        this._closeAllStreams()
      })

    this.on('on_stream_open', this._handleStreamOpen.bind(this))
  }

  ready () {
    this.sendMessage('READY')
  }

  join (topic) {
    this.sendMessage('JOIN', { topic })
  }

  leave (topic) {
    this.sendMessage('LEAVE', { topic })
  }

  onPeer (topic, peer) {
    this.sendMessage('ON_PEER', { topic, peer })
  }

  onUpdated (topic) {
    this.sendMessage('ON_UPDATED', { topic })
  }

  connect (peer) {
    this.sendMessage('CONNECT', { peer })
  }

  onStreamOpen (topic, peer, stream) {
    this.sendMessage('ON_STREAM_OPEN', { topic, peer, stream })
  }

  onStreamData (stream, data) {
    if (typeof data === 'string') {
      data = Buffer.from(data, 'utf8')
    }
    this.sendMessage('ON_STREAM_DATA', { stream, data })
  }

  onStreamClose (stream) {
    this.sendMessage('ON_STREAM_CLOSE', { stream })
  }

  onStreamError (stream, message, peer) {
    const data = Buffer.from(message, 'utf8')
    this.sendMessage('ON_STREAM_ERROR', { stream, data })
  }

  openStream (topic, peer, stream) {
    const proxy = new ProxyStream(this, stream)

    this._addStream(proxy)

    this.onStreamOpen(topic, peer, stream)

    return proxy
  }

  _closeAllStreams () {
    for (const connection of this.connections) {
      connection.end()
    }
  }

  _addStream (stream) {
    this.connections.add(stream)
    stream.once('close', () => {
      this.connections.delete(stream)
    })
  }

  _handleStreamOpen ({ topic, peer, stream }) {
    const proxy = new ProxyStream(this, stream)

    this._addStream(proxy)

    this.emit('stream', proxy, { topic, peer })
  }

  sendMessage (type, data = {}) {
    this.push(SwarmEvent.encode({
      type: EventType[type],
      ...data
    }))
  }

  _write (chunk, encoding, callback) {
    try {
      const decoded = SwarmEvent.decode(chunk)

      const { type } = decoded

      for (const name of Object.keys(EventType)) {
        if (EventType[name] === type) {
          this.emit(name.toLowerCase(), decoded)
        }
      }
      callback()
    } catch (e) {
      callback(e)
    }
  }

  // NOOP
  _read () {}
}
