# Lịch Ảnh Rằm & Mồng Một

Vietnamese lunar-calendar poster creator built for ChatGPT Sites.

## Source

- `worker/index.js` contains the Cloudflare Worker application and inline client UI.
- `.openai/hosting.json` declares the Site project and its D1/R2 bindings.
- `scripts/build.sh` creates the deployment package under `dist/`.
- `tests/smoke.mjs` contains the project smoke checks.

## Build

```sh
npm run build
```

The build copies `worker/index.js` and the hosting manifest into `dist/`. The generated `dist/` directory is intentionally ignored by Git.

## Storage and access

The application uses the Site's D1 and R2 bindings. Administrator actions are enforced in the Worker and require the authenticated Site admin. Runtime credentials and environment values are configured in Sites, not committed here.