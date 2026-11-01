# ParnianCoin Pool

Mining pool server for **ParnianCoin (PARC)**, a RandomHash cryptocurrency.
Live instance: https://pool.parniancoin.com — Website: https://parniancoin.com

[فارسی](README.fa.md)

- Stratum server with variable difficulty and per-port settings
- Automatic block unlocking and PARC / account payouts
- Web frontend in English, Persian and Arabic (RTL), with an admin panel
- Optional e-mail notifications for miners (worker start/stop, payments)

## Requirements

| Component | Version / note |
|-----------|----------------|
| OS | Ubuntu 22.04 LTS (other Linux distributions work; Windows: use WSL2) |
| Node.js | **18.x** (the native `bignum` module does not build on Node 20+) |
| Build tools | `build-essential`, `python3` (for the native modules) |
| Redis | 6 or newer |
| ParnianCoin daemon | synced node with JSON-RPC (default `38003`) and mining port (default `38009`) |
| nginx | to serve the frontend and proxy the API (recommended) |

## 1. Install

```bash
sudo apt update
sudo apt install -y build-essential python3 git redis-server nginx

# Node.js 18 through nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18 && nvm use 18

git clone https://github.com/parniancoin/parniancoin-pool.git
cd parniancoin-pool
npm install
```

`npm install` compiles the bundled RandomHash binding in `vendor/node-randomhash`.

## 2. Prepare the node and the pool wallet

1. Run a fully synced ParnianCoin daemon on the same machine.
2. Create (or import) a key for the pool in the node wallet and note:
   - its **encoded public key** (`enc_pubkey`) → `payments.poolEncPubkey`
   - the **main account** that holds the pool funds → `payments.mainAccount`
3. Accounts under that key that must never be touched go into
   `payments.excludeAccounts`.
4. Unlock the wallet once before starting the pool:

```bash
curl -s -X POST http://127.0.0.1:38003 \
  -d '{"jsonrpc":"2.0","method":"unlock","params":{"pwd":"YOUR_WALLET_PASSWORD"},"id":1}'
```

The pool unlocks and relocks the wallet itself during payments using
`daemon.password`.

## 3. Configure

```bash
cp config.example.json config.json
nano config.json
```

`config.json` accepts `//` and `/* */` comments. It is listed in `.gitignore`;
never commit it.

| Key | Meaning |
|-----|---------|
| `poolUrl`, `poolHost` | Frontend URL and the hostname miners connect to |
| `poolServer.ports` | Stratum ports, start difficulty, varDiff range |
| `payments.mainAccount`, `payments.poolEncPubkey` | Pool wallet account and key (step 2) |
| `payments.minPayment`, `interval` | Payout threshold (PARC) and frequency (seconds) |
| `fees.poolFee` | Pool operator fee, % of the miners' share |
| `fees.devFee` | Development fee, % (paid to developer account 9) |
| `fees.networkFee` | Protocol developer share, **20** — do not change |
| `daemon.*` | Node RPC/mining ports and wallet password |
| `redis.*` | Redis host, port, password (`auth`) and key prefix |
| `api.bindIp`, `api.port`, `api.password` | API listen address, port, admin password |
| `email.*` | Notification transport (sendmail, SMTP or Mailgun) |

Replace every `CHANGE_ME` and `YOUR_…` value before starting.

### Fees, explained

ParnianCoin itself sends **20%** of every block reward to developer account 9 at
protocol level; `networkFee: 20` tells the pool that only the remaining 80% is
shared among miners. On top of that the pool takes `devFee` (default 0.5%, also
to account 9) and your own `poolFee`.

## 4. Run

```bash
node init.js                       # all modules
node init.js -config=other.json    # alternative config file
node init.js -module=api           # one module: pool, api, unlocker, payments, charts
```

Run it as a service with systemd (`/etc/systemd/system/parnian-pool.service`):

```ini
[Unit]
Description=ParnianCoin Pool
After=network.target redis-server.service

[Service]
User=parnian
WorkingDirectory=/opt/parniancoin-pool
ExecStart=/home/parnian/.nvm/versions/node/v18.20.4/bin/node init.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parnian-pool
journalctl -u parnian-pool -f
```

Adjust the paths and Node version to your machine (`which node`).

## 5. Website and API behind nginx

1. Edit `website_example/config.js`: `api` must point to your public `/api` URL,
   and the explorer links to your explorer.
2. Copy `website_example/` to the web root, e.g. `/var/www/pool`.
3. nginx server block:

```nginx
server {
    listen 80;
    server_name pool.example.com;
    root /var/www/pool;
    index index.html;

    # /api/stats -> http://127.0.0.1:38400/stats  (prefix stripped)
    location /api/ {
        proxy_pass http://127.0.0.1:38400/;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }
}
```

Add TLS (Let's Encrypt or your CDN). The admin panel is at `/admin.html` and
uses `api.password`.

**Stratum ports are raw TCP** — miners connect to them directly, not through
nginx or an HTTP proxy. If you use a CDN, the stratum hostname must be
DNS-only (not proxied).

## 6. Security checklist

- `api.bindIp` = `127.0.0.1`; expose the API only through nginx.
- Set a Redis password (`requirepass`) and keep Redis on localhost.
- Firewall: open only 80/443 and the stratum ports.
- Strong `api.password` and wallet password; keep `config.json` private.
- Keep only the funds needed for payouts in the pool wallet.

## Connecting a miner

```
stratum+tcp://stratum.parniancoin.com:38008
user: <ACCOUNT>.<WORKER>     e.g. 12345-67.rig1
```

Choose the port that matches your hashrate (listed on the pool's *Getting
Started* page). ParnianMiner and rhminer are supported.

## Author

**Amir Reza Zamani** — https://parniancoin.com — info@parniancoin.com

## Credits

This pool is built on the open-source PascalCoin pool
([PascalCoin/pascalcoin-open-pool](https://github.com/PascalCoin/pascalcoin-open-pool)),
which itself used portions of:

* https://github.com/zone117x/node-cryptonote-pool
* https://github.com/snipa22/node-cryptonote-pool
* https://github.com/dvandal/cryptonote-nodejs-pool
* https://github.com/zone117x/node-open-mining-portal
* https://github.com/foxer666/node-open-mining-portal
* https://github.com/zone117x/node-stratum-pool
* https://github.com/foxer666/node-stratum-pool
* Polyminer's RHMiner — https://github.com/polyminer1/rhminer
* RandomHash binding — https://github.com/PascalCoinFreePool/node-randomhash

## License

Copyright (C) 2026 Amir Reza Zamani. Released under the
[GNU GPL v2](LICENSE).
