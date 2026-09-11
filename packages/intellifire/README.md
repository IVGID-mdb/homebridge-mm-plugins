# homebridge-mm-intellifire

Hearth & Home IntelliFire gas fireplaces in HomeKit. Talks to the fireplace's Wi-Fi module directly
on your LAN (fast, works without internet) and falls back to the IntelliFire cloud when the LAN
path fails.

## What you get

HomeKit has no fireplace type. The one service that has heat, a temperature and a level is
**HeaterCooler**, so the fireplace appears as a heater:

| Characteristic | Fireplace |
| --- | --- |
| Active | power |
| CurrentHeaterCoolerState | Inactive / Heating / Idle (thermostat satisfied) |
| TargetHeaterCoolerState | Heat (only) |
| CurrentTemperature | room temperature from the remote (°C; the Home app shows your locale) |
| HeatingThresholdTemperature | thermostat set-point 10–37 °C, 0.5° steps |
| RotationSpeed | flame height 0–4 as 0 / 25 / 50 / 75 / 100 % |

Plus, when the fireplace has them: **Fanv2 "Blower"** (4 speeds) and **Lightbulb "Accent Light"**
(3 levels). Optionally a plain **Switch** for simple on/off automations.

## Config

```json
{
  "platform": "MMIntellifire",
  "name": "IntelliFire",
  "username": "you@example.com",
  "password": "…",
  "mode": "auto",
  "fireplaces": [{ "ip": "192.168.0.55" }],
  "localPollIntervalSec": 5,
  "cloudPollIntervalSec": 60,
  "exposeSwitch": false
}
```

- The account login runs once per start to learn each fireplace's serial and API key; those are
  cached in the accessory so later starts work even if the cloud is down.
- The LAN address is found by UDP discovery (`IFT-search` → port 3785). If your network blocks
  broadcast, pin it with `fireplaces[].ip` (recommended with a DHCP reservation).
- Existing `user` / `auth_cookie` / `web_client_id` values from the old plugin are accepted instead
  of username/password.
- Local commands use the module's SHA-256 challenge/response and the local command names
  (`flame_height`, `fan_speed`, `thermostat_setpoint`); cloud commands use `height`, `fanspeed`,
  `setpoint`.
