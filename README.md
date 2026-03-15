# vesselhq-marketing-engine

Node.js microservice that generates maritime marketing content, simulates AI image creation and upload, and prepares a daily social media post workflow.

## Features

- Express server with `/health` endpoint
- Daily cron job powered by `node-cron`
- MySQL integration via `mysql2`
- OpenAI-powered LinkedIn-style content generation
- Real publishing support for LinkedIn, X, and Facebook
- Prepared evergreen queue with ordered daily batches
- Configurable asset storage with R2 / Cloudinary / local fallback
- Modular services, configs, and social publisher integrations

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

Main entry points:

```bash
http://localhost:3000/
http://localhost:3000/dashboard
http://localhost:3000/queue
http://localhost:3000/history
http://localhost:3000/status
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

To review post history from the database:

```bash
http://localhost:3000/posts/ui
GET /posts?source=all&status=published&limit=50
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

## X Publishing

The `twitter` platform now publishes real posts to X using the official write/media APIs.

Required environment variables:

```bash
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_USER_ACCESS_TOKEN=
X_API_BASE_URL=https://api.x.com
```

Setup notes:

- Use either OAuth 1.0a user credentials (`X_API_KEY` + `X_API_SECRET` + `X_ACCESS_TOKEN` + `X_ACCESS_TOKEN_SECRET`) or a user access token in `X_USER_ACCESS_TOKEN`
- The X app must have write permissions for the target account
- The access token must belong to the account that will publish the post
- `image_url` must be publicly reachable so the service can download and upload the image to X

## Facebook Publishing

The `facebook` platform now publishes real posts to a Facebook Page using the Meta Graph API.

Required environment variables:

```bash
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_GRAPH_API_BASE_URL=https://graph.facebook.com
FACEBOOK_GRAPH_API_VERSION=v23.0
```

Setup notes:

- The access token must be a Page access token for the Page that will publish the post
- The app/user must have Page publishing permissions such as `pages_manage_posts`
- When `image_url` is present, the publisher posts through the Page photos endpoint using the public image URL

## LinkedIn Publishing

The `linkedin` platform now publishes real posts through LinkedIn's versioned `rest/posts` and `rest/images` APIs.

Required environment variables:

```bash
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_OAUTH_SCOPES=openid profile email w_member_social
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_AUTHOR_URN=
LINKEDIN_IMAGE_OWNER_URN=
LINKEDIN_ORGANIZATION_ID=
LINKEDIN_PERSON_ID=
LINKEDIN_API_BASE_URL=https://api.linkedin.com
LINKEDIN_API_VERSION=202511
LINKEDIN_POST_VISIBILITY=PUBLIC
```

Setup notes:

- Add `https://your-public-app/linkedin/callback` to the app's Authorized redirect URLs and start the flow from `/linkedin/connect`
- Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` so the service can exchange the LinkedIn OAuth code for an access token
- The built-in OAuth helper defaults to `openid profile email w_member_social`; add `w_organization_social` only when you need organization posting
- Set `LINKEDIN_AUTHOR_URN` directly as `urn:li:person:...` or `urn:li:organization:...`; alternatively you can provide `LINKEDIN_ORGANIZATION_ID` or `LINKEDIN_PERSON_ID`
- `LINKEDIN_IMAGE_OWNER_URN` is optional and defaults to the same URN used to publish the post
- Member posting requires a token with `w_member_social`; organization posting requires `w_organization_social` and the caller must be authorized to post for that organization
- `image_url` must be publicly reachable so the service can download it and upload it to LinkedIn before creating the post

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
9. Publishes to the configured platform publisher
10. Marks the AI-generated post as `published`

Cron configuration:

```bash
CRON_SCHEDULE=0 8 * * *
CRON_TIMEZONE=Europe/Rome
```

If `CRON_TIMEZONE` is not set, the scheduler defaults to `Europe/Rome`.

## Notes

- LinkedIn, X, and Facebook publishing are implemented.
- Set `APP_URL` if the service is not reachable at `http://localhost:3000`; local fallback image URLs are built from that base URL.
- Prepared evergreen posts now live in `marketing_prepared_posts`.
- Use `STORAGE_PROVIDER=r2` for production-ready public asset storage on Cloudflare R2.
- `R2_PUBLIC_BASE_URL` should point to your public bucket domain or `r2.dev` URL.
- Cloudinary is still supported as an optional alternative storage provider.
- Set `MOCK_OPENAI=true` for internal testing without paid OpenAI API usage.
