# homebridge-mm-render-probe

A disposable diagnostic plugin. It controls nothing and talks to no device.

## Why it exists

Apple documents the HomeKit accessory protocol thoroughly and documents how the Home app *renders*
it almost not at all. Neither the 1302 crawled framework pages nor Apple's own reference
implementation says what words appear on a tile, whether a Filter Maintenance service produces a
tile of its own, whether its write-only reset is reachable by touch, or whether a sensor offers a
per-service notification toggle.

Those gaps are load-bearing. The Litter-Robot design work stalled on them: two of three adversarial
reviewers rejected the leading design because its central argument rested on a rendered string that
no source shows exists. Rather than guess a fourth time, this plugin puts the candidate services in
front of the Home app and lets one look decide.

## What it publishes

| Accessory | Contains | Question it answers |
| --- | --- | --- |
| Probe Multi | Occupancy, Contact, Filter Maintenance (linked), Valve, Stateless Programmable Switch, Switch, Lightbulb | What each tile says, and which services tile at all |
| Probe Filter Only | one Filter Maintenance service, alone | Does a filter service render unaccompanied, and is its reset reachable |
| Probe Valve Only | one Valve, alone | How a valve is worded and filed |

Values are pinned to the interesting state: occupancy detected, contact not detected, filter needs
changing, valve active and in use. The Homebridge log prints the exact questions to answer, and
shouts if you touch the valve or either reset control.

## Use

```bash
npm install --save --no-audit --no-fund --omit=dev <tarball url>
```

Configure it, restart, pair the child bridge, look at the Home app, answer the questions in the
log, then uninstall. The tiles disappear with the plugin.
