# vesselhq-marketing-engine

Node.js microservice that generates maritime marketing content, simulates AI image creation and upload, and prepares a daily social media post workflow.

## Features

- Express server with `/health` endpoint
- Daily cron job powered by `node-cron`
- MySQL integration via `mysql2`
- OpenAI-powered LinkedIn-style content generation
- Prepared evergreen queue with ordered daily batches
- Configurable asset storage with R2 / Cloudinary / local fallback
- Modular services, configs, and placeholder publisher integrations

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env`.
   A production-ready starting point is available in `.env.example`.

3. Create the database schema:

```sql
SOURCE database/marketing_schema.sql;
SOURCE database/seed_topics.sql;
```

4. Start the service:

```bash
npm start
```

## Prepared Content Workflow

Use this when you want to preload posts and images instead of generating AI content every day.

### Browser UI

Open:

```bash
http://localhost:3000/prepared-posts/ui
```

From there you can paste the text, attach the image, choose the platforms, and upload directly from the browser.
When `STORAGE_PROVIDER=r2`, uploaded prepared images are pushed to Cloudflare R2 and stored with public HTTPS URLs, which is the recommended online setup.

### File-Based Import

1. Put your image files in `prepared-images/`
2. Create `prepared-posts/queue.json` starting from `prepared-posts/queue.sample.json`
3. Import the queue into MySQL:

```bash
npm run import-prepared-posts
```

You can also trigger the import while the service is running:

```bash
POST /prepared-posts/import
GET /prepared-posts/queue
```

Example manifest entry:

```json
[
  {
    "importKey": "awareness-march-2026-post-01",
    "text": "Every seafarer knows the importance of carrying original certificates onboard.\n\nBut managing multiple documents during travel, crew changes and inspections can be stressful.\n\nSmart digital organization is becoming a key advantage at sea.",
    "imageFile": "post01_realistic_cabin_certificates.png",
    "platforms": ["twitter", "facebook", "linkedin"],
    "scheduledOrder": 1,
    "campaignTag": "awareness_march2026",
    "postType": "relatable_realistic"
  }
]
```

The importer creates one row per platform in `marketing_prepared_posts`. All pending rows with the same `scheduledOrder` are published in the same daily run.

## Online Deployment

For an online environment, use this setup:

1. Deploy the Node service on a server or platform with a public HTTPS URL
2. Set `APP_URL` to that public base URL
3. Set `STORAGE_PROVIDER=r2`
4. Configure valid R2 credentials and a public bucket URL in `R2_PUBLIC_BASE_URL`
5. Point the service to a production MySQL database

With that configuration:

- AI-generated images are uploaded to R2
- Prepared post images uploaded from the browser are also uploaded to R2
- `marketing_prepared_posts.image_url` contains public HTTPS asset URLs instead of `localhost` links

## Cron Flow

The scheduled job in `src/cron/marketingCron.js` runs once per day and:

1. Checks `marketing_prepared_posts` for the lowest pending `scheduled_order`
2. Publishes all pending prepared posts in that batch, one per platform
3. Marks the prepared batch as `published`
4. Falls back to the AI flow only when no prepared post is pending
5. Fetches the next marketing topic from MySQL
6. Generates LinkedIn-style maritime content with OpenAI
7. Builds an image prompt and uploads the generated asset through the configured storage provider
8. Saves the generated post in MySQL
9. Invokes the placeholder publisher service
10. Marks the AI-generated post as `published`

## Notes

- Real social publishing is intentionally not implemented yet.
- Set `APP_URL` if the service is not reachable at `http://localhost:3000`; local fallback image URLs are built from that base URL.
- Prepared evergreen posts now live in `marketing_prepared_posts`.
- Use `STORAGE_PROVIDER=r2` for production-ready public asset storage on Cloudflare R2.
- `R2_PUBLIC_BASE_URL` should point to your public bucket domain or `r2.dev` URL.
- Cloudinary is still supported as an optional alternative storage provider.
- Set `MOCK_OPENAI=true` for internal testing without paid OpenAI API usage.
