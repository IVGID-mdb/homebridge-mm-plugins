# MM Homebridge plugins

Four Homebridge plugins written to replace the third-party ones on the MMHomeBridge server, each
exposing **only standard HomeKit services with spec-correct characteristics** (no fake temperature
sensors, no "toggle" pseudo-switches, RotationSpeed is a real 0–100 % with proper quantization).

| Package | Device | Transport | HomeKit services |
| --- | --- | --- | --- |
| [`homebridge-mm-bond`](packages/bond) | Bond Bridge (RF fans, lights, fireplaces, shades) | Local HTTP API v2 + BPUP push (UDP 30007) | Fanv2 (+Lightbulb), Lightbulb, Switch, WindowCovering |
| [`homebridge-mm-modernforms`](packages/modernforms) | Modern Forms / WAC smart fans | Local `/mf` JSON API | Fanv2 + Lightbulb |
| [`homebridge-mm-intellifire`](packages/intellifire) | Hearth & Home IntelliFire fireplaces | Local challenge-response API, cloud fallback | HeaterCooler (+Fanv2 blower, +Lightbulb, optional Switch) |
| [`homebridge-mm-litterrobot`](packages/litterrobot) | Whisker Litter-Robot 4 | Cognito + GraphQL cloud | AirPurifier + 2×FilterMaintenance, OccupancySensor, Switch, Lightbulb |

`packages/core` is a private shared library (platform base class, poller with backoff, write
coalescing, speed quantization, HAP helpers, and a test harness built on the real hap-nodejs) that
is bundled into each plugin at build time, so the published plugins have **zero runtime
dependencies**.

## Design rules every plugin follows

- **Dynamic platform, stable UUIDs.** Accessories are keyed by serial/MAC/bond-id, never by name.
  Cached accessories are restored before registration; stale ones are pruned (configurable).
- **HAP-correct values only.** Characteristic props are set to what the spec says (RotationSpeed
  0–100 step 1, temperatures in °C, `validValues` on target-state characteristics), and a valid
  value is written *before* props are tightened so hap-nodejs never logs a warning.
- **Discrete speeds are quantized, not faked.** A 3-speed fan maps 1–49 % → low, 50–83 % → medium,
  84–100 % → high and snaps the Home app slider to 33/67/100 after the write.
- **Write coalescing.** The Home app writes `Active` and `RotationSpeed` separately when you tap a
  tile; we merge writes arriving within 60 ms into one device command.
- **Never retry a command.** RF toggles would double-fire. Reads may retry once.
- **Honest failure.** If the device cannot be reached, HomeKit gets
  `SERVICE_COMMUNICATION_FAILURE` ("No Response"), not a stale value.
- **Push where the device offers it** (Bond BPUP), polling with jitter + exponential backoff otherwise.
- **All timers are `unref`'d** so Homebridge shuts down cleanly.

## Developing

```bash
npm install
npm run check        # typecheck + lint + tests + build
npm test             # vitest (66 tests, all against in-process fake devices / clouds)
npm run pack         # → release/*.tgz, installable on any Homebridge host
```

Every plugin has a fake of its device or cloud under `packages/<name>/test/` that speaks the real
wire protocol (Bond's `{"argument":n}` bodies and BPUP datagrams, the Modern Forms `/mf` echo,
IntelliFire's SHA-256 challenge/response and cookie login, Whisker's Cognito `InitiateAuth` and
GraphQL). Tests drive the plugins through hap-nodejs' own request path (`handleSetRequest`), so
HAP validation runs exactly as it would for a real controller.

## Installing on the Homebridge host

```bash
npm run pack
# copy release/*.tgz to the host, then on the host:
hb-service add /path/to/homebridge-mm-bond-0.1.0.tgz
```

or publish to npm / a GitHub release and install by URL through the Homebridge UI. Each plugin
ships a `config.schema.json` so it is configured from the UI like any other plugin.
