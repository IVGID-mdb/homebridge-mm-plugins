# Litter-Robot 4 — final HomeKit design: "Drawer First, Named True"

Target: Homebridge 2.4.0 / `@homebridge/hap-nodejs` 2.2.2, published as a **bridged** accessory behind a
child bridge. Plugin: `homebridge-mm-litterrobot` (`packages/litterrobot`).

Every service and characteristic below was checked against the live library
(`node_modules/@homebridge/hap-nodejs/dist/lib/definitions/`) and against the ADK spec text in the
HomeKitADK snapshot before it was included. The verification appendix at the end records what was
checked and where. Anything I cannot source is marked **UNSURE** and nothing core depends on it.

---

## 1. Thesis

**Publish one service per fact the owner acts on, choose the service type whose Home-app vocabulary the
fact can honestly wear, and then name every service for the CONDITION rather than for the object, so the
rendered string is a true sentence no matter how the Home app lays the tile out.**

The corollary that shapes the whole model: the Apple Home app's rendering, tile wording, notification UI
and Siri grammar are **undocumented by every source available here** — I searched the ADK headers, the
1302 crawled Apple pages and the local `docs/homekit` set. Service *type* fixes the vocabulary
("Detected", "Open", "On"); the service *name* is the only variable the accessory actually controls. So
the design bets on the name, which pays off under every rendering hypothesis, instead of betting on tile
ordering or on a notification toggle nobody can source.

The drawer is the recurring chore, so the drawer alert is the primary service and is named `Drawer Full`.
It renders as "Drawer Full — Detected". Design 1 ("Drawer First") reached the same tile from the same
compromise and named it `Waste Drawer`, which renders "Waste Drawer — Open" — a false sentence about a
drawer that is closed and full. Same cost, worse sentence. That one rename is the difference between the
top two designs, and it is free.

---

## 2. Provenance: what this is built from

| Source design | What survives here |
| --- | --- |
| **Drawer First** (consensus #1, 13 pts) | The structure: drawer alert as the primary service, a linked Filter Maintenance gauge carrying the inverted percentage and the one-write reset, Valve for the cycle, a tight default tile budget, "compute the drawer predicate once and publish it twice", and the discipline of omitting `Remaining Duration` rather than inventing a countdown. |
| **True Sentences** | The naming rule (name the condition, not the object), applied to every sensor. Its `ConfiguredName` seeding is **removed** — see §7. |
| **Sensor-First** | `Cat Visit` (Stateless Programmable Switch with `validValues [0]`), `Cat Overdue` with all three cold-start guards, the aggregate `Needs Attention` sensor that stays live when the cloud drops, the staleness-aware `Status Active` predicate, and read-only diagnostics on Accessory Information. |
| **Clinic Mode** | The welfare guard on the cycle command, profile presets instead of a dozen loose flags, the locale-conversion argument that kills `CurrentTemperature` as any numeric carrier, and the correct scoping of the ADK firmware gate. |
| **Four Tiles That Never Lie** | The both-directions test on every writable (which is what kills the panel-brightness Lightbulb), and the correctly enumerated `Lock Physical Controls` host list. Its conclusion — publish less — is rejected; see §6. |

### Judge disagreements, resolved explicitly

1. **Which design to build on.** Consensus and two of three judges rank Drawer First first; the third
   (homekit-expert) ranks True Sentences first but its stated required edit to True Sentences is a
   deletion, and its praise for that design is entirely about the naming rule. Building Drawer First's
   structure with True Sentences' naming rule satisfies all three arguments simultaneously. That is what
   this is.

2. **The primary service.** All three judges picked differently: homekit-expert chose a `Switch`
   ("Litter Box Cleaning"), cat-owner chose a `ContactSensor` ("Waste Drawer"), maintainer chose an
   `OccupancySensor` ("Drawer Full"). Splitting the question: *which fact* should be primary — two of
   three (cat-owner, maintainer) say the drawer chore, not the cycle and not power. *Which carrier* —
   two of three (maintainer, homekit-expert) prefer occupancy-named-for-the-condition over
   contact-named-for-the-object, homekit-expert explicitly calling "Waste Drawer — Open" a false
   sentence. The intersection is **`OccupancySensor` named `Drawer Full`**. See §5.

3. **Offline behaviour.** cat-owner wants Drawer First's `-70402` on reads (and it is what
   `docs/homekit/accessory-model.md` rule 40 recommends); homekit-expert and maintainer want Clinic
   Mode's "hold last value, drop `Status Active`" and call the blanket error contrary to local guidance.
   Both are right about different failures, and the designs conflated them. Resolution in §9: a
   **transport failure** (the plugin cannot reach the Whisker cloud) is a bridge-can't-contact-the-device
   condition and returns `-70402`; a **cloud-reported `isOnline: false`** is *data*, not a failure — the
   bridge did reach its backend and was told the robot is unreachable — so it serves values with
   `Status Active` false and trips `Needs Attention`. Nobody proposed this split; it is strictly better
   than either half.

4. **Occupancy for a cat during `ROBOT_CAT_DETECT_DELAY`.** Drawer First holds occupancy true through the
   delay to avoid flicker; Sensor-First, Clinic Mode and Four Tiles drop it to 0 because the cat has
   left. Resolved in favour of **0**: the ADK says the value "should return to 0 when occupancy is not
   detected", the falling edge is what `Cat Visit` and `Cat Overdue` are computed from, and holding it
   would inflate every measured dwell by the clump time (3/7/15 min).

5. **Cat Visit press vocabulary.** Clinic Mode overloads Single/Double/Long as a clinical vocabulary;
   homekit-expert and maintainer both call that a deliberate purchase, not a default, and note the Home
   app labels them "Single Press / Double Press / Long Press" with no way to explain the code. Default is
   **single press only, `validValues [0]`**; the clinical vocabulary is an opt-in config value.

6. **Cat Overdue carrier.** Clinic Mode's inverted `MotionSensor` (true = no motion) is rejected by all
   three judges and by the honesty rule. Carried by an `OccupancySensor` named `Cat Overdue`.

7. **Writable custom characteristics** (clump time, panel brightness on a `Switch`, per True Sentences and
   Clinic Mode). Dropped. `Switch` accepts only `On` and `Name`; `getCharacteristic()` on anything else
   emits hap-nodejs's "Characteristic not in required or optional characteristic section" warning, and
   the ADK sanctions custom characteristics only on Accessory Information and only with read-side
   permissions. A writable control that is invisible to the primary audience and off-spec for its host is
   the worst available home for a setting. Cost stated in §7.

---

## 3. The accessory

**One HomeKit accessory, not several.** Judges and designs agree, and the decisive constraint is sourced:
a `linkedServices` entry must resolve to a service on the *same* accessory or validation fails
(`HAP/HAPAccessoryValidation.c:250-275`). Splitting also duplicates Accessory Information with a
fabricated second serial number and buys nothing, because the Home app surfaces *services* as tiles
regardless of accessory grouping.

**Category: `Categories.OTHER` (1), and it is inert.** Behind a bridge, `Accessory.toHAP()` emits only
`aid` and `services` (`Accessory.js:700-712`); `category` survives only in `serialize()` for disk
persistence (`:1502`) and as the Bonjour `ci` key of the accessory that is actually advertised. The ADK
requires every bridged accessory to be `kHAPAccessoryCategory_BridgedAccessory` and rejects anything else
(`HAPAccessoryValidation.c:796-802`), and `accessory-model.md` rule 31 infers that the Home app therefore
derives icon and grouping from the published service types. Sensor-First's claim that "the category drives
the Home app icon" is **verified false** for a bridged accessory. `OTHER` is chosen because no category
describes a litter box; the value is for the local record, not for effect. Note also that the platform
passes `category` only when *creating* a new `platformAccessory`, so changing it does not touch already
cached accessories (`packages/core/src/platform-base.ts:135`).

**Profiles.** Every honest model of this product lands between six and fourteen tiles, and every judge
called tile count the main cost. Rather than a dozen loose flags nobody maintains, ship named profiles
(grafted from Clinic Mode), with per-service overrides still available:

| Profile | Services published (excluding Accessory Information) |
| --- | --- |
| `lean` (6 tiles) | Drawer Full, Waste Drawer, Cat In Box, Clean Cycle, Bonnet, Night Light |
| `standard` (**default**, 10) | `lean` + Cat Visit, Cat Overdue, Needs Attention, Litter Supply |
| `full` | `standard` + Litter Low, Night Light Auto, Litter Box Power, Control Lock |
| conditional | Hopper — published only when the account reports a LitterHopper fitted, in every profile |

