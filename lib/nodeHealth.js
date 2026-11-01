// ParnianCoin pool - daemon health watchdog
var http = require('http');

var RPC_HOST = '127.0.0.1';
var RPC_PORT = 38003;
var CHECK_INTERVAL = 5000;       // check every 5 seconds
var STALL_LIMIT = 0;             // 0 = disabled (avoids deadlock when no miners are connected)
var FAILS_TO_DOWN = 3;           // consecutive failures before marking unhealthy
var OKS_TO_UP = 3;               // consecutive successes before marking healthy again

var state = { healthy: true, fails: 0, oks: 0, lastHeight: 0, lastHeightChange: Date.now() };
var listeners = [];

function nodestatus(cb) {
    var body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nodestatus', params: {} });
    var req = http.request({
        host: RPC_HOST, port: RPC_PORT, method: 'POST', path: '/',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 4000
    }, function (res) {
        var data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
            try { var j = JSON.parse(data); cb(j.error || null, j.result); }
            catch (e) { cb(e); }
        });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { cb(e); });
    req.end(body);
}

function setHealthy(v, reason) {
    if (state.healthy === v) return;
    state.healthy = v;
    console.log('[nodeHealth] node is now ' + (v ? 'HEALTHY' : 'UNHEALTHY') + (reason ? ' (' + reason + ')' : ''));
    listeners.forEach(function (fn) { try { fn(v); } catch (e) { console.error(e); } });
}

function judge(ok, reason) {
    if (ok) { state.oks++; state.fails = 0; if (state.oks >= OKS_TO_UP) setHealthy(true); }
    else    { state.fails++; state.oks = 0; if (state.fails >= FAILS_TO_DOWN) setHealthy(false, reason); }
}

function check() {
    nodestatus(function (err, st) {
        if (err || !st) return judge(false, 'rpc error: ' + (err && err.message ? err.message : err));
        if (!st.ready) return judge(false, 'node not ready');
        if (!st.netstats || st.netstats.active < 1) return judge(false, 'no active peers');
        if (st.blocks !== state.lastHeight) { state.lastHeight = st.blocks; state.lastHeightChange = Date.now(); }
        if (STALL_LIMIT > 0 && Date.now() - state.lastHeightChange > STALL_LIMIT) return judge(false, 'height stalled at ' + st.blocks);
        judge(true);
    });
}

setInterval(check, CHECK_INTERVAL);
check();

module.exports = {
    isHealthy: function () { return state.healthy; },
    onChange: function (fn) { listeners.push(fn); }
};
