const Duplex = require('stream').Duplex

module.exports = class ProxyStream extends Duplex {
  constructor (protocol, id) {
    super({
      emitClose: true
    })
    this._secretId = Math.random()
    this._id = id
    this._protocol = protocol
    this._isClosed = false
    this._handle_data = this._handleData.bind(this)
    this._handle_close = this._handleClose.bind(this)
    this._handle_error = this._handleError.bind(this)

    this._protocol.on('on_stream_data', this._handle_data)
    this._protocol.on('on_stream_close', this._handle_close)
    this._protocol.on('on_stream_error', this._handle_error)
    this._protocol.once('end', () => this._cleanup())
  }

  _handleData ({ stream, data }) {
    // See if the event was for this stream
    if (this._isId(stream)) {
      this.push(data)
    }
  }

  _handleClose ({ stream }) {
    if (this._isId(stream)) {
      this.destroy()
      this._cleanup()
    }
  }

  _handleError ({ stream, data }) {
    if (this._isId(stream)) {
      const message = data.toString('utf8')
      this.emit('error', new Error(message))
      this.destroy()
      this._cleanup()
    }
  }

  _cleanup () {
    this._isClosed = true
    this._protocol.removeListener('on_stream_data', this._handle_data)
    this._protocol.removeListener('on_stream_close', this._handle_close)
    this._protocol.removeListener('on_stream_error', this._handle_error)
  }

  _isId (streamid) {
    return streamid === this._id
  }

  _read () { }
  _write (chunk, encoding, callback) {
    this._protocol.onStreamData(this._id, chunk)
    callback()
  }

  _final (callback) {
    if (!this._isClosed) {
      this._protocol.onStreamClose(this._id)
      this._cleanup()
    }
    callback()
  }
}
