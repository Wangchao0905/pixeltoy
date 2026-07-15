# Pixel Toys

Local Web control panel for the screenplay -> assets -> storyboard prompts -> standalone Seedance canvas workflow.

## Start

Double-click:

```bash
start-console.command
```

Or run:

```bash
npm start
```

Then open:

```text
http://localhost:4317
```

## What It Does

- Create or select an episode workspace.
- Paste or upload a `.md` / `.txt` screenplay.
- Generate editable storyboard, asset prompts, and Seedance prompt drafts.
- Run the local asset generator for api.apikey.fun image generation and display the asset images.
- Build editable Seedance video config from generated assets and prompt sections.
- Open the standalone node canvas for image-to-video generation and preview.
- Display raw generated clips in the UI when they are saved back to the project.

## Safety

- Video generation happens in the standalone canvas and asks for confirmation there.
- The default video target is `Seedance 2.0 Fast VIP`, `480p`, `9:16`.
- The main console does not call video providers directly.

## Public Asset URLs

AI-generated photoreal images created in the canvas carry their origin metadata and use the generated public URL directly as a video reference. They do not require camera-based person verification or a third-party asset library. Local `data:image/...` files still need to be uploaded before a video provider can fetch them.

For production, configure an S3-compatible bucket:

```env
PUBLIC_ASSET_S3_ENDPOINT=https://<s3-compatible-endpoint>
PUBLIC_ASSET_S3_BUCKET=<bucket>
PUBLIC_ASSET_S3_REGION=<region>
PUBLIC_ASSET_S3_ACCESS_KEY_ID=<access-key-id>
PUBLIC_ASSET_S3_SECRET_ACCESS_KEY=<secret-access-key>
PUBLIC_ASSET_S3_PUBLIC_BASE_URL=https://<public-cdn-or-bucket-domain>
PUBLIC_ASSET_S3_PREFIX=pixel-toys/public-assets
PUBLIC_ASSET_S3_FORCE_PATH_STYLE=false
```

Supported targets include Tencent COS, Volcengine TOS, Aliyun OSS through an S3-compatible endpoint, and Cloudflare R2. A temporary tunnel can be used for local testing via `PUBLIC_ASSET_BASE_URL`, but object storage is the stable path.
