/**
 * ParnianCoin Open Pool
 * https://github.com/ParnianCoinPool/parniancoin-open-pool
 *
 * Payments processor
 **/

// Load required modules
var fs = require("fs");
var async = require("async");

// get daemon RPC instance
var daemon = require("./daemon.js");
var daemonRpc = new daemon.Rpc();

var notifications = require("./notifications.js");
var utils = require("./utils.js");

// Initialize log system
var logSystem = "payments";
require("./exceptionWriter.js")(logSystem);

/**
 * Run payments processor
 **/

log("info", logSystem, "Started");


function unlock(callback) {
    log("info", logSystem, "Unlocking wallet");
    daemonRpc.async("unlock", {"pwd": config.daemon.password})
        .then((data) => {
            if(data.hasOwnProperty("error")) {
                log("error", logSystem, "Error unlocking wallet");
                callback(true);
                return;
            }
            callback(null);
        });
}

function lock(callback) {
    log("info", logSystem, "Locking wallet");
    daemonRpc.async("lock")
        .then((data) => {
            if(data.hasOwnProperty("error")) {
                log("error", logSystem, "Error locking wallet");
                return;
            }
        });
}


function getHeight(callback) {
    daemonRpc.async("getblockcount")
        .then((data) => {
            if(data.hasOwnProperty("error")) {
                log("error", logSystem, "Error with getblockcount RPC request");
                callback(true);
                return;
            }
            callback(null,data.result);
        });
}

// Sweep newly mined accounts to first acct
function sweepAccounts(height, callback) {
    daemonRpc.async("getwalletaccounts", {"enc_pubkey": config.payments.poolEncPubkey, "max":100000})
        .then((data) => {
            if(data.hasOwnProperty("error")) {
                log("error", logSystem, "Error with getwalletaccounts RPC request");
                callback(true);
                return;
            }
            if(data.result.length == 0) {
                log("warn", logSystem, "Account has no ACCOUNT");
                callback(true);
                return;
            }
            var want = String(config.payments.poolEncPubkey || "").toUpperCase();
            var exclude = config.payments.excludeAccounts || [];
            var accounts = data.result.filter(function(a) {
                return want && String(a.enc_pubkey).toUpperCase() === want && exclude.indexOf(Number(a.account)) === -1;
            });
            var mainAccount = config.payments.mainAccount;
            if (!accounts.some(function(a) { return a.account == mainAccount; })) {
                log("error", logSystem, "Main account %s not found under pool key. Stopping payments.", [mainAccount]);
                callback(true);
                return;
            }
            var emptyAccount = [];

            async.eachLimit(accounts, 10, function(account, callback2) {
                if(account.account == mainAccount) {
                    callback2();
                    return;
                }
                var minedHeight = Math.floor(account.account / 5);
                if(minedHeight + 100 < height) {
                    // unlocked
                    if(account.balance == 0) {
                        // this is empty, if no pending ops then allow to be sent to miner
                        if(account.updated_b != height) {
                            emptyAccount.push(account.account);
                        }
                        callback2();
                    } else if(account.updated_b != height) {
                        // sweep the balance to the first account
                        var sweepFee = 0; // or 0.0001
                        daemonRpc.async("sendto", {
                            "sender": account.account,
                            "target": mainAccount,
                            "amount": account.balance - sweepFee,
                            "fee": sweepFee
                        }).then((data) => {
                            if(data.hasOwnProperty("error")) {
                                console.log(data); // TODO add these to log
                                log("error", logSystem, "Error sweeping balance from %s to %s", [account.account, mainAccount]);
                                callback2(); // skip failed account, do not stop all payments
                            } else {
                                log("info", logSystem, "Swept %s balance from %s to %s",
                                    [data.result.amount, data.result.sender_account, data.result.dest_account]);
                                callback2();
                            }
                        });
                    } else {
                        callback2();
                    }
                } else {
                    callback2();
                }
            }, function(err) {
                if(err) {
                    log("error", logSystem, "Error sweeping some balances. Stopping payments.");
                    callback(true);
                    return;
                }
                log("info", logSystem, "Swept all balances");
                callback(null, {
                    "main": mainAccount,
                    "empty": emptyAccount
                });
            });
        });
}


