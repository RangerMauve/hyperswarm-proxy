const { EventEmitter } = require('events')
const network = require('@hyperswarm/network')
const HyperswarmProxyStream = require('./')

module.exports = class HyperswarmProxyServer extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      bootstrap,
      ephemeral
    } = opts

    this.network = network({
      bootstrap,
      ephemeral,
      bind: () => this.emit('ready'),
      close: () => this.emit('close')
    })

    this.clients = new Set()
  }

  handleStream (stream) {
    const client = new Client(stream, this)

    this.clients.add(client)

    stream.once('close', () => {
      this.clients.delete(client)
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
  constructor (stream, swarm) {
    super(stream)

    this.swarm = swarm
    this.lookups = new Map()
    this.peerMap = new Map()
    this.connections = new Set()
    this.streamCounter = 0
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

    const lookup = this.swarm.network.lookup(topic)
    this.lookups.set(lookupString, lookup)

    lookup.on('peer', (peer) => this.handlePeer(topic, peer))
    lookup.on('close', () => {
      this.lookups.delete(lookupString)
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
    const { hostname, port } = peer

    const id = `${hostname}:${port}:${topic.toString('hex')}`

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

    this.swarm.network.connect(peer, (err, socket) => {
      // Tell the other side about the error
      if (err) {
        this.onStreamError(id, err.message)
        proxy.end()
        return
      }

      this.connections.add(socket)

      socket.pipe(proxy).pipe(socket)

      socket.once('error', (err) => {
        this.onStreamError(id, err.message)
      })

      socket.once('close', () => {
        this.connections.delete(socket)
      })
    })
  }

  destroy () {
    for (let socket of this.connections) {
      socket.close()
    }

    this.close()
  }
}
