<div dir="rtl">

# استخر ماینینگ پرنیان‌کوین

سرور استخر ماینینگ برای **پرنیان‌کوین (PARC)**، رمزارزی با الگوریتم RandomHash.
نمونهٔ فعال: https://pool.parniancoin.com — وب‌سایت: https://parniancoin.com

[English](README.md)

## پیش‌نیازها

| مورد | نسخه / توضیح |
|------|---------------|
| سیستم‌عامل | Ubuntu 22.04 (در ویندوز از WSL2 استفاده کنید) |
| Node.js | **نسخهٔ 18** (ماژول `bignum` روی Node 20 به بالا کامپایل نمی‌شود) |
| ابزار build | `build-essential` و `python3` |
| Redis | نسخهٔ 6 یا بالاتر |
| نود پرنیان‌کوین | سینک‌شده، با JSON-RPC (پیش‌فرض `38003`) و پورت ماینینگ (پیش‌فرض `38009`) |
| nginx | برای سایت و پراکسی API |

## ۱. نصب

</div>

```bash
sudo apt update
sudo apt install -y build-essential python3 git redis-server nginx

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18 && nvm use 18

git clone https://github.com/parniancoin/parniancoin-pool.git
cd parniancoin-pool
npm install
```

<div dir="rtl">

## ۲. آماده‌سازی نود و کیف پول استخر

1. نود پرنیان‌کوین را روی همان سرور اجرا کنید تا کامل سینک شود.
2. در کیف پول نود یک کلید برای استخر بسازید و این‌ها را یادداشت کنید:
   - **کلید عمومی رمزگذاری‌شده** (`enc_pubkey`) ← `payments.poolEncPubkey`
   - **حساب اصلی** استخر ← `payments.mainAccount`
3. حساب‌هایی از همان کلید که استخر نباید به آن‌ها دست بزند ← `payments.excludeAccounts`
4. قبل از اولین اجرا کیف پول را باز کنید:

</div>

```bash
curl -s -X POST http://127.0.0.1:38003 \
  -d '{"jsonrpc":"2.0","method":"unlock","params":{"pwd":"رمز کیف پول"},"id":1}'
```

<div dir="rtl">

## ۳. تنظیمات

</div>

```bash
cp config.example.json config.json
nano config.json
```

<div dir="rtl">

فایل `config.json` کامنت `//` و `/* */` را می‌پذیرد و در `.gitignore` است؛ هرگز آن را commit نکنید.
همهٔ مقدارهای `CHANGE_ME` و `YOUR_…` را با مقدار واقعی عوض کنید.

| کلید | کاربرد |
|------|--------|
| `poolUrl` و `poolHost` | آدرس سایت و هاستی که ماینر به آن وصل می‌شود |
| `poolServer.ports` | پورت‌های استراتوم و سختی شروع |
| `payments.mainAccount` و `poolEncPubkey` | حساب و کلید کیف پول استخر |
| `payments.minPayment` و `interval` | حداقل پرداخت (PARC) و فاصلهٔ پرداخت (ثانیه) |
| `fees.poolFee` | کارمزد اپراتور استخر (درصد) |
| `fees.devFee` | کارمزد توسعه (درصد، به حساب ۹) |
| `fees.networkFee` | سهم توسعه‌دهنده در پروتکل، **۲۰** — تغییر ندهید |
| `daemon.*` | پورت‌های RPC و ماینینگ نود و رمز کیف پول |
| `redis.*` | آدرس، پورت، رمز و پیشوند Redis |
| `api.*` | آدرس و پورت API و رمز پنل مدیریت |
| `email.*` | ارسال ایمیل اطلاع‌رسانی (sendmail، SMTP یا Mailgun) |

**کارمزدها:** خود شبکهٔ پرنیان‌کوین ۲۰٪ پاداش هر بلاک را در سطح پروتکل به حساب ۹ می‌فرستد؛ `networkFee: 20` به استخر می‌گوید فقط ۸۰٪ باقی‌مانده بین ماینرها تقسیم شود. علاوه بر آن `devFee` (پیش‌فرض ۰٫۵٪) و `poolFee` خودتان کسر می‌شود.

## ۴. اجرا

</div>

```bash
node init.js                     # همهٔ ماژول‌ها
node init.js -module=api         # فقط یک ماژول: pool, api, unlocker, payments, charts
```

<div dir="rtl">

برای سرویس systemd نمونهٔ فایل در [README.md](README.md#4-run) آمده است.

## ۵. سایت و API پشت nginx

1. در `website_example/config.js` مقدار `api` را آدرس عمومی `/api` خودتان بگذارید.
2. پوشهٔ `website_example/` را در مسیر وب‌سرور کپی کنید (مثلاً `/var/www/pool`).
3. در nginx مسیر `/api/` را به `http://127.0.0.1:38400/` پراکسی کنید (پیشوند `/api` حذف شود). نمونهٔ کامل در [README.md](README.md#5-website-and-api-behind-nginx).

**پورت‌های استراتوم TCP خام هستند** و ماینر مستقیم به آن‌ها وصل می‌شود، نه از طریق nginx. اگر از Cloudflare استفاده می‌کنید، رکورد استراتوم باید DNS-only (خاکستری) باشد.

## ۶. نکات امنیتی

- `api.bindIp` را `127.0.0.1` بگذارید و API را فقط از طریق nginx منتشر کنید.
- برای Redis رمز بگذارید و فقط روی localhost نگهش دارید.
- در فایروال فقط پورت‌های 80/443 و پورت‌های استراتوم باز باشند.
- رمز پنل مدیریت و کیف پول قوی باشد و `config.json` را جایی منتشر نکنید.
- در کیف پول استخر فقط به اندازهٔ پرداخت‌ها موجودی نگه دارید.

## اتصال ماینر

</div>

```
stratum+tcp://stratum.parniancoin.com:38008
user: <حساب>.<نام ماینر>      مثال: 12345-67.rig1
```

<div dir="rtl">

## نویسنده

**امیررضا زمانی** — https://parniancoin.com — info@parniancoin.com

## لایسنس

حق نشر © ۲۰۲۶ امیررضا زمانی. منتشرشده تحت [GNU GPL v2](LICENSE).
فهرست پروژه‌هایی که این استخر بر پایهٔ آن‌ها ساخته شده در بخش Credits فایل [README.md](README.md#credits) آمده است.

</div>
