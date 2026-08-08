# Atlas Cloud Sandbox Worker

This directory contains the Cloudflare Worker deployable for **Atlas Cloud Sandbox**.

## Deployment Instructions

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. (Optional) Set up authentication secret:
   Add your secret to `wrangler.toml` or set via secret storage:
   ```bash
   npx wrangler secret put CF_API_SECRET
   ```

3. Deploy to your Cloudflare account:
   ```bash
   pnpm run deploy
   ```

4. Copy your worker endpoint URL (e.g. `https://atlas-cloud-sandbox.your-subdomain.workers.dev`) into **Atlas Settings → Beta → Cloud Sandbox Worker URL**.
