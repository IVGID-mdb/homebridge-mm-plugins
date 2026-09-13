# homebridge-mm-litterrobot

Whisker Litter-Robot 4 in HomeKit, scoped to the four things that actually get acted on.

## What you get

| Service | What it is for |
| --- | --- |
| Filter Maintenance "Waste Drawer" | Remaining drawer capacity from 0 to 100, a change indication when it is full, and Apple's own reset control |
| Occupancy Sensor "Drawer Full" | The same fact, on a service certain to appear and able to trigger an automation or a notification |
| Switch "Empty Drawer" | Momentary. Tells the robot you emptied the drawer |
| Occupancy Sensor "Needs Attention" | Motor fault, bonnet removed, dirty sensor, hopper trouble, litter low, switched off, or not reporting in |
| Switch "Clean Cycle" | Runs a cycle now. Refused while a cat is in the globe |

The drawer is evaluated once and published to both carriers, so the gauge and the alert can never
disagree with each other.

## Three decisions worth knowing

**The reset exists twice on purpose.** Apple defines a reset control on the filter service and it is
exactly right for "I emptied it". Nothing documents whether the Home app actually draws it, and if it
does not, a full-drawer alert would latch forever with no way to clear it. So a plain switch carries
the same command. Turn off `exposeResetSwitch` once you have seen the filter control work.

**A switched-off robot counts as a problem.** A tripped breaker, an unplugged cord and a knocked
power switch all reach the cloud as the same value, and none of them is a deliberate choice. It is
reported after a debounce, configurable, and can be turned off entirely.

**Silence is treated as a fault, not as good news.** If the cloud goes away, or admits its data is
hours old, everything else on the accessory reports No Response. The attention sensor deliberately
keeps answering, because the failure it exists to report must not be the failure that silences it.

## Deliberately absent

Night light, child lock, panel brightness, clump time, sleep schedule, cat weight and lifetime
counters. Also absent is a cat-overdue alarm. A cat that stops using the box is a real emergency, but
this robot reports only that *a* cat visited. In a two-cat household such an alarm cannot detect one
cat of two falling ill, which is the case that matters, so it would offer false comfort.

## Config

```json
{
  "platform": "MMLitterRobot",
  "name": "Litter-Robot",
  "username": "you@example.com",
  "password": "…",
  "pollIntervalSec": 60,
  "exposeDrawerAlert": true,
  "exposeResetSwitch": true,
  "exposeCleanCycle": true,
  "alertWhenPoweredOff": true,
  "attentionDebounceMinutes": 15,
  "staleMinutes": 60
}
```

Authentication is AWS Cognito with refresh-token renewal, the same client the app uses. Tokens are
never logged.