---

## 4. The complete map

Legend: **R** = required by hap-nodejs 2.2.2 for that service, **O** = optional and verified legal on that
service. Every range/permission below is the library's own declaration.

### 4.1 `AccessoryInformation` — "Litter-Robot" (no subtype, no tile)

Mandatory: "Every accessory must expose a single instance of the Accessory information service … The
values of Manufacturer, Model, Name and Serial Number must be persistent through the lifetime of the
accessory" (`HAP/HAPServiceTypes.h:21-24`).

| Characteristic | R/O | Format / perms | Device source | Mapping |
| --- | --- | --- | --- | --- |
| Name | R | string, pr | config / unit nickname | Must start and end with a letter or number and contain only letters, numbers, spaces, apostrophes and common punctuation, or hap-nodejs warns (`util/checkName.js`). Max 64 **bytes**. Single-character names fail the regex. |
| Manufacturer | R | string, pr | constant | `Whisker` |
| Model | R | string, pr | constant | `Litter-Robot 4` |
| Serial Number | R | string, pr | unit serial | Verbatim, 2..64 bytes (`HAPAccessoryValidation.c:42-56`). Never a constant — it is the accessory's identity across restarts. |
| Firmware Revision | R | string, pr | `espFirmware` | Normalised to `x.y.z` by the existing `sanitizeVersion()`. **Correction to three of the five designs:** this is *not* a boot gate here. `HAPAccessoryServerPrepareStart` parses only `primaryAccessory->firmwareVersion` (`HAPAccessoryServer.c:493`), `accessory-model.md:226` states bridged accessories' values "are never parsed, compared or persisted", and hap-nodejs implements no such gate at all. Sanitise because it is good practice, not because the bridge will refuse to start. |
| Hardware Revision | O | string, pr | — | **Omitted.** `picFirmwareVersion` and `laserBoardFirmwareVersion` are firmware, not hardware revisions, and Hardware Revision is never parsed, so the lie would go undetected. They go to read-only customs below. |
| Identify | R | bool, pw | night light | Write `true` → force the ring on at 100 % for ~2 s, then restore the previous `nightLightMode` and `nightLightBrightness`. Writing `false` is rejected as invalid data by HAP itself (`HAPRequestHandlers+AccessoryInformation.c:12-31`). **Never map Identify to `cleanCycle`** — identify must be harmless, and a globe rotating with a cat inside is not. |
| Custom (read-only) | — | pr[, ev], custom UUIDs | `wifiRssi`, `lastSeen`, `odometerCleanCycles`, `scoopsSavedCount`, `DFINumberOfCycles`, `catWeight`, `sleepStatus`, `picFirmwareVersion`, `laserBoardFirmwareVersion`, `cleanCycleWaitTime`, `panelBrightnessHigh`, `robotCycleState` | This is the one service where the ADK explicitly sanctions custom characteristics, and constrains them to Paired Read, Notify, Broadcast and Hidden (`HAPServiceTypes.h:26-29`). All are **invisible in the Apple Home app**; nothing core depends on any of them. Add with `service.addCharacteristic()`, which does not emit hap-nodejs's not-in-optional-section warning (`Service.js:472-500` vs `:486-506`). |

### 4.2 `OccupancySensor` — "Drawer Full" (subtype `drawer-alert`) — **PRIMARY**

| Characteristic | R/O | Format / perms | Device source | Mapping |
| --- | --- | --- | --- | --- |
| Occupancy Detected | R | uint8, ev+pr, 0..1, validValues 0,1 | `isDFIFull`, `DFILevelPercent` | `1` (OCCUPANCY_DETECTED) when `isDFIFull === true` **OR** `DFILevelPercent >= drawerAlertPercent` (config, default 90); else `0`. The percentage term is an early warning so the owner can act before the unit blocks; no source defines a relationship between a level and an indication (`purifier-filter-occupancy-covering.md` open question 6), so this is documented plugin policy. 5-point hysteresis on the way down. |
| Status Active | O | **bool**, ev+pr | `isOnline`, `lastSeen`, `unitPowerStatus` | The uniform predicate (§8.2). Note the format asymmetry: this is the only Bool in the status set. |
| Status Fault | O | uint8, ev+pr, 0..1 | `globeMotorFaultStatus` | `1` on a motor fault — the drawer stops being filled and the gauge is frozen, so the reading is degraded. The enum has no vocabulary for *which* fault; General = 1 is all there is. |
| Name | O | string, pr | static | `Drawer Full` |

### 4.3 `FilterMaintenance` — "Waste Drawer" (subtype `drawer`), linked from `Drawer Full`

"This service can be used to describe maintenance operations for a filter" (`HAPServiceTypes.h:793-796`) —
the palette's only pairing of a maintenance state with a **user-writable acknowledgement**.

| Characteristic | R/O | Format / perms | Device source | Mapping |
| --- | --- | --- | --- | --- |
| Filter Change Indication | R | uint8, ev+pr, 0..1 | same predicate as `Drawer Full` | `1` = CHANGE_FILTER. **Evaluated once and fanned out** to both services so the two representations can never disagree. |
| Filter Life Level | O | **float**, ev+pr, 0..100, step 1, **no unit** | `DFILevelPercent` | **THE INVERSION:** `clamp(100 - DFILevelPercent, 0, 100)`. `DFILevelPercent` is how *full* the drawer is; Filter Life Level is life *remaining*. A drawer 90 % full publishes 10. The ADK declares no unit on this characteristic even though Apple calls it a percentage (`purifier-filter-occupancy-covering.md` open question 3) — publish no unit. |
| Reset Filter Indication | O | uint8, **pw only**, min 1, max 1 | `shortResetPress` | The single most valuable writable on the accessory: the owner's "I emptied it". The spec text is almost a description of the device: "When the value of 1 is written to this characteristic by the user, the accessory should reset it to 0 once the relevant action … is executed. If the accessory supports Filter Change Indication, the value of that characteristic should also reset back to 0" (`HAPCharacteristicTypes.h:2090-2095`). On write: issue `shortResetPress`, optimistically set Filter Life Level 100 / Filter Change Indication 0 **and raise events on both** (the reset characteristic cannot notify, so without that the controller never learns), then `requestState` and reconcile. A read must fail `-70405`. |
| Name | O | string, pr | static | `Waste Drawer` |

Linking is legal to any service on the same accessory and imposes nothing; the ADK states linkage
requirements explicitly where they exist and states none for Filter Maintenance
(`purifier-filter-occupancy-covering.md` open question 1). Its presentational effect is **UNSURE**.

### 4.4 `OccupancySensor` — "Cat In Box" (subtype `cat`)

The one fully honest occupancy mapping: "This characteristic indicates if occupancy was detected
(e.g. a person present)" (`HAPCharacteristicTypes.h:1315-1319`) and something genuinely occupies the globe.

| Characteristic | R/O | Device source | Mapping |
| --- | --- | --- | --- |
| Occupancy Detected | R | `catDetect`, `robotStatus`, `robotCycleState` | `1` when `catDetect` is present and ≠ `CAT_DETECT_CLEAR`, **or** `robotStatus === ROBOT_CAT_DETECT`, **or** `robotCycleState === CYCLE_STATE_CAT_DETECT`. **`0` during `ROBOT_CAT_DETECT_DELAY`** — the cat has left and the clump timer is running (see §2.4). The falling edge means "the cat left". |
| Status Active | O | uniform predicate | Critical here: a powered-off or offline box detects no cats, and a confident `0` would silently poison `Cat Overdue`. |
| Status Fault | O | `globeMotorFaultStatus`, `isLaserDirty` | `1` on either. Stated honestly: the API exposes no health field for the weight sensor, so this is a proxy for "the unit is impaired". |
| Name | O | static | `Cat In Box` |

### 4.5 `StatelessProgrammableSwitch` — "Cat Visit" (subtype `visit`) — *standard/full*

The palette's only true event primitive. A visit is an occurrence, not a state.

