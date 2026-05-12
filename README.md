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

The GitHub Pages workflow runs daily at 1:30am ET through June 21, 2026 and publishes the generated `output/` directory. The Cloudflare Pages workflow uses the same schedule, but only deploys when `CLOUDFLARE_API_TOKEN` is set as a repository secret. The Cloudflare project is `nba-bracket-daily`.

The Cloudflare token should allow Pages deployments for the account. Add it with:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo cboRD181/nba-bracket-daily
```