// Get worker keys
function getWorkers(accounts, callback) {
    redisClient.keys(redisPrefix + ":workers:*", function(error, result) {
        if(error) {
            log("error", logSystem, "Error trying to get worker balances from redis %j", [error]);
            callback(true);
            return;
        }
        callback(null, accounts, result);
    });
}

// Get worker balances
function getWorkerBalance(accounts, keys, callback) {
    var redisCommands = keys.map(function(k) {
        return ["hget", k, "balance"];
    });
    redisClient.multi(redisCommands).exec(function(error, replies) {
        if(error) {
            log("error", logSystem, "Error with getting balances from redis %j", [error]);
            callback(true);
            return;
        }

        var balances = {};
        for(var i = 0; i < replies.length; i++) {
            var parts = keys[i].split(":");
            var workerId = parts[parts.length - 1];

            balances[workerId] = parseInt(replies[i]) || 0;
        }
        callback(null, accounts, keys, balances);
    });
}

// Get worker balances
function getWorkerAccountBalance(accounts, keys, balances, callback) {
    var redisCommands = keys.map(function(k) {
        return ["hget", k, "accountBalance"];
    });
    redisClient.multi(redisCommands).exec(function(error, replies) {
        if(error) {
            log("error", logSystem, "Error with getting account balances from redis %j", [error]);
            callback(true);
            return;
        }

        var accountBalances = {};
        for(var i = 0; i < replies.length; i++) {
            var parts = keys[i].split(":");
            var workerId = parts[parts.length - 1];

            accountBalances[workerId] = parseInt(replies[i]) || 0;
        }
        callback(null, accounts, keys, balances, accountBalances);
    });
}

// Get worker minimum payout
function getWorkerPayoutLevels(accounts, keys, balances, accountBalances, callback) {
    var redisCommands = keys.map(function(k) {
        return ["hget", k, "minPayoutLevel"];
    });
    redisClient.multi(redisCommands).exec(function(error, replies) {
        if(error) {
            log("error", logSystem, "Error with getting minimum payout from redis %j", [error]);
            callback(true);
            return;
        }

        var minPayoutLevel = {};
        for(var i = 0; i < replies.length; i++) {
            var parts = keys[i].split(":");
            var workerId = parts[parts.length - 1];

            var minLevel = config.payments.minPayment;
            var maxLevel = config.payments.maxPayment;
            var defaultLevel = config.payments.defaultPayment;

            var payoutLevel = parseFloat(replies[i]) || defaultLevel;
            if(payoutLevel < minLevel) payoutLevel = minLevel;
            if(maxLevel && payoutLevel > maxLevel) payoutLevel = maxLevel;
            minPayoutLevel[workerId] = payoutLevel;

            if(payoutLevel !== defaultLevel) {
                log("info", logSystem, "Using payout level of %s for %s (default: %s)",
                    [minPayoutLevel[workerId], workerId, defaultLevel]);
            }
        }
        callback(null, accounts, keys, balances, accountBalances, minPayoutLevel);
    });
}

// Get worker Public Keys
function getWorkerPublicKeys(accounts, keys, balances, accountBalances, minPayoutLevel, callback) {
    var redisCommands = keys.map(function(k) {
        return ["hget", k, "publicKey"];
    });
    redisClient.multi(redisCommands).exec(function(error, replies) {
        if(error) {
            log("error", logSystem, "Error with getting publicKeys from redis %j", [error]);
            callback(true);
            return;
        }

        var publicKeys = {};
        for(var i = 0; i < replies.length; i++) {
            var parts = keys[i].split(":");
            var workerId = parts[parts.length - 1];
            var publicKey = replies[i] || false;

            publicKeys[workerId] = publicKey;

        }
        callback(null, accounts, keys, balances, accountBalances, minPayoutLevel, publicKeys);
    });
}

function getDevFee(accounts, keys, balances, accountBalances, minPayoutLevel, publicKeys, callback) {
    redisClient.hget(redisPrefix + ":stats", "devFee", function(error, devFee) {
        var devFee = devFee ? devFee : 0;
        callback(null, accounts, keys, balances, accountBalances, minPayoutLevel, publicKeys, devFee);
    });
}