| Characteristic | R/O | Format / perms | Device source | Mapping |
| --- | --- | --- | --- | --- |
| Programmable Switch Event | R | uint8, ev+pr (**no pw**), 0..2 | derived from the `Cat In Box` falling edge | Fire **once per completed visit**: a present→absent transition whose dwell ≥ `minDwellSeconds` (default 5) and which is followed by `ROBOT_CAT_DETECT_DELAY` or a cycle. Emit with `sendEventNotification()` so two identical consecutive visits both register (`Characteristic.js:1659-1668`). Declare `validValues [0]` so the Home app cannot offer Double/Long Press automations the plugin never fires (`lights-switches.md` rule 18). Opt-in `visitEventVocabulary: "clinical"` widens to `[0,1,2]` with 1 = repeat visit inside `repeatWindowMinutes`, 2 = stay ≥ `longStayMinutes`; off by default because the Home app labels them "Double Press"/"Long Press" with no way to explain the code. |
| Service Label Index | O | uint8, pr, min 1 | — | **Must NOT be present.** Exactly one instance, and the ADK is explicit: "If there is only one instance of this service on the accessory, `Service Label` is not required and consequently `Service Label Index` must not be present" (`HAPServiceTypes.h:518-519`). No `Service Label` service either. |
| Name | O | string, pr | static | `Cat Visit` |

Reads return `null` over IP by specification (`HAPCharacteristicTypes.h:1382-1385`), and hap-nodejs enforces
it natively — `handleGetRequest` short-circuits this UUID to `null` (`Characteristic.js:1687-1690`) and
excludes it from value correction (`:1516-1527`). Verified, not assumed.

### 4.6 `OccupancySensor` — "Cat Overdue" (subtype `overdue`) — *standard/full*

The brief's stated emergency. HomeKit has **no absence-over-time trigger** anywhere in the 73 services, so
the plugin computes the silence and republishes it as an ordinary notifiable sensor.

| Characteristic | R/O | Device source | Mapping |
| --- | --- | --- | --- |
| Occupancy Detected | R | plugin-maintained `lastVisitAt` | `1` when `now − lastVisitAt > overdueHours` (default 24). Returns to `0` on the next visit. **Three guards, all required:** (a) `lastVisitAt` persisted in `accessory.context` so a Homebridge restart does not reset the clock; (b) suppressed to `0` while `unitPowerStatus === "OFF"` or the unit has been offline longer than the window — "no visits recorded" and "no visits happened" are different facts; (c) `Status Active` false until at least one visit has been observed since install, so a fresh install cannot fire a cat-health emergency on day one. |
| Status Active | O | as above + uniform predicate | false until a baseline exists, and whenever offline/stale/powered off. |
| Status Fault | O | `globeMotorFaultStatus`, `isLaserDirty` | A fault that suppresses cat detection would manufacture a false overdue alarm, so it must travel with this sensor. |
| Name | O | static | `Cat Overdue` |

### 4.7 `OccupancySensor` — "Needs Attention" (subtype `fault`) — *standard/full*

