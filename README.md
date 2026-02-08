# WhatsApp Cloud API Webhook + Dashboard

Express server + MongoDB Atlas storage + Socket.IO realtime dashboard.

## What you get

- Webhook endpoint to receive WhatsApp Cloud API messages.
- Stores incoming messages in MongoDB Atlas (or memory mode if `MONGODB_URI` is empty).
- Dashboard UI shows **Inbox** and **Replied** lists.
- Select messages and send **one reply text to many** (batch reply).
- Realtime updates (no refresh) via Socket.IO.

## Local run

1. Install:

`npm install`

2. Fill environment variables in `.env` (start from `.env.example`).

3. Run:

`npm start`

Open:

- `http://localhost:3001`

## Main routes

- `GET /` dashboard
- `GET /api/health` health + mode
- `GET /webhook` Meta webhook verification
- `POST /webhook` incoming WhatsApp messages
- `GET /api/messages?status=new|replied` list messages
- `POST /api/reply` batch reply `{ messageIds: string[], text: string }`
- `DELETE /api/messages/:id` delete

## Required env vars (for full functionality)

- `ADMIN_TOKEN` protects dashboard actions (reply/delete). Put it in the dashboard UI.
- `MONGODB_URI` MongoDB Atlas connection string.
- `WHATSAPP_VERIFY_TOKEN` used for webhook verification.
- `WHATSAPP_TOKEN` Cloud API access token (needed for sending replies).
- `WHATSAPP_PHONE_NUMBER_ID` needed for sending replies.

## Optional env vars

- `META_APP_SECRET` (or `APP_SECRET`) enables verification of `X-Hub-Signature-256`.

## Expose localhost to Meta

Meta must reach your webhook publicly. Use a tunnel:

- Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:3001`
- ngrok: `ngrok http 3001`

Then set Meta webhook callback URL to:

- `https://<your-public-url>/webhook`

## Deploy on Vercel (recommended for your current setup)

This repo is now Vercel-ready:

- Dashboard is static and uses polling (no Socket.IO).
- Backend is Vercel Serverless Functions in `api/`.

### Steps

1. Import the repo into Vercel.
2. Set Environment Variables in Vercel Project Settings:
   - `ADMIN_TOKEN`
   - `MONGODB_URI`
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - (optional) `META_APP_SECRET`
3. Deploy.

### URLs

- Dashboard: `https://<your-domain>/`
- Webhook callback: `https://<your-domain>/api/webhook`

### Notes

- Webhook stores incoming messages in MongoDB.
- Replies are sent from the dashboard using `POST /api/reply`.
