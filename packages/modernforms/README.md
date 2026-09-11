# homebridge-mm-modernforms

Modern Forms / WAC Lighting smart ceiling fans in HomeKit, over the local `POST /mf` JSON API.

## What you get

- **Fanv2**: Active, RotationSpeed 0–100 % quantized to the fan's 6 speeds (17/33/50/67/83/100),
  RotationDirection (forward = clockwise, reverse = counter-clockwise), optional SwingMode ↔ Breeze.
- **Lightbulb**: On, Brightness 1–100 (0 % turns the light off).

Every command returns the fan's full state, which is applied immediately.

## Config

```json
{
  "platform": "MMModernForms",
  "name": "Modern Forms",
  "fans": [{ "host": "192.168.0.121", "name": "Bedroom Fan" }],
  "pollIntervalSec": 15,
  "breezeAsSwingMode": false
}
```

Give the fan a DHCP reservation. `name` is optional; the fan's own `deviceName` is used otherwise.