| Characteristic | R/O | Device source | Mapping |
| --- | --- | --- | --- |
| Occupancy Detected | R | `globeMotorFaultStatus`, `isLaserDirty`, `hopperStatus`, sustained offline | `1` when any of: motor fault; `isLaserDirty`; a hopper fault while fitted and the Hopper sensor is not published; or `isOnline === false` / `lastSeen` stale beyond `offlineDebounceMinutes` (default 15). **Deliberately excludes** `isBonnetRemoved` (its own tile, usually the owner's own doing) and `unitPowerStatus === "OFF"` (user intent, not a fault) and `isDFIFull` (its own channel — mixing the routine chore into the fault alarm trains the owner to ignore both). |
| Status Active | O | **always `true`** | The one sensor that reports on the plugin's own view, which is valid precisely when the device's is not. This is what preserves the distinction between "Whisker cloud is down" and "Homebridge is down". |
| Status Fault | O | `globeMotorFaultStatus`, `isLaserDirty` | `1` only for hardware causes, `0` when the cause is merely connectivity — one bit of discrimination for Eve/Controller inside an aggregate the Home app tile cannot break down. |
| Name | O | static | `Needs Attention` |

### 4.8 `Valve` — "Clean Cycle" (subtype `cycle`)

The only service in the palette that separates a **writable target** from a **read-only, notifiable
actual**, which is exactly priority 4's two halves.

| Characteristic | R/O | Format / perms | Device source | Mapping |
| --- | --- | --- | --- | --- |
| Active | R | uint8, ev+pr+pw, 0..1 | `robotStatus`; `cleanCycle` | Read `1` while `robotStatus ∈ {ROBOT_CLEAN, ROBOT_EMPTY, ROBOT_FIND_DUMP}` or a `cleanCycle` write is in flight; `0` otherwise. Set for device-initiated cycles too — Active means the service is active, not "a controller asked". **Write 1** → welfare guard first (below), then `cleanCycle`. **Write 0** → the API has no cancel: accept, do nothing, immediately re-raise the true value. Invariant: Active is never 0 while In Use is 1, as the spec requires. |
| In Use | R | uint8, ev+pr, 0..1 | `robotStatus`, `robotCycleState` | `1` only while the globe is actually turning — the cycling states and not `CYCLE_STATE_PAUSE`, not `ROBOT_CAT_DETECT_DELAY`. "The service must be 'Active' before the value of this characteristic can be set to in use" (`HAPCharacteristicTypes.h:2795-2798`); our mapping satisfies that. This is the characteristic that answers "is it cycling *right now*". |
| Valve Type | R | uint8, ev+pr, 0..3 | constant | `0` GENERIC_VALVE. Chosen over IRRIGATION specifically: "If an accessory has this service with `Valve Type` set to Irrigation it must include the `Set Duration` and `Remaining Duration` characteristic" (`HAPServiceTypes.h:1019-1021`), and both would be fabrications. |
| Status Fault | O | uint8, ev+pr | `globeMotorFaultStatus`, `isBonnetRemoved`, `isOnline` | `1` in every state where a requested cycle will not run. |
| Set Duration | O | — | — | **Not published.** Cycle length is not user-settable, and it must never carry clump time: Set Duration "defines how long a valve should be set to In Use" — a run length — while `cleanCycleWaitTime` is a pre-cycle delay. The one characteristic that looked like a fit means the opposite. |
| Remaining Duration | O | — | — | **Not published** (grafted from Drawer First, endorsed by maintainer). No API field reports cycle progress or duration, so any countdown would be a systematically wrong number. Had it been published, its notification rule is unusual and non-negotiable: notify at start, on a jump, and at zero — never tick down event by event (`HAPCharacteristicTypes.h:2851-2857`). |
| Is Configured / Service Label Index | O | — | — | **Not published.** Is Configured is required only in an irrigation or shower context; Service Label Index only when a bridge or accessory carries multiple Valve services (`HAPServiceTypes.h:1023-1035`). Exactly one valve here. |
| Name | O | string, pr | static | `Clean Cycle` — chosen so "turn on the clean cycle" reads naturally despite the valve noun. |

**Welfare guard (grafted from Clinic Mode, endorsed by all three judges).** A write of Active = 1 while
`catDetect` is non-clear or `robotStatus === ROBOT_CAT_DETECT` is **refused with a HAP error**, not
forwarded. This is the only genuinely safety-relevant idea in the five designs, it costs one conditional,
and it makes every scene, Siri phrase and automation that starts a cycle safe to build. Note the
deliberate asymmetry with the Off write: we return an error when we *choose* to block (the user must know),
and revert silently when the API simply has no cancel (an error there would be a failure the user cannot
act on).

### 4.9 `ContactSensor` — "Bonnet" (subtype `bonnet`)

The one place the Home app's Open/Closed vocabulary is literally correct, so Contact Sensor is spent here
and on the hopper, and nowhere else. "A value of 0 indicates that the contact is detected. A value of 1
indicates that the contact is not detected" (`HAPCharacteristicTypes.h:1131-1134`).

| Characteristic | R/O | Device source | Mapping |
| --- | --- | --- | --- |
| Contact Sensor State | R | `isBonnetRemoved`, `robotStatus` | Removed (or `ROBOT_BONNET`) → `1` CONTACT_NOT_DETECTED, renders "Open". Seated → `0`, "Closed". |
| Status Active | O | uniform predicate | — |
| Status Tampered | O | `isBonnetRemoved` | `1` while the bonnet is off. Defensible on the spec text — "the accessory has been tampered with … Value should return to 0 when the accessory has been reset to a non-tampered state" (`:1558-1561`) — and free, but "tampered" is a security word for routine servicing, so it is **opt-in** (`exposeBonnetTamper`, default false) and invisible in the Home app anyway (UNSURE). |
| Name | O | static | `Bonnet` |

### 4.10 `FilterMaintenance` — "Litter Supply" (subtype `litter`) — *standard/full*

| Characteristic | R/O | Device source | Mapping |
| --- | --- | --- | --- |
| Filter Change Indication | R | `litterLevelState` | `LOW` → 1, `OPTIMAL` → 0. Uses the device's own verdict rather than a threshold the plugin invents, so the tile agrees with the robot's panel. |
| Filter Life Level | O | `litterLevelPercentage` | **NO inversion** — `litterLevelPercentage` is already litter *remaining*, which is already the Filter Life Level semantic. Keep the existing normalisation for the API's 0..1-vs-0..100 ambiguity (`robot-state.ts`), then clamp/round to 0..100. |
| Reset Filter Indication | O | — | **Not published.** No litter-reset command exists; the laser re-measures. A write-only reset that silently does nothing is a control that lies. |
| Name | O | static | `Litter Supply` |

> **The single easiest bug in this design**, named by four of the five source designs and fixed by none of
> them: the drawer gauge inverts and the litter gauge does not. §10 specifies the fix (one function with an
> explicit direction argument, two unit tests) rather than another warning comment.

### 4.11 `Lightbulb` — "Night Light" (subtype `nightlight`)

| Characteristic | R/O | Format / perms | Device source | Mapping |
| --- | --- | --- | --- | --- |
| On | R | bool, ev+pr+pw | `nightLightMode`; `nightLightModeOn`/`Off`/`Auto` | Read `true` when mode ≠ `OFF` (ON or AUTO). **Write `true`** → `nightLightModeAuto` when `nightLightOnMode: "auto"` (**default**, which preserves the current plugin's behaviour and does not silently destroy a user's AUTO), or `nightLightModeOn` when `"on"`. **Write `false`** → `nightLightModeOff`. |
| Brightness | O | **int** (not float), ev+pr+pw, percentage, 0..100, step 1 | `nightLightBrightness`; `setNightLightValue` | 1:1, no scaling. Write `n>0` → `setNightLightValue(n)`. Write `0` → `nightLightModeOff`, remembering the last non-zero value so the next On restores a visible level. Handle the Home app's simultaneous On+Brightness writes idempotently. |
| Hue / Saturation / Color Temperature | O | — | — | Not published — the ring's colour cannot be set, and a writable colour picker would be a lie. |
| Name | O | string, pr | static | `Night Light` |

### 4.12 Conditional and opt-in services

| Service | Subtype | When | Characteristics |
| --- | --- | --- | --- |
| `ContactSensor` "Hopper" | `hopper` | only when the account reports a LitterHopper fitted | Contact Sensor State ← `isHopperRemoved` (removed → 1 "Open"); Status Fault ← `hopperStatus` non-nominal; Status Active ← uniform predicate. Publishing it unconditionally would give every hopper-less owner a permanently-Open tile. |
| `OccupancySensor` "Litter Low" | `litter-alert` | opt-in, default **off** | Occupancy Detected ← `litterLevelState === LOW` or `litterLevelPercentage <= litterAlertPercent` (default 15); Status Active ← uniform predicate **AND NOT** `isLaserDirty` (the laser *is* the instrument behind this reading); Status Fault ← `isLaserDirty`. Off by default because priority 5 is low-urgency and the gauge already carries it. |
| `Switch` "Night Light Auto" | `nightlight-auto` | opt-in, default **off** | On ← `nightLightMode === "AUTO"`; write true → `nightLightModeAuto`, write false → `nightLightModeOn` (handing control back, not darkening the room). Lightbulb has no manual/auto axis — `Target Fan State` MANUAL/AUTO is a fan-family characteristic only. The two services are driven from one state machine so they can never display a contradictory pair. |
| `Switch` "Litter Box Power" | `power` | opt-in, default **off** | On ← `unitPowerStatus` (`ROBOT_POWER_UP`/`DOWN` report the state being moved towards, so the tile does not flicker); write → `powerOn`/`powerOff`. **Default off deliberately:** a powered-off LR4 is a welfare problem, and a published power Switch can be hit by "turn everything off" scenes, a guest, or a misheard Siri phrase. The long name makes it hard to hit by accident when enabled. |
| `Switch` "Control Lock" | `keypad` | opt-in, default **off** | On ← `isKeypadLockout`; write → `keyPadLockOutOn`/`Off`. See §6 for why this is a Switch and not a `LockMechanism`. |

---

## 5. Why `Drawer Full` is the primary service

`isPrimaryService` is probably inert, and that is the first thing to say honestly: HAP permits at most one
per accessory (`HAP/HAP.h:3173-3179`), `HAPAccessoryValidation` does not enforce it, hap-nodejs serialises
it, Apple documents it only as a read-only boolean with no statement about presentation, and
`purifier-filter-occupancy-covering.md` open question 8 asks whether a bridge may usefully mark a bridged
accessory's service primary at all. So the correct choice is the one that is right if it matters and
harmless if it does not.

Given that, primary should point at the owner's number-one priority. The drawer is the recurring chore and
the thing worth a push; power is never news, and the cycle is priority 4. Between the two carriers actually
proposed for the drawer alert:

- `ContactSensor` renders "Open" for a drawer that is closed and full, puts the litter box into every
  "is anything open before bed" sweep, and gives Siri "is the waste drawer open?" as the route to a
  fullness answer.
- `OccupancySensor` named for the condition renders "Drawer Full — Detected", and the automation editor
  reads "When Drawer Full detects occupancy" — awkward grammar, true statement.

Both borrow a noun. Only one of them produces a true sentence, and the sentence is the part the accessory
controls. The cost of the occupancy choice is stated in §7 and is real: three condition-shaped occupancy
sensors join the household's genuine presence sensors, and Apple's controller-side gloss for the two values
is "The home is occupied" / "The home is not occupied", which is stronger than the ADK's soft
"(e.g. a person present)".

One verified consolation for the contact camp: hap-nodejs fast-paths `ContactSensorState` and
`MotionDetected` — alongside `ProgrammableSwitchEvent` and `ButtonEvent` — to immediate event delivery,
bypassing the one-second coalescing window (`Accessory.js:1435-1436`). Occupancy is not on that list. For a
drawer that fills over days and a bonnet that stays off for minutes, sub-second latency is worth nothing,
so it does not change the choice — but it is a real, checkable fact none of the five designs found, and it
would matter for a fast-moving signal.

---

## 6. Rejected, and why

| Rejected | Why |
| --- | --- |
| **`AirPurifier` as primary with linked Filter Maintenance** (the inherited design, and what the plugin ships today) | Rejected on the merits, not because it is inherited. Its required trio is `Active` + `Current Air Purifier State` + `Target Air Purifier State` (verified). Two of the three are fabrications: `Current Air Purifier State`'s vocabulary is INACTIVE/IDLE/PURIFYING_AIR with no member for cat-detect, bonnet-removed, motor fault, power-up or find-dump; `Target Air Purifier State` is a MANUAL/AUTO mode picker with no off case and nothing to map onto — the current code publishes it pinned to AUTO with `validValues [AUTO]`, which is an admission that it does not exist on this device. The tile reads "Idle"/"Purifying" when the news is "drawer full", Siri says "turn on the air purifier", and Apple files the service under air quality. The one thing it bought — a parent for Filter Maintenance — is not needed: no source imposes any linkage requirement on Filter Maintenance in either direction. |
| **`Battery` for drawer capacity** (`Battery Level = 100 − DFILevelPercent`, `Status Low Battery = isDFIFull`) | Mechanically ideal and probably the only route to Home-app escalation, which is exactly why it is dangerous. The LR4 is mains powered (`unitPowerType`). The user is told the Litter-Robot's battery is low, goes looking for batteries, finds none, and does not empty the drawer — an alert that misdirects is worse than no alert. It would also corrupt any "what needs batteries" sweep. Noted in passing: hap-nodejs makes only `Status Low Battery` required with Battery Level and Charging State optional, while the ADK lists all three — a real library-vs-spec divergence for anyone tempted. |
| **`LeakSensor` for drawer-full** | Right urgency, wrong class. It would put a routine chore into the one alert class users treat as a house emergency, next to their real leak detectors, and could trip water-shutoff automations. Nothing leaks. |
| **`SmokeSensor` / `CarbonMonoxideSensor` / `CarbonDioxideSensor`** | Life-safety classes. Never borrowed, at any price. Borrowing one for litter trains the owner to dismiss the notification style a real alarm uses. |
| **`AirQualitySensor`** (1..5 Excellent→Poor from drawer fullness, or as a "health score") | The most thematic trap in the palette. The device has no air sensor of any kind, so the value would be *fabricated sensor data*, not a re-labelled measurement — every other rejection here is a wrong noun; this one invents a reading. It would also feed the Home app's air section and every air-quality automation in the house. As a health score it is worse still: a plugin is not competent to publish a clinical judgement an owner might be reassured by. |
| **`HumiditySensor` / `TemperatureSensor` / `LightSensor` as numeric carriers** (drawer %, litter mm, cat weight, visit counts) | Numeric smuggling: the range fits and the quantity is not what the characteristic names. Clinic Mode found the decisive extra argument for temperature specifically — it is **locale-converted for display**, so a 10 lb cat published as `CurrentTemperature` renders as 50 to a Fahrenheit viewer; the number is corrupted, not merely mislabelled. Humidity at least survives conversion, which is why it is the least-bad lie — and it is still a lie, so cat weight goes to a read-only custom instead. |
| **`HumidifierDehumidifier` for `Water Level`** | A filling tank is the closest physical analogy in the palette, but `Water Level` cannot be had alone: the service requires Active, Current Relative Humidity and both Humidifier-Dehumidifier states. Four fabrications to buy one number Filter Maintenance already carries. |
| **`MotionSensor`, inverted, for Cat Overdue** | `Motion Detected` true when there has been *no* activity means the literal opposite of the characteristic. All three judges rejected it, and it is precisely what the honesty rule exists to forbid. An `OccupancySensor` named for the condition gets the same alert with the noun merely borrowed rather than reversed. |
| **`MotionSensor` for the cat** | The device senses presence and weight, not movement; a cat sitting still is still there. Motion is also the trigger every security and lighting automation in a house is built on. |
| **`IrrigationSystem` / `Faucet` wrapping the Valve** | Irrigation System requires Program Mode and models scheduled watering across zones; Faucet "must only be included when an accessory has either a linked Heater Cooler with single linked Valve service or multiple linked Valve services" (`HAPServiceTypes.h:1067-1074`) — structurally illegal here. Both also force the water metaphor further. |
| **`Fanv2` for the globe** | Closest structural fit outside Valve (Active + Current Fan State INACTIVE/IDLE/BLOWING_AIR), and it would legally host `Lock Physical Controls` for the child lock. Rejected: nothing moves air, `Rotation Speed` would be fabricated or conspicuously absent, and the accessory would answer to "fan" — so "turn on all the fans" would cycle the litter box. Adopting a false primary noun to inherit one correct characteristic is the tail wagging the dog. |
| **`Lock Physical Controls` on a `Switch`** | The semantically perfect child-lock characteristic — "a way to lock a set of physical controls on an accessory (eg. child lock)". **Verified host list: exactly four services — AirPurifier, Fanv2, HeaterCooler, HumidifierDehumidifier.** (Three of the five designs got this list wrong, in three different ways.) Bolting it onto a Switch publishes a Switch that violates its own definition and triggers hap-nodejs's not-in-optional-section warning. Unreachable; dropped. |
| **`LockMechanism` for the keypad child lock** | Defensible on the spec text and it gives the best Siri phrase in the whole product ("lock the litter box keypad"). Rejected because it files a litter box in the Home app's lock/security surface and Siri's lock vocabulary, where a household "is everything locked?" check may sweep it in. A plain `Switch` named "Control Lock" says the same thing with none of that, for the price of a generic noun on a setting touched twice a year. |
| **`Lightbulb` for the control-panel LED** | `Brightness` explicitly permits backlights, so the characteristic is honest — but `Lightbulb` requires `On` and there is no panel-off command. Every resolution lies: On permanently true ignores writes, or "off" means "dimmest". Fails the both-directions test (grafted from Four Tiles). |
| **Three `Switch`es for clump time (3/7/15)** | Would work, and costs three permanent tiles with no mutual-exclusion guarantee for the second-lowest-priority setting in the product. |
| **Writable custom characteristics for clump time / panel brightness** | Invisible to the primary audience, off-spec for their host service, and warned about by hap-nodejs. See §2.7. |
| **`StatefulProgrammableSwitch`** | **Confirmed finding:** this ADK release does not define the service or `Programmable Switch Output State` at all — a recursive grep of `HAP/` returns zero hits — even though hap-nodejs defines the service and Apple documents the symbols. Beyond that, it models a wall switch that holds a position; the LR4 has no such control. |
| **`Doorbell` for a cat visit** | It is a better-supported Programmable Switch Event carrier, and it can ring chimes on HomePods and Apple TVs. Announcing a cat's bathroom visit through the house doorbell is actively harmful. |
| **`Door` / `Window` / `WindowCovering` / `Slats` / `GarageDoorOpener`** | Position services: `Current Position` is defined in terms of admitting light, `Position State` assumes travel between endpoints, and all imply a `Target Position` the user can drag. The globe has no resting position; the bonnet is lifted by hand and reported as a boolean. |
| **`SecuritySystem`** | Arm/disarm/triggered are whole-home security postures. Driving ALARM_TRIGGERED from a motor fault produces a house alarm for a litter box. |
| **`Outlet`** | Requires `Outlet In Use` — "if the power outlet has an appliance … physically plugged in". The LR4 *is* the appliance. |
| **`ServiceLabel` across the sensors** | Required only for multiple `Valve` or multiple `Stateless Programmable Switch` instances. Multiple ContactSensor / OccupancySensor / FilterMaintenance instances carry no such obligation, and a labelled service's default Name must be empty — which would leave the tiles unnamed, destroying the entire naming thesis. |
| **`Diagnostics`, `FirmwareUpdate`, `AccessoryRuntimeInformation`, `AccessoryMetrics`, `PowerManagement`** | TLV8 control-point services implementing Apple's own diagnostics and UARP update pipelines. They require values a cloud bridge cannot synthesise, they are user-invisible (the ADK names a Firmware Update service as its example of a service that must *not* be named), and they contribute nothing to triggers or notifications. |
| **Splitting into several HomeKit accessories** | Linked services must live on one accessory or validation fails; a second accessory needs a second Accessory Information with a fabricated serial; and the Home app already surfaces each service as its own tile. No gain, several costs. |
| **Publishing less (the Four Tiles position)** | The most rigorous document of the five and the least useful design: it drops the drawer percentage, the reset, the cycle trigger, litter level and the child lock, leaving the owner's number-one concern as an undifferentiated bit inside a `Status Fault` the design itself doubts renders anywhere. Its case for dropping `cleanCycle` collapses once you notice `robotStatus` provides a real On state — the only defect is an off-write that cannot be honoured, which is a disclosed compromise, not a lie about the service type. Honesty is a constraint on how you map a capability, not a licence to drop four of seven stated priorities. |

---

## 7. Compromises, and what each costs the user

1. **`OccupancySensor` as a condition carrier** for Drawer Full, Cat Overdue, Needs Attention and
   (opt-in) Litter Low. Only `Cat In Box` uses it for what Apple defines it as.
   **Cost:** Siri's occupancy grammar is wrong for all of them; the Home app may suggest
   occupancy-flavoured automations; and this accessory contributes three to four occupancy sensors to a
   home that may use occupancy for genuine presence — Apple's controller-side gloss is "The home is
   occupied". **Mitigation:** every one is named for its condition, so "Detected" always means "this
   named condition is true"; one consistently applied compromise is learnable. **Warn the user** to scope
   any "when occupancy is detected" automation to the named accessory.

2. **`FilterMaintenance` for a waste drawer.** A sealed receptacle is not a filter, and "Filter Life
   Level" names remaining drawer capacity. **Cost:** filter vocabulary and iconography wherever the
   service is shown; Apple files the service type near thermostats and humidifiers; and there is no Siri
   noun for it at all. **Bought for:** `Reset Filter Indication`, a one-to-one match for `shortResetPress`
   and the only user-writable maintenance acknowledgement in the entire 73-service palette.

3. **`FilterMaintenance` for litter.** Same wrong word, cheaper: `litterLevelPercentage` is already
   "remaining", so at least the arithmetic is honest.

4. **Two representations of one drawer** (the alert sensor and the gauge). **Cost:** possibly one
   redundant tile, and a moment's doubt about which is authoritative. **Bought for:** insurance against the
   undocumented question of whether a standalone Filter Maintenance service renders as a tile or notifies
   at all. **Mitigation:** distinct names that read as alarm + gauge, and a single evaluation fanned out so
   they cannot contradict each other. One config flag (`drawerAlertSensor: false`) removes the mirror if
   the Home app turns out to notify on Filter Change Indication.

5. **`Valve` for the clean cycle.** No fluid flows. **Cost:** a water/valve noun and icon; Apple groups
   Valve under "Water" with Faucet, Irrigation System and Leak Sensor, so the control may be filed with
   plumbing; Siri accepts "open the clean cycle". **Bought for:** writable Active plus read-only In Use —
   the only way "is it cycling right now" is separately observable and automatable.

6. **Valve Active = 0 cannot abort.** **Cost:** the user can slide the toggle off and watch it spring
   back, which looks like a bug. Returning `-70402` instead (as one judge suggested) surfaces as a failure
   or an unresponsive tile, which is worse for a command the user did not need to succeed. The springback
   is the honest message; the plugin logs it.

7. **`Cat Overdue` is entirely plugin-derived.** **Cost:** it depends on the plugin's own visit detection
   and persisted state, so a corrupted store or a run of missed visits can produce a false emergency —
   and in a multi-cat household it cannot detect *one* of two cats stopping, which is exactly the
   emergency the brief describes. That limitation is the product's, not HomeKit's, and it must be stated
   in the plugin README so an owner does not over-read the signal.

8. **Visit detection is only as good as the poll.** A visit that begins and ends between two polls is
   invisible. At the default 60 s poll a short visit can be missed entirely. Recommend 20-30 s when
   `Cat Visit`/`Cat Overdue` are enabled, and say plainly in the docs that visit signals are best-effort
   unless Whisker exposes a push feed.

9. **`Needs Attention` is an aggregate.** **Cost:** one push says something is wrong without saying what.
   `Status Fault` has exactly one non-zero value and no vocabulary for a cause. **Mitigation:** the most
   common cause (bonnet) has its own tile, `Status Fault` discriminates hardware from connectivity for
   Eve/Controller, and every contributing reason is written to the plugin log.

10. **The night light reads On in AUTO.** No field reports whether the ring is currently lit. **Cost:** a
    lit lamp icon for a dark lamp, and "turn off all the lights" sets the mode to OFF rather than merely
    darkening the ring. Reporting false in AUTO would make the light indistinguishable from disabled.

11. **The night light joins its room's lights.** "Turn on the kitchen lights" will light the litter box if
    the box lives in the kitchen. Accepted — it genuinely is a light.

12. **Clump time and panel brightness are dropped entirely.** **Cost:** two real settings unreachable from
    HomeKit; the owner uses the Whisker app, as they do today. The honest alternatives were a Lightbulb
    whose Off write cannot be honoured, three tiles of radio-button Switches, or invisible off-spec
    writable customs.

13. **Sleep schedule, cat weight, counters and RSSI are read-only customs, invisible in the Home app.**
    **Cost:** Home-app-only owners never see them. None carries a core function; the alternative for each
    was a service whose Apple-defined meaning contradicts the data.

14. **Tile count: 10 by default.** **Cost:** real, and the direct consequence of one-tile-per-service with
    per-service notifications. **Mitigation:** the `lean` profile (6) and per-service overrides, plus a
    documented recommendation to put the cat/maintenance sensors in their own room or group.

---

## 8. Behaviour the whole design depends on

### 8.1 Events are the plugin's job

"You only receive updates for changes made outside your app" — a cloud-polled change is exactly that, and
nothing raises events for a bridge. Every characteristic here declares `ev`, and every transition (a cycle
started from the unit's keypad, a cat entering, the drawer filling, the bonnet coming off, a change made in
the Whisker app) must be pushed or the tiles stay stale for a week. Raise only on real change; coalesce to
at most one notification per second per connection. `Programmable Switch Event` is the exemption and must be
sent with `sendEventNotification()`.

### 8.2 One uniform `Status Active` predicate

```
statusActive = isOnline === true
            && (lastSeen === undefined || now - lastSeen < staleMinutes)   // default 15
            && unitPowerStatus === 'ON'
```
Applied to every sensor except `Needs Attention` (always true) and `Litter Low` (additionally requires
`!isLaserDirty`). The `lastSeen` term — omitted by three of the five designs — is what catches a cloud that
reports `isOnline: true` while serving a two-hour-old reading. One predicate, one thing to test.

### 8.3 Offline, resolved

| Situation | Behaviour | Why |
| --- | --- | --- |
| Plugin cannot reach the Whisker cloud (auth/network/timeout) past `commFailureAfterPolls` consecutive failures (default 3, as today) | Return `-70402` (`HapStatusError(SERVICE_COMMUNICATION_FAILURE)`) on reads and writes for this accessory → the Home app shows **No Response** | This is a bridge that cannot contact its downstream device. `accessory-model.md` rule 40: answer with a failure status rather than a stale value; `-70402` is the code, and the controller surfaces `bridgedAccessoryNotReachable`. Greying out is also the most glanceable possible rendering of "something is wrong". |
| Cloud reachable, but reports `isOnline: false` for the robot | **Serve values**, drop `Status Active` to false everywhere, trip `Needs Attention` after the debounce, suppress `Cat Overdue` | The bridge *did* reach its backend; unreachability is data the backend reported, not a transport failure. Erroring here would grey out the accessory and take `Needs Attention` down with it, destroying the one signal that can tell the owner the box is unreachable. |
| Whisker cloud slow | Time out well inside the controller's patience and return a status; never block | `accessory-model.md` rule 41 — one unreachable device must not fail the batch. |

---

## 9. What the owner actually experiences

### Home app

One accessory, "Litter-Robot", whose services appear as separately named entries — Apple's own framing is
that the things a user names "appear in the Home app as an 'accessory'. However, in HomeKit, these are
hmservice instances". That quote is the *only* sourced statement about Home app presentation available
here; tile ordering, prominence, whether many services on one accessory collapse, whether services can be
roomed separately, the exact tile wording, and whether the Home tab has a Status section that summarises
any of this are all **UNSURE** and unsourced. The design is built so that nothing essential depends on the
answers.

Default (`standard`), roughly in order of usefulness: **Drawer Full**, **Cat In Box**, **Cat Overdue**,
**Needs Attention**, **Clean Cycle**, **Bonnet**, **Litter Supply**, **Night Light**, **Cat Visit**, and
**Waste Drawer** (which may render as its own tile, as a row inside the parent's detail view, or not at
all — the load-bearing unknown, hedged in §7.4). Hopper appears only when fitted.

Expected wording (UNSURE): occupancy tiles read "Detected"/"Not Detected", so every condition-named sensor
reads as a true sentence; Bonnet and Hopper read "Open"/"Closed", which is correct English for a cover;
Clean Cycle is a valve-family tile whose In Use state tracks the globe; Night Light is an ordinary
dimmable light; Cat Visit is a stateless button tile with no state, which the Home app offers as an
automation trigger.

Tapping in gives the drawer percentage, the "I emptied it" reset, the litter percentage, the cycle's Active
toggle and the brightness slider. Eve / Controller / Home+ additionally see cat weight, RSSI, the
odometers, the sleep flag, clump time, panel brightness and cycle phase, plus `Status Fault` /
`Status Active` discrimination and the ability to use any characteristic as an automation *condition*.

### Siri

| Phrase | Effect |
| --- | --- |
| "Hey Siri, turn on the clean cycle." | Valve Active = 1 → `cleanCycle`, refused with an error if the cat is detected. The valve noun is nearly invisible in this phrasing, which is why the service is named this way. |
| "Hey Siri, is the bonnet open?" | Fully honest — the bonnet genuinely is on or off. |
| "Hey Siri, turn on the night light." / "…set the night light to 20 percent." | Fully honest. |
| "Hey Siri, is Cat In Box detecting occupancy?" | Awkward but semantically true; the one occupancy sensor where the answer means what Siri thinks it means. |
| "Hey Siri, is Drawer Full detected?" | The compromise at its worst: the right answer arrives in unusable grammar. The owner will ask "is the litter box full?" and it maps to nothing. **The drawer is a notification, not a voice query.** |
| **Not available at all** | Reading back the drawer percentage or the litter percentage (no Siri route exists through Filter Life Level); asking what the cat weighs; asking when the cat last went; starting a cycle by saying "clean the litter box" (make a Home *scene* of that name containing Clean Cycle = On — worth putting in the plugin README, because it is the phrase owners reach for). |

All Siri phrasing is **UNSURE**: the 1302-page crawl documents no Siri grammar for any service type.

### Automations

- **The one that matters, and it needs no automation at all:** switch on Notifications for `Drawer Full`.
  Whether the Home app offers that toggle for a sensor service is the design's single load-bearing
  unsourced assumption (§11), hedged by §7.4.
- Independent notification channels for `Needs Attention`, `Cat Overdue`, `Bonnet` and (opt-in)
  `Litter Low`, so a bonnet left off does not arrive with the urgency of a cat that has not gone in a day.
- "Every evening at 8 pm, if Drawer Full is Detected, notify me" — a daily nag that only fires when the
  chore is real, and arguably better than the edge trigger, which fires once and can be missed.
- "When Cat Visit is pressed → run the bathroom fan for 10 minutes" or "→ append a timestamp to a note via
  Shortcuts", which is how an owner builds the visit record for a vet appointment.
- "When I leave home, if Cat In Box is Not Detected, turn on Clean Cycle" — occupancy as a safety
  condition guarding a cycle trigger (conditions on sensors need Eve/Controller/Home+; the Apple Home app
  restricts conditions to time and people). The plugin's welfare guard backs it up regardless.
- "When Clean Cycle stops being In Use → …" — both edges are observable because In Use is `pr` + `ev`.
- **What still cannot be expressed in HomeKit:** "the cat has not used the box in 24 hours". There is no
  absence-over-time primitive in `HMEventTrigger`. That is precisely why `Cat Overdue` exists as a
  plugin-computed sensor.
- **Hazard to document:** this accessory adds up to four occupancy sensors and two contact sensors to the
  home. Broad automations ("when any contact sensor opens", "when occupancy is detected, turn on lights")
  will now fire on the litter box. Scope them to the named accessory.

---

## 10. Migration impact for the already-published plugin

`homebridge-mm-litterrobot` 0.1.0 currently publishes: `AirPurifier` (primary, no subtype),
`FilterMaintenance`/`drawer` "Waste Drawer", `FilterMaintenance`/`litter` "Litter Level",
`OccupancySensor`/`cat` "Cat Detected", `Switch`/`clean` "Clean Cycle", `Lightbulb`/`nightlight`
"Night Light", `Switch`/`reset` "Reset Waste Gauge". **This is a breaking change for the user's
automations, and the release must say so in those words.**

**What survives untouched**

- **The accessory itself.** Its UUID is derived from the serial (`uuidFor(device.uniqueId)`), which does
  not change — so pairing, room assignment, the accessory-level name and the user's own renames survive.
  **Do not change the accessory UUID derivation.**
- **Category.** Cached accessories keep the category stored at creation; the new `OTHER` applies only to
  newly discovered units, and is inert behind a bridge either way. No user-visible effect.
- Services whose **type and subtype are both unchanged** are restored by Homebridge and keep their
  identity, so automations bound to them survive: **`FilterMaintenance`/`drawer`**,
  **`FilterMaintenance`/`litter`**, **`OccupancySensor`/`cat`**, **`Lightbulb`/`nightlight`**. Reuse those
  exact subtype strings — this is a deliberate design constraint, not an accident.

**What breaks, and what the user must rebuild**

| Change | Consequence |
| --- | --- |
| `AirPurifier` removed (`pruneServices` deletes it) | Every automation, scene membership and Siri phrase bound to that tile stops working. Most importantly the purifier's `Active` was the **power control** — users who powered the unit from that tile lose it unless they enable the opt-in `Litter Box Power` switch. Call this out first in the changelog. |
| `Switch`/`clean` → `Valve`/`cycle` | Different service type, so the old service is pruned and a new one appears. "Turn on Clean Cycle" automations and scenes must be rebuilt. The **display name is kept identical** so the rebuild is obvious. |
| `Switch`/`reset` removed | Replaced by `Reset Filter Indication` on the Waste Drawer service, which is always available. Any automation that flipped that switch must be rebuilt (and it is now a HomeKit reset gesture rather than a fake momentary switch). |
| `OccupancySensor`/`cat` renamed "Cat Detected" → "Cat In Box"; `FilterMaintenance`/`litter` renamed "Litter Level" → "Litter Supply" | The accessory-side `Name` changes. A user's own rename in the Home app is controller-side and is never overwritten; for users who never renamed, the label changes. Automations survive (same service). |
| New services appear (Drawer Full, Cat Visit, Cat Overdue, Needs Attention, Bonnet) | New tiles in the user's default room. Tell them to expect it and to re-room or switch to the `lean` profile if they want fewer. |
| Config keys | `exposeCleanSwitch` / `exposeOccupancy` / `exposeResetSwitch` become meaningless. Accept them for one minor version with a deprecation warning mapping them onto the new profile/flags, then remove. `exposeNightLight` maps straight through. |
| `config.schema.json` `headerDisplay` | Currently describes the Air Purifier tile. Rewrite it and the README together with the release notes. |
| Whisker query | `ROBOT_FIELDS` does not yet request `isLaserDirty`, `globeMotorFaultStatus`, `hopperStatus`, `isHopperRemoved`, `litterLevel`, `cleanCycleWaitTime`, `DFINumberOfCycles`, `scoopsSavedCount`, `smartWeightEnabled`, `lastSeen` or `unitPowerType`. Add them, and treat any field the account does not return as "capability absent" rather than "condition false". |
| `LR4Command` | Missing `setNightLightValue`, `keyPadLockOutOn`/`Off`, `panelBrightnessLow`/`Med`/`High`, `setClumpTime`. Only `setNightLightValue` is needed for the default profile (Brightness); the keypad commands are needed for the opt-in Control Lock. |

**Recommendation:** ship as **0.2.0** with a `BREAKING CHANGES` section listing, by name, the three tiles
whose automations must be rebuilt (the Air Purifier, the Clean Cycle switch, the Reset Waste Gauge switch),
and default the new install to the `standard` profile while defaulting *upgrades* to `standard` as well —
no silent tile explosion beyond what is listed.

---

## 11. Implementation notes for the engineer

1. **One predicate, fanned out.** Compute `drawerNeedsEmptying` exactly once per poll and publish it to
   both `Drawer Full`'s Occupancy Detected and `Waste Drawer`'s Filter Change Indication. Same for the
   litter predicate. This is the invariant that keeps the redundancy safe.
2. **Fix the inversion asymmetry structurally**, do not comment it. One helper —
   `lifeLevel(value, { measures: 'fullness' | 'remaining' })` — plus two unit tests: a 90 %-full drawer
   publishes 10, a 15 % litter reading publishes 15. Four of the five source designs named this as the
   easiest bug in the model and none of them fixed it.
3. **Keep the existing subtypes** `drawer`, `litter`, `cat`, `nightlight` verbatim (§10).
4. **Welfare guard** in the Valve Active write handler before any network call: if the cat is detected,
   throw a `HapStatusError` and log why. Cover it with a test.
5. **`Cat Overdue` state** (`lastVisitAt`, `hasObservedAVisit`) lives in `accessory.context` so it
   survives restarts, and all three guards from §4.6 are individually testable.
6. **Cat Visit** must use `sendEventNotification()`, must never be given a write handler, and needs
   `setProps({ validValues: [0] })` in the default vocabulary. Do not add `Service Label Index`.
   hap-nodejs already returns `null` on read for this UUID; do not try to "fix" that.
7. **Custom characteristics** go on `AccessoryInformation` only, read-side permissions only, added with
   `service.addCharacteristic(new CustomChar())` — `getCharacteristic()` on a type not in the
   required/optional lists emits a runtime warning, `addCharacteristic()` does not.
8. **Do not seed `ConfiguredName`** on Switch / ContactSensor / OccupancySensor / FilterMaintenance /
   Lightbulb / Valve. Verified: hap-nodejs 2.2.2 lists it only on AccessoryInformation, InputSource,
   SmartSpeaker, Television and WiFiRouter. The existing `ensureService()` already guards this with
   `testCharacteristic()`, so no change is needed — just do not remove that guard.
9. **`setPrimaryService(true)` on `Drawer Full` and on nothing else.** At most one per accessory.
10. **Poll cadence.** Default 60 s stays, but when `Cat Visit` or `Cat Overdue` is enabled, warn if the
    interval exceeds 30 s, and prefer a push/websocket feed if Whisker exposes one.
11. **Unknown enum values are faults, not health.** `hopperStatus`, `globeMotorFaultStatus` and
    `catDetect` values beyond the known-good set should alert and log the raw string rather than be
    assumed benign — with one exception: `globeMotorFaultStatus` should default to *no fault* on an
    unrecognised value so an unknown nominal string does not cry wolf forever. Tighten both against a live
    payload before shipping.
12. **Firmware.** Keep `sanitizeVersion()`, but drop any claim in comments or docs that an unparseable
    value stops the bridge — it does not, for a bridged accessory (§4.1).
13. **Every state characteristic declares `ev` and must actually be pushed**, including changes made in
    the Whisker app or on the unit's own panel. Suppress the event when the value did not change.
14. **Log the reason** for every `Needs Attention` trip; it is the only place the user can learn *which*
    fault fired.

---

## 12. Open questions — some only the owner can answer, some nobody can

**For the owner (these change the shipped defaults):**

1. **How many cats?** With two, every cat signal here is "did *a* cat go", and `Cat Overdue` cannot detect
   one of two cats stopping — the exact emergency the brief describes. If there are two, should
   `Cat Overdue` ship enabled at all, or with a much shorter window and a documented caveat?
2. **`overdueHours` = 24?** 24 is the conventional threshold at which a cat not urinating warrants a vet
   call, but an elderly or multi-cat household may want shorter. It is a judgement call, not veterinary
   advice, and the docs should say so.
3. **Default profile: `standard` (10 tiles) or `lean` (6)?** This is the single biggest experiential
   choice and it is a taste question about the owner's Home app, not a technical one.
4. **`Litter Box Power`: keep it off?** Leaving it off means HomeKit cannot power-cycle the box; turning it
   on means a scene, a guest or a misheard Siri phrase can switch a cat's litter box off.
5. **Night light On → AUTO or ON?** Default `auto` preserves today's behaviour. If the household never uses
   AUTO, `on` makes the tile mean what it says.
6. **`drawerAlertPercent` = 90?** Earlier gives more lead time and more nagging.
7. **Are `Cat Visit` and the clinical press vocabulary wanted at all**, or is the tile clutter of a
   stateless button not worth the Shortcuts logging?
8. **Does a LitterHopper exist on the account?** If not, the Hopper service never appears and
   `hopperStatus` handling stays untested.

**Nobody can answer these from the sources available (UNSURE, and flagged wherever they are load-bearing):**

9. **Whether the Apple Home app offers a Notifications toggle for sensor services**, and whether it offers
   anything at all for Filter Maintenance. This is the design's load-bearing unsourced assumption; nothing
   in the ADK, the 1302 crawled pages or `docs/homekit` describes the Home app's notification UI. §7.4
   hedges it with one config-removable tile.
10. Whether a standalone `FilterMaintenance` service renders as its own tile, as a row in a parent's detail
    view, or not at all — `purifier-filter-occupancy-covering.md` open question 7.
11. Whether `isPrimaryService` has any visible effect, and whether a bridge may usefully set it on a
    bridged accessory's service — open question 8.
12. Whether linking Waste Drawer from an Occupancy Sensor (rather than from an Air Purifier) produces any
    grouping — open question 1 plus undocumented presentation.
13. Exact tile wording for contact, occupancy and valve services, and whether a Valve is filed under a
    "Water" grouping.
14. Whether the Home app offers "a valve stopped being in use" as an automation trigger.
15. How the Home app presents a Valve write we accept and then immediately contradict by event — the
    intended springback may render as a stuck or flickering toggle.
16. All Siri phrasing.
17. Whether Eve graphs standard sensor history without Elgato's own history protocol.
18. Device-side: the exact meaning of `ROBOT_EMPTY` vs `ROBOT_FIND_DUMP`, the `hopperStatus` and
    `globeMotorFaultStatus` enumerations, and whether `catDetect` and `robotStatus` can disagree. All must
    be confirmed against a live payload.

---

## Appendix — verification record

Checked in `node_modules/@homebridge/hap-nodejs/dist/lib/` (the library Homebridge 2.4.0 actually runs):

- `definitions/ServiceDefinitions.js` — 73 instantiable services. Required/optional characteristic lists
  confirmed for every service kept: ContactSensor, OccupancySensor, FilterMaintenance, Valve, Lightbulb,
  Switch, StatelessProgrammableSwitch, AccessoryInformation — and for those rejected on structural grounds:
  LockMechanism, MotionSensor, Battery, LeakSensor, ServiceLabel, AirPurifier, Fanv2, HeaterCooler.
- `definitions/CharacteristicDefinitions.js` — format, permissions, unit, min/max/step and validValues
  confirmed for every characteristic in §4. Notable confirmations: `Filter Life Level` is **float**, 0..100,
  step 1, **no unit**; `Reset Filter Indication` is **pw only**, min 1 max 1; `Brightness` is **int** with
  unit percentage; `Status Active` is **bool** while every other status characteristic is uint8;
  `Service Label Index` is `pr` only with min 1; `Valve Type` is 0..3 with GENERIC_VALVE = 0.
- **`Lock Physical Controls` host services: exactly AirPurifier, Fanv2, HeaterCooler,
  HumidifierDehumidifier** (enumerated, settling a three-way disagreement between the source designs).
- **`Configured Name` host services: exactly AccessoryInformation, InputSource, SmartSpeaker, Television,
  WiFiRouter** (enumerated; this is why §2.7 removes it from the other services).
- `Accessory.js:700-712` (category absent from `toHAP`), `:1502` (category only in `serialize`),
  `:1425-1438` (immediate-delivery fast path covers ButtonEvent, ProgrammableSwitchEvent, MotionDetected and
  ContactSensorState).
- `Characteristic.js:1687-1690` (`ProgrammableSwitchEvent` read returns null natively), `:1516-1527`
  (excluded from value correction), `:1659-1668` (`sendEventNotification`).
- `Service.js:486-506` vs `:472-491` (`getCharacteristic` warns for non-listed types; `addCharacteristic`
  does not).
- `util/checkName.js` (the exact name regex; names must start *and* end with a letter or number, so
  single-character names warn).
- `HAPServer.js:53` (`SERVICE_COMMUNICATION_FAILURE = -70402`).

Checked in the HomeKitADK snapshot (`HAP/`):

- `HAPServiceTypes.h:21-29` (Accessory Information mandate; custom-characteristic permission rule),
  `:78-92` (Light Bulb), `:175-187` (Switch), `:306-321` (Contact Sensor), `:453-471` (Occupancy Sensor),
  `:505-532` (Stateless Programmable Switch and its Service Label rules), `:788-810` (Filter Maintenance),
  `:1014-1057` (Valve, including the fluid-flow semantic and the Set Duration / Service Label Index /
  Is Configured conditions), `:1064-1092` (Faucet's structural precondition), `:134-152` (Lock Mechanism).
- `HAPCharacteristicTypes.h:1131-1145` (Contact Sensor State), `:1315-1329` (Occupancy Detected),
  `:1380-1396` (Programmable Switch Event), `:1417-1427` (Status Active), `:1465-1481` (Status Fault),
  `:1558-1572` (Status Tampered), `:2036-2056` (Filter Life Level), `:2088-2110` (Reset Filter Indication),
  `:2681-2697` (Service Label Index), `:2795-2810` (In Use), `:2850-2872` (Remaining Duration and its
  notification rule), `:2899-2911` (Valve Type enum).
- `HAP.h:3173-3179` (at most one primary service), `:3460-3477` (bridged accessories must be
  `BridgedAccessory`), `HAPAccessoryValidation.c:250-275` (linked services must resolve on the same
  accessory), `:790-806` (bridged category rejected otherwise), `:42-56` (serial number byte bounds).
- `HAPAccessoryServer.c:490-553` — the firmware parse/downgrade gate reads `primaryAccessory->firmwareVersion`
  only, corroborated by `docs/homekit/accessory-model.md:226`.
- `HAPRequestHandlers+AccessoryInformation.c:12-31` (Identify rejects `false`).

Checked in `docs/homekit/`: `accessory-model.md` rules 29-32 (categories and bridging), 40-41 (unreachable
downstream devices, `-70402`), 43 (ev), and :226 (bridged firmware never parsed);
`lights-switches.md` rules 16-22 (stateless switch modelling, null read, `validValues [0]`, no Service Label
for one instance) and :263-266 (open questions on validValues honouring and unreachable-device behaviour);
`purifier-filter-occupancy-covering.md` open questions 1, 3, 5, 6, 7, 8.

Checked in `packages/`: `litterrobot/src/{platform,robot,robot-state,whisker-api,settings}.ts`,
`litterrobot/config.schema.json`, `core/src/hap.ts` (`ensureService`, `pruneServices`, `setAccessoryInfo`,
`sanitizeVersion`, `commFailure`), `core/src/platform-base.ts:100-172` (accessory UUID derivation,
registration, category applied only at creation).
