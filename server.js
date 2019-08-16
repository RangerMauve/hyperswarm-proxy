const { EventEmitter } = require('events')
const hyperswarm = require('@hyperswarm/network')
const HyperswarmProxyStream = require('./')

module.exports = class HyperswarmProxyServer extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      bootstrap,
      ephemeral,
      network = hyperswarm({
        bootstrap,
        ephemeral,
        bind: () => this.emit('ready'),
        close: () => this.emit('close')
      })
    } = opts

    this.network = network

    this.clients = new Set()
  }

  handleStream (stream, cb = noop) {
    this.network.bind((err) => {
      if (err) return cb(err)

      const client = new Client(stream, this.network)

      this.clients.add(client)

      stream.once('close', () => {
        this.clients.delete(client)
      })
      client.once('error', (e) => {
        // TODO: Output errors to DEBUG
      })

      cb(null, client)
    })
  }

  destroy (cb) {
    for (let client of this.clients) {
      client.destroy()
    }

    this.network.close(cb)
  }
}

class Client extends HyperswarmProxyStream {
  constructor (stream, network) {
    super(stream)

    this.network = network
    this.lookups = new Map()
    this.peerMap = new Map()
    this.connections = new Set()
    this.streamCounter = 0

    this.once('ready', () => {
      this.init()
    })
  }

  init () {
    this.on('join', (data) => this.handleJoin(data))
    this.on('leave', (data) => this.handleLeave(data))
    this.on('connect', (data) => this.handleConnect(data))
  }

  nextStreamId () {
    return this.streamCounter++
  }

  handleJoin ({ topic }) {
    const lookupString = topic.toString('hex')

    // No need to join if already joined
    if (this.lookups.has(lookupString)) {
      // Force restart of lookups
      this.lookups.get(lookupString).update()
      return
    }
    const lookup = this.network.lookup(topic)
    this.lookups.set(lookupString, lookup)

    const announce = this.network.announce(topic)

    lookup.on('peer', (peer) => this.handlePeer(topic, peer))
    lookup.on('close', () => {
      this.lookups.delete(lookupString)
      announce.destroy()
    })
  }

  handleLeave ({ topic }) {
    const lookupString = topic.toString('hex')

    // No need to try to leave topics we're not a part of
    if (!this.lookups.has(lookupString)) return

    const lookup = this.lookups.get(lookupString)

    lookup.destroy()
  }

  handlePeer (topic, peer) {
    const { host, port } = peer

    const id = `${host}:${port}:${topic.toString('hex')}`

    this.peerMap.set(id, peer)

    this.onPeer(topic, id)
  }

  handleConnect ({ peer }) {
    // Don't try connecting to a peer that doesn't exist
    if (!this.peerMap.has(peer)) return

    const peerData = this.peerMap.get(peer)
    const { topic } = peerData

    const id = this.nextStreamId()

    const proxy = this.openStream(topic, peer, id)

    this.network.connect(peerData, (err, socket) => {
      // Tell the other side about the error
      if (err) {
        this.onStreamError(id, err.message)
        proxy.end()
        return
      }

      this.connections.add(socket)

      socket.pipe(proxy).pipe(socket)

      socket.once('error', (err) => {
        console.log('stream error on socket', peerData, err)
        this.onStreamError(id, err.message)
      })

      socket.once('close', () => {
        this.connections.delete(socket)
      })
    })
  }

  destroy () {
    for (let socket of this.connections) {
      socket.end()
    }

    this.network = null

    this.end()
  }
}

function noop () {}