function makePayment(accounts, keys, balances, accountBalances, minPayoutLevel, publicKeys, devFee, callback) {
    var now = Date.now() / 1000 | 0;

    var payments = {};
    var accountPayments = [];

    for(var worker in balances) {
        var balance = balances[worker];
        if(balance >= minPayoutLevel[worker] * 10000) {
            payments[worker] = balance;
        }
    }

    for(var worker in accountBalances) {
        var donate = false;
        if(publicKeys[worker] == false) {
            if(config.payments.accountDonations == false) {
                continue;
            } else {
                donate = true;
                publicKeys[worker] = config.payments.accountDonations;
            }
        }
        var numAccounts = Math.floor(accountBalances[worker] / (config.payments.accountThreshold * 10000));
        for(var i = 0; i < numAccounts; i++) {
            accountPayments.push([worker, donate]);
        }
    }
    // Shuffle ACCOUNT payment array
    utils.shuffleArray(accountPayments);

    if(devFee > 1) {
        daemonRpc.async("sendto", {
            "sender": accounts.main,
            "target": "9",
            "payload": Buffer.from("Devfee from "+config.poolHost).toString("hex"),
            "payload_method": "none",
            "amount": ((devFee - 1) / 10000).toFixed(4),
            "fee": 0.0001
        }).then((data) => {
            if(data.hasOwnProperty("error")) {
                log("error", logSystem, "Error making devfee payment: %s PARC", [((devFee - 1) / 10000).toFixed(4)]);
                console.log(data);
            } else {
                redisClient.hset(redisPrefix + ":stats", "devFee", 0);
                log("info", logSystem, "Devfee payment made: %s PARC", [((devFee - 1) / 10000).toFixed(4)]);
            }
        });
    }


    if(Object.keys(payments).length === 0 && Object.keys(accountPayments).length === 0) {
        log("info", logSystem, "No workers' balances reached the minimum payment threshold");
        callback(true);
        return;
    }

    // Do ACCOUNT payouts
    var totalAccountSuccess = 0;
    var totalAccountFailed = 0;

    async.eachLimit(accountPayments, 10, function(payment, callback2) {
        var worker = payment[0];
        var donate = payment[1];
        if(publicKeys[worker] == false) {
            log("warn", logSystem, "No public key for worker %s", [worker]);
            callback2();
            return;
        }
        if(accounts.empty.length == 0) {
            log("warn", logSystem, "Not enough ACCOUNT to pay out to %s", [worker]);
            totalAccountFailed++;
            callback2();
            return;
        }
        var account = accounts.empty.shift();
        daemonRpc.async("changekey", {
            "account": account,
            "new_b58_pubkey": publicKeys[worker],
            "fee": 0
        }).then((data) => {
            if(data.hasOwnProperty("error")) {
                console.log(data);
                log("error", logSystem, "Error transferring ACCOUNT to %s", [worker]);
                totalAccountFailed++;
                callback2();
            } else {

                var login_parts = utils.validateLogin(data.result.account.toString());
                var redisCommands = [];

                log("info", logSystem, "Sent ACCOUNT %s to %s", [login_parts.address, worker]);

                redisCommands.push(["hincrby", redisPrefix + ":workers:" + worker, "accountBalance", "-" + Math.floor(config.payments.accountThreshold * 10000)]);

                redisCommands.push(["zadd", redisPrefix + ":accountPayments:all", now, [
                    data.result.ophash,
                    0, // fee
                    login_parts.address,
                    worker
                ].join(":")]);

                if(donate) {
                    redisCommands.push(["zadd", redisPrefix + ":accountPayments:donation", now, [
                        data.result.ophash,
                        0, // fee
                        login_parts.address
                    ].join(":")]);
                } else {
                    redisCommands.push(["hincrby", redisPrefix + ":workers:" + worker, "accountPaid", 1]);
                    redisCommands.push(["zadd", redisPrefix + ":accountPayments:" + worker, now, [
                        data.result.ophash,
                        0, // fee
                        login_parts.address
                    ].join(":")]);

                    notifications.sendToMiner(worker, "payment_account", {
                        "ACCOUNT": data.result.account,
                        "PUBLIC_KEY": publicKeys[worker]
                    });
                }

                redisClient.multi(redisCommands).exec(function(error, replies) {
                    if(error) {
                        log("error", logSystem, "Super critical error! ACCOUNT sent yet failing to update balance in redis, double ACCOUNT payouts likely to happen %j", [error]);
                        log("error", logSystem, "Double ACCOUNT payments likely to be sent to %j", worker);
                        totalAccountFailed++;
                        callback2(true);
                        return;
                    }
                    totalAccountSuccess++;
                    callback2();
                });
            }
        });
    }, function(err) {
        if(err) {
            log("error", logSystem, "Not enough unlocked ACCOUNT.");
        }

        if(accountPayments.length) {
            log("info", logSystem, "ACCOUNT: %s successfully sent, %s failed", [totalAccountSuccess, totalAccountFailed]);
        } else {
            log("info", logSystem, "No ACCOUNT payments needed to be made");
        }

        var totalParcPaid = 0;
        var totalParcSuccess = 0;
        var totalParcFailed = 0;

        // Do PARC payments
        async.eachOfLimit(payments, 10, function(amount, worker, callback2) {

            var destAddr = utils.validateLogin(worker);
            if(!destAddr.valid) {
                log("error", logSystem, "Invalid payment address %s", [worker]);
                callback2();
                return;
            }

            if(destAddr.address.split("-")[0] == "86646") {
                log("error", logSystem, "Stopped payment to polo %s", [worker]);
                callback2();
                return;
            }

            if(destAddr.payment_id == "0") {
                var encodedPaymentId = "";
            } else {
                var encodedPaymentId = Buffer.from(destAddr.payment_id).toString("hex");
            }

            daemonRpc.async("sendto", {
                "sender": accounts.main,
                "target": destAddr.address.split("-")[0],
                "payload": encodedPaymentId,
                "payload_method": "none",
                "amount": ((amount - 1) / 10000).toFixed(4),
                "fee": 0.0001
            }).then((data) => {
                if(data.hasOwnProperty("error")) {
                    console.log(data);
                    log("error", logSystem, "Error making payment to %s (Balance may be locked)", [worker]);
                    totalParcFailed++;
                    callback2(true);
                } else {
                    log("info", logSystem, "Sent payment of %s to %s.%s",
                        [((amount - 1) / 10000).toFixed(4), destAddr.address, destAddr.payment_id]);

                    var redisCommands = [];
                    redisCommands.push(["hincrby", redisPrefix + ":workers:" + worker, "balance", -amount]);
                    redisCommands.push(["hincrby", redisPrefix + ":workers:" + worker, "paid", (amount - 1)]);
                    redisCommands.push(["zadd", redisPrefix + ":payments:all", now, [
                        data.result.ophash,
                        amount - 1,
                        1, // 0.0001 fee
                        worker
                    ].join(":")]);

                    redisCommands.push(["zadd", redisPrefix + ":payments:" + worker, now, [
                        data.result.ophash,
                        amount - 1,
                        1, // 0.0001 fee
                    ].join(":")]);

                    notifications.sendToMiner(worker, "payment_parc", {
                        "ACCOUNT": destAddr.address,
                        "PAYMENT_ID": destAddr.payment_id,
                        "AMOUNT": ((amount - 1) / 10000).toFixed(4),
                    });

                    redisClient.multi(redisCommands).exec(function(error, replies) {
                        if(error) {
                            log("error", logSystem, "Super critical error! Payment sent yet failing to update balance in redis, double payouts likely to happen %j", [error]);
                            log("error", logSystem, "Double payments likely to be sent to %j", worker);
                            totalParcFailed++;
                            callback2(true);
                            return;
                        }
                        totalParcPaid += amount;
                        totalParcSuccess++;
                        callback2();
                    });

                }
            });

        }, function(err) {
            if(err) {
                log("error", logSystem, "Error transferring some PARC. Stopping payments.");
            } else {
                if(Object.keys(payments).length) {
                    log("info", logSystem, "%s payments sent to %s workers (%s PARC paid out)",
                        [totalParcSuccess, Object.keys(payments).length, (totalParcPaid / 10000).toFixed(4)]);
                } else {
                    log("info", logSystem, "No payments needed to be made");
                }
            }
            callback(null);
        });

    });

}

function runInterval() {
    async.waterfall([
        unlock,
        getHeight,
        sweepAccounts,
        getWorkers,
        getWorkerBalance,
        getWorkerAccountBalance,
        getWorkerPayoutLevels,
        getWorkerPublicKeys,
        getDevFee,
        makePayment
    ], function(error, result) {
        lock();
        setTimeout(runInterval, config.payments.interval * 1000);
    });
}

runInterval();
