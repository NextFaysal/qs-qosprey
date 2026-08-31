# 🚀 PepeShops Deployment Guide (Nixpacks)

This project is pre-configured with **Nixpacks** (`nixpacks.toml`) for zero-configuration, production deployment on platforms like **Railway**, **Coolify**, **Zeabur**, **Render**, **Dokku**, and **Easypanel**.

---

## 🏗️ Architecture Overview

PepeShops consists of two core components running simultaneously:
1. **Next.js Web Server**: Serves the user dashboard, admin panel, and REST APIs on `$PORT`.
2. **Background Polling Engine & Scheduler**: Runs BullMQ worker, 200ms ultra-fast goods polling, and auto-settlement orders.

Both processes are orchestrated together by our production supervisor (`scripts/start-production.js`), so you only need **a single container / service** to deploy everything.

---

## ⚙️ Environment Variables Checklist

Set these environment variables in your hosting dashboard:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string (Neon, Supabase, etc.) | `postgresql://user:pass@host/db?sslmode=require` |
| `REDIS_URL` | Redis connection string (Upstash, Redis Cloud) | `redis://default:pass@host:port` |
| `JWT_SECRET` | 64+ char random secret key for user authentication | Random string (e.g. `openssl rand -base64 32`) |
| `NEXTAUTH_SECRET` | 32+ char secret for NextAuth sessions | Random string |
| `NEXTAUTH_URL` | Public production domain of your app | `https://your-domain.com` |
| `ADMIN_EMAIL` | Initial super-admin login email | `admin@pepeshops.com` |
| `ADMIN_PASSWORD`| Initial super-admin password | `your-secure-password` |
| `ADMIN_NAME` | Initial super-admin display name | `System Admin` |
| `POLLING_INTERVAL_MS` | API polling interval in milliseconds | `200` |
| `CAMPAIGN_TIMEOUT_MINUTES` | Maximum polling window before auto-stop | `5` |
| `POLLING_START_BEFORE_SECONDS` | Start polling seconds before target time | `120` |
| `PORT` | Web server port (set automatically by platform) | `3000` |

---

## 🛠️ Deploying on Railway (Recommended)

1. Push this repository to **GitHub**.
2. Go to [railway.app](https://railway.app) and click **"New Project"** → **"Deploy from GitHub repo"**.
3. Select your `pepeshops` repository.
4. Railway automatically detects `nixpacks.toml` and selects **Nixpacks** builder.
5. In Railway dashboard, navigate to **Variables** and paste the environment variables listed above.
6. Click **Deploy**.
7. Railway will automatically:
   - Run `npm install`
   - Run `npx prisma generate && npm run build`
   - Start both the Web server and Worker using `node scripts/start-production.js`.

---

## 🐳 Deploying on Coolify (Self-Hosted VPS)

1. In Coolify, click **"Create New Resource"** → **"Application"**.
2. Select your GitHub repository.
3. In **Build Pack**, select **Nixpacks**.
4. In **Environment Variables**, add the variables from the checklist above.
5. Under **Ports Exposes**, enter `3000` (or leave default).
6. Click **Deploy**.

---

## ⚡ Deploying on Render / Zeabur / Easypanel

1. Connect your repository.
2. Select **Nixpacks** as the buildpack / build engine.
3. Add the required Environment Variables.
4. Deploy!

---

## 🔍 How to Verify Deployment

1. Visit your public URL (e.g., `https://your-domain.com`).
2. Log in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. Check the server logs:
   - `[WEB]` lines show Next.js HTTP server activity.
   - `[WORKER]` lines show BullMQ worker and 200ms polling scheduler status:
     ```
     [WORKER] 🐸 PepeShops Worker Starting...
     [WORKER] Polling Interval: 200ms
     [WORKER] ⚙️ Polling worker started (concurrency: 50)
     [WORKER] 🚀 Scheduler started (scanning every 5s, 120s before publish)
     ```
