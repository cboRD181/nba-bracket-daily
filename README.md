# NBA bracket daily image

Generates a daily NBA playoff bracket image from the same public data used by `nba.com/playoffs/2026`.

Outputs:

- `output/bracket.png`
- `output/bracket.svg`
- `output/_headers` with `Cache-Control: no-store` for Cloudflare Pages

Run locally:

```bash
npm ci
npm run render:bracket
```

The GitHub Pages workflow runs daily and publishes the generated `output/` directory. The Cloudflare Pages workflow also runs daily, but only deploys when `CLOUDFLARE_API_TOKEN` is set as a repository secret. The Cloudflare project is `nba-bracket-daily`.
