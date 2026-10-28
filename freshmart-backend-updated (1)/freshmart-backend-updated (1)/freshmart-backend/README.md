# FreshMart Backend — Home Hosting Setup

This replaces your AWS EC2-hosted API (`http://54.144.58.195`) with a server
running on a PC/machine at your home or office. Your SQL Server database at
`103.211.203.145:1433` is **not** on AWS, so nothing changes there — this
server just connects to it the same way your AWS server did.

## 1. Prerequisites on the home machine

- Windows 10/11 or Windows Server (matches your SQL Server box) or Linux
- [Node.js LTS](https://nodejs.org) installed (v18 or v20)
- Network access from this machine to `103.211.203.145:1433` (test with
  `Test-NetConnection 103.211.203.145 -Port 1433` in PowerShell)

## 2. Install

```bash
cd freshmart-backend
npm install
```

`.env` is already filled in with your real connection details (server
`103.211.203.145`, database `ynot`, login `sa`). You shouldn't need to
touch it unless something changes.

## 2b. Confirm the database schema (do this once)

```bash
node check-schema.js
```

This connects with your real credentials and prints the actual column
names for `AcUser`, `AcSales`, `AcSalesDetails`, `AcGroups`, `AcCompany`.
Copy the full output and send it back — the SQL in `routes/auth.js` and
`routes/sales.js` currently uses best-guess column names (`NetAmount`,
`CostAmount`, `InvDate`, etc.) inferred from the SSMS screenshot, not your
actual schema, so this step is what makes login and the reports return
real data instead of SQL errors.

## 3. Run it

```bash
npm start
```

Visit `http://localhost:80/health` — you should see `{"status":"ok"}`.

## 4. Keep it running permanently (Windows)

Install [PM2](https://pm2.keymetrics.io/) so the server restarts automatically
if it crashes or the PC reboots:

```bash
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
pm2 start server.js --name freshmart-api
pm2 save
```

## 5. Expose it to the internet (replacing the AWS public IP)

Your home internet connection likely has a **dynamic IP** (changes
periodically) and sits behind a router/NAT — unlike a static AWS EC2 IP.
Two options, pick one:

### Option A — Cloudflare Tunnel (recommended)
No router port-forwarding needed, free HTTPS, hides your home IP.

1. Create a free Cloudflare account, add a domain (or use their free
   subdomain options via `try.cloudflare.com` style tunnels)
2. Install `cloudflared` on the home machine
3. Run: `cloudflared tunnel --url http://localhost:80`
4. You'll get a public HTTPS URL like `https://random-name.trycloudflare.com`
   — use this as your new `API_BASE_URL`

### Option B — Router port forward + Dynamic DNS
1. In your router admin page, forward external port 443 (or 80) → the home
   PC's local IP, on the port your Node server listens on
2. Sign up for a free Dynamic DNS service (e.g. DuckDNS, No-IP) so you get
   a fixed hostname (e.g. `freshmart.duckdns.org`) even though your IP
   changes
3. Put a reverse proxy (nginx or Caddy) in front of Node to get free HTTPS
   via Let's Encrypt — don't expose plain HTTP to the internet
4. Use `https://freshmart.duckdns.org` as your new `API_BASE_URL`

**Either way:** never expose SQL Server's port 1433 directly to the
internet — only this API server should be reachable from outside. Keep
Windows Firewall on and only allow the port your Node app listens on.

## 6. Update the mobile app

In `src/services/api.js`, change:

```js
const API_BASE_URL = 'http://54.144.58.195';
```

to your new home-hosted URL, e.g.:

```js
const API_BASE_URL = 'https://freshmart.duckdns.org';
```

Then rebuild the app (`eas build` or your usual build command) so it picks
up the new URL.

## 7. Decommission AWS

Once you've confirmed the home server works end-to-end (login, dashboard,
all report screens loading data), stop/terminate the AWS EC2 instance to
avoid ongoing charges.
