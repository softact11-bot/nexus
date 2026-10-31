// M4a local-access guard, used once for every request (tracker.js): Host is this tracker, the socket is loopback,
// an Origin (if sent) is this tracker, and a POST comes from this tracker's pages with a JSON body.
// Stops websites and DNS-rebinding pages from reading or changing anything. Other Windows users: M4b launch token.
module.exports = (q, port) => {
  const hosts = ['127.0.0.1:' + port, 'localhost:' + port], o = q.headers.origin;
  if (!hosts.includes(q.headers.host)) return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(q.socket.remoteAddress)) return false;
  if (o !== undefined && !hosts.some(h => o === 'http://' + h)) return false;
  if (q.method === 'POST' && (o === undefined || !/^application\/json/.test(q.headers['content-type'] || ''))) return false;
  return true;
};
