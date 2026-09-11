# homebridge-mm-litterrobot

Whisker Litter-Robot 4 in HomeKit using only standard services.

## What you get

| Service | Meaning |
| --- | --- |
| **AirPurifier** (primary tile) | Active = powered; state Idle / Purifying (clean cycle running) |
| ↳ FilterMaintenance "Waste Drawer" | FilterLifeLevel = 100 − drawer %, "Change" when the drawer is full |
| ↳ FilterMaintenance "Litter Level" | FilterLifeLevel = litter %, "Change" below 20 % |
| **OccupancySensor "Cat Detected"** | cat sensor; StatusActive = robot online |
| **Switch "Clean Cycle"** | turn on to start a cycle; shows on while cycling |
| **Lightbulb "Night Light"** | on = Auto, off = Off |
| Switch "Reset Waste Gauge" (optional) | momentary |

Cat weight is deliberately not exposed: HomeKit has no weight characteristic and pretending it is a
temperature just confuses Siri.

## Config

```json
{
  "platform": "MMLitterRobot",
  "name": "Litter-Robot",
  "username": "you@example.com",
  "password": "…",
  "pollIntervalSec": 60,
  "exposeCleanSwitch": true,
  "exposeNightLight": true,
  "exposeOccupancy": true,
  "exposeResetSwitch": false
}
```

Authentication is AWS Cognito `USER_PASSWORD_AUTH` (same client the app uses) with refresh-token
renewal; tokens are never logged. Data comes from the `lr4.iothings.site` GraphQL API; commands go
through `sendLitterRobot4Command` with the command names used by the official app.
