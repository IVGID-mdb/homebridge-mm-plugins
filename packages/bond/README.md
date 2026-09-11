# homebridge-mm-bond

Bond Bridge devices in HomeKit, over the local API with instant push updates (BPUP).

## What you get

| Bond device type | HomeKit | Details |
| --- | --- | --- |
| `CF` ceiling fan | **Fanv2** (+ **Lightbulb** if the fan has a light) | Active, RotationSpeed 0–100 % quantized to the fan's `max_speed`, RotationDirection (SetDirection ±1), light On (+ Brightness if `SetBrightness` exists) |
| `LT` light | **Lightbulb** | On, Brightness when supported |
| `FP` fireplace / `GX` generic | **Switch** | On/Off |
| `MS` shades | **WindowCovering** | Open/Close (or SetPosition if supported) |

No "Toggle Light State" or "Dimmer" pseudo-switches. Devices removed from the Bond are removed
from HomeKit automatically.

## Config

```json
{
  "platform": "MMBond",
  "name": "Bond",
  "bonds": [{ "host": "192.168.0.61", "token": "<local token from the Bond app>" }],
  "pollIntervalSec": 60,
  "push": true,
  "removeStale": true,
  "exclude": []
}
```

Token: Bond app → Settings → your bridge → Advanced → *Local Token*.

## Notes

- Commands are never retried (a retried toggle on a one-way RF device flips it back).
- After a command the belief state is applied immediately and re-read 400 ms later.
- BPUP: a `\n` keep-alive is sent every 55 s; state pushes arrive within milliseconds of the Bond
  app or a Bond-connected remote changing something. Polling remains as a safety net.
