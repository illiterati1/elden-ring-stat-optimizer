# Elden Ring Stat Optimizer

Enter your current stats and the weapons you're considering to see where your next levels should
go. For patch 1.17.2.

Weapon data and damage calculations are adapted from Tom Clark's
[Elden Ring Weapon Calculator](https://github.com/ThomasJClark/elden-ring-weapon-calculator).

See [known-issues.md](known-issues.md) for known inaccuracies.

## Development

```sh
npm install
npm start      # dev server
npm test       # tests
npm run build  # production build, in build/
```

The game data is built from the param CSVs in `data/` by the Python scripts in `scripts/`.

## License

MIT; see [LICENSE](LICENSE).
