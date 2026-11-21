# Elden Ring Stat Optimizer

Enter your current stats and the weapons you're considering to see where your next levels should
go. For patch 1.17.2.

Live site: https://elden-ring-stat-optimizer.pages.dev/

Weapon data and damage calculations are adapted from Tom Clark's
[Elden Ring Weapon Calculator](https://github.com/ThomasJClark/elden-ring-weapon-calculator).

See [known-issues.md](known-issues.md) for known inaccuracies.

## Development

```sh
npm install
npm start      # dev server
npm test       # tests
npm run build  # production build, in build/
npm run perf   # responsiveness check against scripts/perf-baseline.json (--update to re-record)
```

The responsiveness check needs Playwright's Chromium (`npx playwright install chromium`). Its render
counts are exact; its timings are only comparable on the machine the baseline was recorded on.

The game data is built from the param CSVs in `data/` by the Python scripts in `scripts/`.

## License

MIT; see [LICENSE](LICENSE).
