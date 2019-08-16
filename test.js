const test = require('tape')
const crypto = require('crypto')
const DuplexPair = require('duplexpair')
const streamToPromise = require('stream-to-promise')

const HyperswarmProxyServer = require('./server')
const HyperswarmProxyClient = require('./client')


const TEST_MESSAGE = 'Hello World'
const TEST_TOPIC = makeTopic('HYPERSWARM-PROXY-TEST')

test('Replicate between two instances', (t) => {
  t.plan(2)

  const s1 = new HyperswarmProxyServer()
  const s2 = new HyperswarmProxyServer()

  function cleanup() {
    s1.destroy(() => {
      s2.destroy(() => {
        process.exit(0)
      })
    })
  }

  process.on('SIGINT', cleanup)
  process.on('uncaughtException', cleanup)

  const { socket1: s1Socket, socket2: c1Socket } = new DuplexPair()
  const { socket1: s2Socket, socket2: c2Socket } = new DuplexPair()

  s1.handleStream(s1Socket)
  s2.handleStream(s2Socket)

  const c1 = new HyperswarmProxyClient({
    connection: c1Socket
  })
  const c2 = new HyperswarmProxyClient({
    connection: c2Socket
  })

  c1.on('connection', (connection) => {
    console.log('Got connection')
    streamToPromise(connection, (data) => {
      t.pass('got data on connection 1')
      console.log(data)
    })
    connection.end(TEST_MESSAGE)
  })

  c2.on('connection', (connection) => {
    streamToPromise(connection, (data) => {
      t.pass('got data on connection 2')
      console.log(data)
    })
    connection.end(TEST_MESSAGE)
  })

  c1.join(TEST_TOPIC)

  c2.join(TEST_TOPIC)
})

function makeTopic (text) {
  return crypto.createHash('sha256')
    .update(text)
    .digest()
}
