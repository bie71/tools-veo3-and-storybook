<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Q9VYj7_EWQY6mI_cEAG8lONGKBEHE4Fp

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Request Queues

- Video, image, and storybook generation now run through built-in queues so each feature issues one API request at a time.
- Every queue enforces a configurable cool-down before the next job starts, and the UI surfaces queue positions plus live countdowns.
- Configure the delays (milliseconds) in your `.env*` files or Compose overrides:
  - `VITE_VIDEO_QUEUE_DELAY_MS` (default 5000)
  - `VITE_IMAGE_QUEUE_DELAY_MS` (default 4000)
  - `VITE_STORY_QUEUE_DELAY_MS` (default 5000)

## Analytics (GA4)

This app sends analytics events to Google Analytics 4 (GA4).

- Set your GA4 Measurement ID in `.env` or `.env.local`:
  - `VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX`
- Optional helpers for local testing:
  - `VITE_GA_DEBUG=1` adds `debug_mode=true` so events appear in DebugView.
  - `VITE_SHOW_ANALYTICS_LOG=1` logs events to the browser console.

### Where to see events
- Configure → DebugView: live event stream from your browser.
- Reports → Realtime: near real-time events and conversions.

### Mark conversions (recommended)
Mark these events as conversions in GA4 (Configure → Conversions → New conversion event):
- `generate_video_success`
- `generate_story_success`

Optional (create derived events first in Configure → Events → Create event):
- `download_single` (from `video_download` where `kind=single`)
- `download_merged` (from `video_download` where `kind=merged`)
- `download_segment` (from `video_download` where `kind=segment`)

### Event catalog (high-level)
- Page: `page_view` with `tab` = prompt | video | storybook_prompt | storybook
- Prompt builder: `generate_video_prompt`, `output_copy`
- Video: `generate_video_start/success/error`, `generate_segments_start/complete/error`, `merge_segments*`, `video_play`, `video_download`, `segments_play_all`
- Storybook prompt: `generate_story_prompt`
- Storybook builder: `generate_story_start/success/error`

## Docker

Build and run a static production image served by Nginx.

1) With the prod compose file only:

```
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web
```

2) Or merge base + prod (identical result for `web` here):

```
docker compose -f docker-compose.yml -f docker-compose.prod.yml build web
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d web
```

Notes
- Vite embeds `VITE_*` envs at build time. Changing `VITE_GA_MEASUREMENT_ID` requires rebuilding the image.
- Adjust `VITE_VIDEO_QUEUE_DELAY_MS`, `VITE_IMAGE_QUEUE_DELAY_MS`, and `VITE_STORY_QUEUE_DELAY_MS` to change the enforced delays before building.
