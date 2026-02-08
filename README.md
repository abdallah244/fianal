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

## Deployment note

Socket.IO needs a long-running server, so hosting the whole app on Vercel Serverless is not a good fit.
Use Render / Railway / Fly.io for the Express + Socket.IO server.

## Vercel-only alternative (no realtime)

This repo also contains `api/webhook.js` and `api/send.js` which are Vercel Serverless handlers.
They can be deployed to Vercel, but they won’t support Socket.IO realtime dashboard.
