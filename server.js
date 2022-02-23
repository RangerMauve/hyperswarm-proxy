const { EventEmitter } = require('events')
const os = require('os')
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
        socket: (socket) => this.handleIncoming(socket),
        bind: () => this.emit('ready'),
        close: () => this.emit('close')
      }),
      handleIncoming
    } = opts

    this.shouldAnnounce = false

    if (handleIncoming) {
      this.handleIncoming = handleIncoming
      this.shouldAnnounce = true
    }

    this.network = network

    this.clients = new Set()
  }

  handleIncoming (socket) {
    // By default we just kill incoming connections
    socket.end()
  }

  handleStream (stream, cb = noop) {
    this.network.bind((err) => {
      if (err) return cb(err)

      const client = new Client(stream, this.network, this.shouldAnnounce)

      this.clients.add(client)

      stream.once('close', () => {
        this.clients.delete(client)
      })
      client.once('error', (e) => {
        // TODO: Output errors to DEBUG
        this.emit('error', e)
      })

      cb(null, client)
    })
  }

  connectClientsTo (topic, port, host) {
    const topicString = topic.toString('hex')

    const peerData = {
      port,
      host,
      local: false,
      referrer: null,
      topic
    }

    for (const client of this.clients) {
      if (client.lookups.has(topicString)) {
        client.lookups.get(topicString).emit('peer', peerData)
      }
    }
  }

  destroy (cb) {
    for (const client of this.clients) {
      client.destroy()
    }

    this.network.close(cb)
  }
}

class Client extends HyperswarmProxyStream {
  constructor (stream, network, shouldAnnounce) {
    super(stream)

    this.network = network
    this.lookups = new Map()
    this.peerMap = new Map()
    this.connections = new Set()
    this.streamCounter = 0
    this.shouldAnnounce = shouldAnnounce

    this.handleJoin = this.handleJoin.bind(this)
    this.handleLeave = this.handleLeave.bind(this)
    this.handleConnect = this.handleConnect.bind(this)

    this.once('ready', () => {
      this.init()
    })
  }

  init () {
    this.on('join', this.handleJoin)
    this.on('leave', this.handleLeave)
    this.on('connect', this.handleConnect)
    this.ready()
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

    // Build up the list of what we think might be "us"
    // This should be done very time to account for IP/network interface changes
    // TODO: Move it a layer up and debounce
    this.network.discovery.ping((err, results) => {
      if (!this.network) return

      if (err) return this.emit('error', err)

      const pingAddresses = results.map(({ pong }) => {
        const { host, port } = pong
        return `${host}:${port}`
      })
      const boundPort = this.network.address().port
      const localAddresses = getIPv4Addresses()
        .map(({ address }) => `${address}:${boundPort}`)

      const selfPeerData = new Set(pingAddresses.concat(localAddresses))

      const handlePeer = (peer) => {
        const { host, port } = peer

        const peerString = `${host}:${port}`

        // Ignore connections to ourselves
        if (selfPeerData.has(peerString)) return

        const id = `${peerString}:${topic.toString('hex')}`

        this.peerMap.set(id, peer)

        this.onPeer(topic, id)
      }

      const handleUpdate = () => {
        this.onUpdated(topic)
      }

      const lookup = this.network.lookup(topic)
      this.lookups.set(lookupString, lookup)

      let announce = null
      if (this.shouldAnnounce) {
        announce = this.network.announce(topic)
      }

      lookup.on('peer', handlePeer)
      lookup.on('update', handleUpdate)
      lookup.on('close', () => {
        this.lookups.delete(lookupString)
        if (announce) announce.destroy()
      })
    })
  }

  handleLeave ({ topic }) {
    const lookupString = topic.toString('hex')

    // No need to try to leave topics we're not a part of
    if (!this.lookups.has(lookupString)) return

    const lookup = this.lookups.get(lookupString)

    lookup.destroy()
  }

  connectTo (peerData) {
    const { topic, host, port } = peerData

    const peerId = `${host}:${port}:${topic.toString('hex')}`

    const id = this.nextStreamId()

    const proxy = this.openStream(topic, peerId, id)

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
        this.onStreamError(id, err.message)
      })

      socket.once('close', () => {
        this.connections.delete(socket)
      })
    })
  }

  handleConnect ({ peer }) {
    // Don't try connecting to a peer that doesn't exist
    if (!this.peerMap.has(peer)) return

    const peerData = this.peerMap.get(peer)

    this.connectTo(peerData)
  }

  destroy () {
    this.removeListener('join', this.handleJoin)
    this.removeListener('leave', this.handleLeave)
    this.removeListener('connect', this.handleConnect)

    for (const socket of this.connections) {
      socket.end()
    }

    this.network = null

    this.end()
  }
}

function noop () {}

function getIPv4Addresses () {
  const interfaces = os.networkInterfaces()
  return Object
    .keys(interfaces)
    .map((name) => interfaces[name])
    .reduce((a, b) => a.concat(b))
    .filter(({ family }) => family === 'IPv4')
}
