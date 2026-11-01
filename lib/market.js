/**
 * ParnianCoin Open Pool
 * https://github.com/ParnianCoinPool/parniancoin-open-pool
 *
 * Market price — reads the central ParnianCoin price API (wallet market).
 * Response keeps the old CryptoCompare shape ({ USD: x, LTC: y, ... }) so the
 * pool website keeps working, plus a few extra fields:
 *   source: "indicative_ask" | "vwap_7d" | "last_trade" | "none"
 *   updated_at: ISO timestamp from the price API
 **/

var requestPromise = require("request-promise");

// Initialize log system
var logSystem = 'market';
require('./exceptionWriter.js')(logSystem);

var PRICE_API = "http://127.0.0.1:38200/api/price";
var CACHE_MS = 60000;

var cache = {};
var cache_time = 0;

exports.get = function(callback) {
    if (Date.now() - cache_time < CACHE_MS) {
        callback(cache);
        return;
    }
    requestPromise({ uri: PRICE_API, json: true, timeout: 2000 })
        .then(function(p) {
            if (!p || typeof p.price !== "number" || p.price <= 0) {
                callback(cache_time ? cache : { error: { code: -3, message: "No market price yet" } });
                return;
            }
            var out = {
                LTC: p.price,
                source: p.source,
                updated_at: p.updated_at
            };
            if (typeof p.price_usd === "number" && p.price_usd > 0) {
                out.USD = p.price_usd;
            }
            cache = out;
            cache_time = Date.now();
            callback(out);
        })
        .catch(function() {
            // Serve the last good value if we have one, otherwise report the error
            callback(cache_time ? cache : { error: { code: -1, message: "Cannot fetch price" } });
        });
};