# Air purifier, filter maintenance, occupancy, window covering

This note is the authoritative reference for four HomeKit services a bridge plugin is likely to expose together: `Air Purifier` (with `Current Air Purifier State` / `Target Air Purifier State`), `Filter Maintenance` (`Filter Change Indication`, `Filter Life Level`, `Reset Filter Indication`) and the way a filter service relates to the service it belongs to, `Occupancy Sensor` (`Occupancy Detected` plus the generic sensor status characteristics `Status Active`, `Status Fault`, `Status Tampered`, `Status Low Battery`), and `Window Covering` (`Current Position`, `Target Position`, `Position State`, `Hold Position`, `Obstruction Detected`). It covers the on-the-wire accessory definition (UUIDs, formats, ranges, valid values, permissions, required/optional membership), the behavioural rules an accessory must honour, how the controller-side HomeKit framework presents the same things to an app or to the Home app, and what all of that means for a bridge. Where the two sources disagree, or where neither answers a question, that is called out rather than papered over.

**Sources.** HomeKitADK at commit `fb201f98` (2021-10-23), read directly from `HAP/HAPCharacteristicTypes.h`, `HAP/HAPCharacteristicTypes.c`, `HAP/HAPServiceTypes.h`, `HAP/HAPServiceTypes.c`, `HAP/HAP.h`, `HAP/HAPAccessoryValidation.c`, `HAP/HAPCharacteristic.c`, `HAP/HAPIPAccessory.c` and `HAP/HAPIPAccessoryProtocol.c`; and the Apple developer documentation for the HomeKit framework, crawled 2026-09-12. The ADK header comments cite the HomeKit Accessory Protocol Specification R14 by section; the specification itself is not part of either source, so R14 section numbers below are reproduced as the ADK records them and have not been independently verified.

A note on the permissions column: `pr` = Paired Read, `pw` = Paired Write, `ev` = Notify / event notifications. These are the three permission tokens the ADK emits into the IP attribute database (`HAP/HAPIPAccessoryProtocol.c:738`, `:745`, `:752`); the same serializer can also emit `tw` (timed write), `wr` (write response) and `hd` (hidden), none of which are required by any characteristic in this document.

---

## Air Purifier

Service UUID `0xBB`, Apple-defined short form (`HAP/HAPServiceTypes.c:73`). Debug description `"air-purifier"`; R14 §8.2; requires iOS 10.3 or later per the ADK (`HAP/HAPServiceTypes.h:837`, `:850-856`).

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Req/Opt | Source |
|---|---|---|---|---|---|---|---|---|
| Active | `0xB0` | UInt8 | — | 0 / 1 / 1 | `Inactive = 0`: service not active; `Active = 1`: service active | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.h:2146-2171; HAP/HAPCharacteristicTypes.c:175 |
| Current Air Purifier State | `0xA9` | UInt8 | — | 0 / 2 / 1 | `Inactive = 0`; `Idle = 1`; `PurifyingAir = 2` | pr, ev | Required | HAP/HAPCharacteristicTypes.h:1973-2002; HAP/HAPCharacteristicTypes.c:163 |
| Target Air Purifier State | `0xA8` | UInt8 | — | 0 / 1 / 1 | `Manual = 0`; `Auto = 1` | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.h:1943-1969; HAP/HAPCharacteristicTypes.c:161 |
| Name | `0x23` | String | — | — | — | pr | Optional | HAP/HAPCharacteristicTypes.h:503-517; HAP/HAPCharacteristicTypes.c:49 |
| Rotation Speed | `0x29` | Float | Percentage | 0 / 100 / 1 | — (continuous range) | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:601-618; HAP/HAPCharacteristicTypes.c:59 |
| Swing Mode | `0xB6` | UInt8 | — | 0 / 1 / 1 | `Disabled = 0`; `Enabled = 1` | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:2360-2386; HAP/HAPCharacteristicTypes.c:187 |
| Lock Physical Controls | `0xA7` | UInt8 | — | 0 / 1 / 1 | `Disabled = 0`; `Enabled = 1` | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:1913-1938; HAP/HAPCharacteristicTypes.c:159 |

The required set is exactly `Active`, `Current Air Purifier State`, `Target Air Purifier State`; the optional set is exactly `Name`, `Rotation Speed`, `Swing Mode`, `Lock Physical Controls` (`HAP/HAPServiceTypes.h:839-848`). `Rotation Direction` is **not** offered on Air Purifier — only the Fan service carries it (`HAP/HAPServiceTypes.h:845-848`).

## Filter Maintenance

Service UUID `0xBA` (`HAP/HAPServiceTypes.c:71`). Debug description `"filter-maintenance"`; R14 §8.15; requires iOS 10.3 or later per the ADK (`HAP/HAPServiceTypes.h:798`, `:808-814`).

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Req/Opt | Source |
|---|---|---|---|---|---|---|---|---|
| Filter Change Indication | `0xAC` | UInt8 | — | 0 / 1 / 1 | `Ok = 0`: filter does not need to be changed; `Change = 1`: filter needs to be changed | pr, ev | Required | HAP/HAPCharacteristicTypes.h:2060-2086; HAP/HAPCharacteristicTypes.c:169 |
| Filter Life Level | `0xAB` | Float | none stated | 0 / 100 / 1 | — (continuous range) | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:2038-2056; HAP/HAPCharacteristicTypes.c:167 |
| Reset Filter Indication | `0xAD` | UInt8 | — | 1 / 1 / none stated | only the value `1` is in range | pw | Optional | HAP/HAPCharacteristicTypes.h:2090-2110; HAP/HAPCharacteristicTypes.c:171 |
| Name | `0x23` | String | — | — | — | pr | Optional | HAP/HAPCharacteristicTypes.h:503-517 |

Two gaps worth stating explicitly rather than guessing at:

- **`Filter Life Level` carries no unit in the ADK.** Its doc block lists Format, Permissions, Minimum, Maximum and Step, and no `Unit:` line (`HAP/HAPCharacteristicTypes.h:2043-2049`) — unlike `Current Position`, `Target Position` and `Rotation Speed`, which all explicitly say `Unit: Percentage`. Apple's page describes the value as "the percentage of remaining life" (`/documentation/homekit/hmcharacteristictypefilterlifelevel`), so the quantity is a percentage semantically, but the ADK does not instruct the accessory to advertise a percentage unit for it.
- **`Reset Filter Indication` has no step value.** The doc block gives Minimum 1 and Maximum 1 and stops (`HAP/HAPCharacteristicTypes.h:2101-2104`). With a min and max that coincide, `1` is the only writable value.

## Occupancy Sensor

Service UUID `0x86` (`HAP/HAPServiceTypes.c:45`). Debug description `"sensor.occupancy"`; R14 §8.29; requires iOS 9 or later (`HAP/HAPServiceTypes.h:456`, `:472-476`).

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Req/Opt | Source |
|---|---|---|---|---|---|---|---|---|
| Occupancy Detected | `0x71` | UInt8 | — | 0 / 1 / 1 | `NotDetected = 0`: occupancy is not detected; `Detected = 1`: occupancy is detected | pr, ev | Required | HAP/HAPCharacteristicTypes.h:1315-1342; HAP/HAPCharacteristicTypes.c:115 |
| Status Active | `0x75` | Bool | — | — | `true` = accessory active and functioning without errors | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1416-1432; HAP/HAPCharacteristicTypes.c:121 |
| Status Fault | `0x77` | UInt8 | — | 0 / 1 / 1 | `None = 0`: no fault; `General = 1`: general fault | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1466-1493; HAP/HAPCharacteristicTypes.c:125 |
| Status Tampered | `0x7A` | UInt8 | — | 0 / 1 / 1 | `NotTampered = 0`; `Tampered = 1` | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1558-1584; HAP/HAPCharacteristicTypes.c:131 |
| Status Low Battery | `0x79` | UInt8 | — | 0 / 1 / 1 | `Normal = 0`: battery level normal; `Low = 1`: battery level low | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1528-1554; HAP/HAPCharacteristicTypes.c:129 |
| Name | `0x23` | String | — | — | — | pr | Optional | HAP/HAPCharacteristicTypes.h:503-517 |

Note the format asymmetry, which is easy to get wrong: `Occupancy Detected`, `Status Fault`, `Status Tampered` and `Status Low Battery` are **UInt8** with an enum, while `Status Active` is a plain **Bool**. The four status characteristics are not specific to occupancy — they are the generic sensor-status set, and the same definitions are reused across the ADK's sensor services.

## Window Covering

Service UUID `0x8C` (`HAP/HAPServiceTypes.c:55`). Debug description `"window-covering"`; R14 §8.45; requires iOS 9 or later. Described as "motorized window coverings or shades - examples include shutters, blinds, awnings etc." (`HAP/HAPServiceTypes.h:594-596`, `:614-618`).

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Req/Opt | Source |
|---|---|---|---|---|---|---|---|---|
| Target Position | `0x7C` | UInt8 | Percentage | 0 / 100 / 1 | — (continuous range) | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.h:1612-1634; HAP/HAPCharacteristicTypes.c:135 |
| Current Position | `0x6D` | UInt8 | Percentage | 0 / 100 / 1 | — (continuous range) | pr, ev | Required | HAP/HAPCharacteristicTypes.h:1210-1232; HAP/HAPCharacteristicTypes.c:107 |
| Position State | `0x72` | UInt8 | — | 0 / 2 / 1 | `GoingToMinimum = 0`; `GoingToMaximum = 1`; `Stopped = 2` | pr, ev | Required | HAP/HAPCharacteristicTypes.h:1346-1376; HAP/HAPCharacteristicTypes.c:117 |
| Hold Position | `0x6F` | Bool | — | — | write `1` to hold; write of `0` should be ignored | pw | Optional | HAP/HAPCharacteristicTypes.h:1262-1281; HAP/HAPCharacteristicTypes.c:111 |
| Obstruction Detected | `0x24` | Bool | — | — | `true` = obstruction detected | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:520-534; HAP/HAPCharacteristicTypes.c:51 |
| Current Horizontal Tilt Angle | `0x6C` | Int | Arcdegrees | −90 / 90 / 1 | — | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1184; HAP/HAPCharacteristicTypes.c:105; HAP/HAPServiceTypes.h:606 |
| Target Horizontal Tilt Angle | `0x7B` | Int | Arcdegrees | −90 / 90 / 1 | — | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:1588-1600; HAP/HAPCharacteristicTypes.c:133; HAP/HAPServiceTypes.h:607 |
| Current Vertical Tilt Angle | `0x6E` | Int | Arcdegrees | −90 / 90 / 1 | — | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1236-1257; HAP/HAPCharacteristicTypes.c:109 |
| Target Vertical Tilt Angle | `0x7D` | Int | Arcdegrees | −90 / 90 / 1 | — | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:1638-1660; HAP/HAPCharacteristicTypes.c:137 |
| Name | `0x23` | String | — | — | — | pr | Optional | HAP/HAPCharacteristicTypes.h:503-517 |

The tilt characteristics are members of the service but outside the behavioural scope of this note; they are listed with their UUIDs for completeness, and their detailed semantics have not been written up here. The ADK lists the required triple in the order Target, Current, Position State (`HAP/HAPServiceTypes.h:598-601`) — an ordering quirk of the header, not a wire requirement.

---

## Semantics and rules

### Air purifier

- `Active` is what carries power. Neither air-purifier state enum has an "off" member: `Target Air Purifier State` is only `Manual = 0` / `Auto = 1` (HAP/HAPCharacteristicTypes.h:1963-1969), and Apple's framework enum likewise has only `.manual` and `.automatic` (/documentation/homekit/hmcharacteristicvaluetargetairpurifierstate). Power and mode are orthogonal and must be modelled on separate characteristics.
- `Current Air Purifier State` distinguishes three conditions where the target has two: the unit is off (`Inactive = 0`), powered but not currently purifying (`Idle = 1`), or actively purifying (`PurifyingAir = 2`) (HAP/HAPCharacteristicTypes.h:1993-2002). `Idle` is the state that makes `Auto` meaningful — an auto-mode purifier that has decided the air is clean is `Active = 1` and `Idle = 1` simultaneously.
- `Target Air Purifier State` describes the *mode of operation*, not a requested current state. `Auto` means the accessory decides when to purify; `Manual` means the user does (HAP/HAPCharacteristicTypes.h:1963-1968).
- An air purifier accessory may carry linked `Filter Maintenance` service(s) — one per air filter — plus `Air Quality Sensor` services, a `Fan` service, and a `Slat` service (HAP/HAPServiceTypes.h:820-824).
- If a `Fan` is linked, the `Active` characteristics are coupled asymmetrically: changing `Active` on the Air Purifier **must** produce a corresponding change to `Active` on the Fan; changing the Fan from Inactive to Active does **not** require the Air Purifier to become Active (this is what enables a "Fan Only" mode); but changing the Fan from Active to Inactive **must** drive the Air Purifier to Inactive (HAP/HAPServiceTypes.h:826-833).
- Fan speed lives in exactly one place. An air purifier service "may include `Rotation Speed` to control fan speed if the fan cannot be independently controlled" (HAP/HAPServiceTypes.h:834-835) — so put `Rotation Speed` on the Air Purifier *or* expose a separate linked `Fan`, not both.

### Filter maintenance and its relationship to a primary service

- `Filter Change Indication` is the only required characteristic of the service; a Filter Maintenance service exposing nothing else is well-formed (HAP/HAPServiceTypes.h:800-806). It is binary: `Ok = 0` / `Change = 1` (HAP/HAPCharacteristicTypes.h:2080-2086). There is no threshold or percentage in this characteristic; a percentage belongs to `Filter Life Level`.
- `Filter Life Level` is life **remaining**, not life consumed: Apple defines the value as "the percentage of remaining life" (/documentation/homekit/hmcharacteristictypefilterlifelevel). 100 is a fresh filter, 0 an exhausted one.
- `Reset Filter Indication` is a write-triggered command, not state. "When the value of 1 is written to this characteristic by the user, the accessory should reset it to 0 once the relevant action to reset the filter indication is executed. If the accessory supports Filter Change Indication, the value of that characteristic should also reset back to 0." (HAP/HAPCharacteristicTypes.h:2092-2096). It is Paired Write only — it has no read semantics, and Apple's framework rejects reads of it with `HMError.Code.writeOnlyCharacteristic` (/documentation/homekit/hmerror/code).
- **On "must be linked to a primary service": neither source states such a requirement.** The ADK's Air Purifier definition says an air purifier accessory *can have* additional linked services "such as" Filter Maintenance service(s) (HAP/HAPServiceTypes.h:820-821) — permissive, not mandatory — and the Filter Maintenance definition itself imposes no linkage rule at all (HAP/HAPServiceTypes.h:794-814). The ADK does impose mandatory linkage on other services (a Faucet "must only be included when" it links a Heater Cooler and/or Valves, HAP/HAPServiceTypes.h:1067-1074; multiple Stateless Programmable Switch instances "must be linked to a `Service Label` service", HAP/HAPServiceTypes.h:512), which shows the header states such requirements explicitly when they exist. It states none for Filter Maintenance. What *is* mandatory is the mechanics of linking, below.
- Linking mechanics, which a bridge must get right if it links at all: `linkedServices` is a 0-terminated array of `uint16_t` service instance IDs (HAP/HAP.h:3288-3294). Links are **not transitive** — A→B and B→C does not imply A→C — and a service may **not** link to itself (HAP/HAP.h:3289-3291). Every entry must equal the `iid` of a service on the **same accessory**, or validation fails with "linkedServices entry ... does not correspond to a specified service." (HAP/HAPAccessoryValidation.c:255-272), so cross-accessory linking is invalid — which matters for a bridge, where each bridged device is its own accessory. An entry must not be repeated (HAP/HAPAccessoryValidation.c:239-253). If linked services are used, a Service Signature characteristic must be attached to the service — necessary for BLE, harmless for IP (HAP/HAP.h:3292-3294).
- Over IP the link is published in the service object as a `"linked"` key, always emitted as a JSON array and empty when there are no links (HAP/HAPIPAccessory.c:623-657). Link direction is whatever the accessory declares; the ADK's own Lock sample declares the link in **both** directions between Lock Mechanism and Lock Management, which is permitted but not required by any validation rule.
- Exactly one service on an accessory may be marked primary (HAP/HAP.h:3175-3179), and it is published as the `"primary"` key (HAP/HAPIPAccessory.c:579-591).

### Occupancy and the status characteristics

- `Occupancy Detected` is latching in the obvious direction only: "A value of 1 indicates occupancy is detected. Value should return to 0 when occupancy is not detected." (HAP/HAPCharacteristicTypes.h:1317-1319). The accessory is responsible for clearing it; there is no timeout defined anywhere in either source.
- There is no "unknown" occupancy state. The characteristic ranges 0..1 (HAP/HAPCharacteristicTypes.h:1325-1327) and Apple's enum has exactly `.notOccupied` and `.occupied` (/documentation/homekit/hmcharacteristicvalueoccupancystatus). An accessory that has lost contact with its sensor still has to report one of the two — see `Status Active` and `Status Fault` for the honest way to express that.
- `Status Active` is the "is this sensor working" flag: "A value of true indicates that the accessory is active and is functioning without any errors." (HAP/HAPCharacteristicTypes.h:1418-1420).
- `Status Fault` is coarse by design: 0 is no fault, and any non-zero value "indicates that the accessory has experienced a fault that may be interfering with its intended functionality" (HAP/HAPCharacteristicTypes.h:1468-1471). The enum defines only `General = 1`, and Apple's enum likewise offers only `.noFault` and `.generalFault` (/documentation/homekit/hmcharacteristicvaluestatusfault) — there is no vocabulary for *which* fault.
- `Status Tampered` and `Status Low Battery` both "should return to 0" when the condition clears — tamper when "the accessory has been reset to a non-tampered state" (HAP/HAPCharacteristicTypes.h:1560-1563), battery when it "charges to a level thats above the low threshold" (HAP/HAPCharacteristicTypes.h:1530-1533). Neither source defines what that low threshold is.

### Window covering

- Position is a percentage where **0 is closed and 100 is open**, defined in terms of light: 0 "indicates a position that permits the least light and a value of 100 indicates a position that allows most light" (HAP/HAPCharacteristicTypes.h:1215-1217). Apple states it the same way for both the current and the target characteristic (/documentation/homekit/hmcharacteristictypecurrentposition, /documentation/homekit/hmcharacteristictypetargetposition).
- `Position State` is defined against the **position value**, not against the physical notion of opening: `GoingToMinimum = 0` is "Going to the minimum value specified in metadata" and `GoingToMaximum = 1` is going to the maximum (HAP/HAPCharacteristicTypes.h:1367-1375). Apple names the same two cases `.closing` ("The position is moving towards minimum value") and `.opening` ("The position is moving towards maximum value") (/documentation/homekit/hmcharacteristicvaluepositionstate). So a covering whose position is decreasing reports 0 regardless of what the device's own vocabulary calls that direction.
- `Stopped = 2` means "The accessory isn't moving" (/documentation/homekit/hmcharacteristicvaluepositionstate/stopped). The ADK adds that Position State exists "for presentation purposes" (HAP/HAPCharacteristicTypes.h:1348-1350) — it drives what the controller displays, it is not a control input.
- `Hold Position` is a momentary command: "A value of 1 must hold the state of the accessory. For e.g, the window must stop moving when this characteristic is written a value of 1. A value of 0 should be ignored." (HAP/HAPCharacteristicTypes.h:1264-1267). Crucially, "A write to `Target Position` characteristic will release the hold." (HAP/HAPCharacteristicTypes.h:1269) — Apple repeats this (/documentation/homekit/hmcharacteristictypeholdposition). The hold is therefore not a persistent mode to be tracked; it ends on the next target write.
- Target and current diverge in time and that is expected — Apple's parallel wording for doors is that they "take time to move between states, so the target door state may not match the current door state at a given moment in time" (/documentation/homekit/hmcharacteristictypetargetdoorstate).
- `Obstruction Detected` is a plain Bool, true when an obstruction is present (HAP/HAPCharacteristicTypes.h:522-525).

### Rules that cut across all four services

- **Value constraints are enforced before the accessory sees a write.** The HAP layer validates min/max/step, valid values and maxLength and only then invokes the write handler — "The value is already checked against the constraints of the characteristic" (HAP/HAP.h:759-768). A UInt8 value outside min/max/step is rejected (HAP/HAPCharacteristic.c:413-431), and for Apple-defined characteristics that declare `validValues` or `validValuesRanges`, a value outside the declared set is rejected with "Value not supported" (HAP/HAPCharacteristic.c:432-451).
- **Valid values only restrict Apple-defined characteristics.** The ADK asserts that a non-Apple-defined (vendor) characteristic declares no valid values at all (HAP/HAPCharacteristic.c:452-455). Restricting an enum is done through `constraints.validValues` / `validValuesRanges`, not by narrowing min/max.
- **Reads are asserted to satisfy the same constraints.** After a read handler returns, the ADK asserts the value fulfils the constraints (HAP/HAPCharacteristic.c:494-497). A handler that returns an out-of-range value is a programming error, not a tolerated condition.
- **Float values are rounded to the step** on both read and write paths (HAP/HAPCharacteristic.c:1336, `:1363-1364`) — relevant to `Rotation Speed` and `Filter Life Level`, the two Float characteristics here.
- **Events are the accessory's responsibility to raise.** Marking a characteristic `supportsEventNotification` is not enough; "When the characteristic state changes, the HAPAccessoryServerRaiseEvent or HAPAccessoryServerRaiseEventOnSession function must be called." (HAP/HAP.h:326-328). A characteristic marked `supportsEventNotification` must also have a read handler (HAP/HAPAccessoryValidation.c:345-354). Apple's reference handlers raise an event only when the value actually changed, avoiding redundant notifications.
- **Write-only characteristics must be declared as such.** `Hold Position` and `Reset Filter Indication` are Paired Write only. Reading a write-only characteristic over IP yields status `-70405` (`ReadFromWriteOnlyCharacteristic`, HAP/HAPIPAccessoryServer.c:47, `:1795`), and the controller-side framework surfaces the same thing as `HMError.Code.writeOnlyCharacteristic` (/documentation/homekit/hmerror/code).
- **Validation couples permissions to callbacks.** Readable requires a read handler, writable requires a write handler (HAP/HAPAccessoryValidation.c:323-343); `requiresTimedWrite` and `supportsWriteResponse` both require writable (HAP/HAPAccessoryValidation.c:392-420).
- **One primary service, and hidden services must be fully hidden.** Only one service may be marked primary, and if all characteristics in a service are hidden the service must be marked hidden too (HAP/HAP.h:3277-3278).

---

## HomeKit framework / Home app view

**Availability.** The controller-side constants split cleanly into two generations:

| Symbol | Apple availability | ADK's stated floor |
|---|---|---|
| `HMServiceTypeOccupancySensor`, `HMCharacteristicTypeOccupancyDetected` | iOS 9.0, tvOS 10.0, watchOS 2.0, visionOS 1.0 | iOS 9 |
| `HMServiceTypeWindowCovering`, `HMCharacteristicTypeCurrentPosition` / `TargetPosition` / `PositionState` / `HoldPosition` | iOS 9.0, tvOS 10.0, watchOS 2.0, visionOS 1.0 | iOS 9 |
| `HMCharacteristicTypeObstructionDetected` | iOS 8.0, tvOS 10.0, watchOS 2.0 | iOS 9 (as a Window Covering member) |
| `HMCharacteristicTypeStatusActive` / `StatusFault` / `StatusTampered` / `StatusLowBattery` | iOS 9.0, tvOS 10.0, watchOS 2.0 | iOS 9 |
| `HMServiceTypeAirPurifier`, `HMServiceTypeFilterMaintenance`, and the current/target purifier and all three filter characteristics | **iOS 10.2**, tvOS 10.1, watchOS 3.1.1, visionOS 1.0 | **iOS 10.3** |

**Discrepancy, noted per the rule that the primary source wins on facts it actually states.** The ADK says the Air Purifier and Filter Maintenance services and their characteristics "require iOS 10.3 or later" (HAP/HAPServiceTypes.h:798, `:837`; HAP/HAPCharacteristicTypes.h:1950, `:1979`, `:2044`); Apple's own pages give iOS 10.2 / tvOS 10.1 / watchOS 3.1.1 for every one of those symbols (/documentation/homekit/hmservicetypeairpurifier, /documentation/homekit/hmservicetypefiltermaintenance, /documentation/homekit/hmcharacteristictypecurrentairpurifierstate, /documentation/homekit/hmcharacteristictypefilterlifelevel). These are statements about two different things — the ADK is asserting a HAP-side floor, Apple is publishing the framework symbol's introduction — so they are not strictly contradictory, but a bridge should treat **iOS 10.3** as the safe floor, since that is what the accessory-side source specifies. The readers' ADK-derived notes agree with the header on 10.3 and the Apple-derived notes agree with Apple on 10.2; both are faithful to their source.

**Enum value mapping.** Apple publishes case *names* and their order, never raw values. The framework enums are Int-backed with failable initializers (`init?(rawValue: Int)`), so an out-of-range integer from an accessory yields `nil` in an app rather than a crash. The names line up positionally with the ADK's numeric values:

| ADK value | Apple case | Note |
|---|---|---|
| `CurrentAirPurifierState`: `Inactive = 0`, `Idle = 1`, `PurifyingAir = 2` | `.inactive`, `.idle`, `.active` | **Name mismatch at value 2**: the ADK calls it `PurifyingAir`, Apple calls it `.active` ("The air purifier is active"). Same ordinal position, same meaning. |
| `TargetAirPurifierState`: `Manual = 0`, `Auto = 1` | `.manual`, `.automatic` | |
| `FilterChangeIndication`: `Ok = 0`, `Change = 1` | `.notNeeded`, `.needed` (`HMCharacteristicValueFilterChange`) | |
| `OccupancyDetected`: `NotDetected = 0`, `Detected = 1` | `.notOccupied`, `.occupied` (`HMCharacteristicValueOccupancyStatus`) | Apple frames occupancy as whole-home presence: "The home is occupied." |
| `PositionState`: `GoingToMinimum = 0`, `GoingToMaximum = 1`, `Stopped = 2` | `.closing`, `.opening`, `.stopped` | |
| `StatusFault`: `None = 0`, `General = 1` | `.noFault`, `.generalFault` | |
| `StatusTampered`: `NotTampered = 0`, `Tampered = 1` | `.none`, `.tampered` (`HMCharacteristicValueTamperedStatus`) | `.none` is a real case, not `Optional.none`. |
| `StatusLowBattery`: `Normal = 0`, `Low = 1` | `.normal`, `.low` (`HMCharacteristicValueBatteryStatus`) | Apple's enum is named for battery status, not for the characteristic. |

The positional correspondence is inference, not sourced text — Apple does not publish raw values anywhere in the crawled pages. **INFERRED**, though with high confidence given the ADK is Apple's own accessory-side implementation of the same protocol.

**Typing differences the framework exposes.** Apple documents `OccupancyDetected` as an enum-valued characteristic while `MotionDetected` is a plain Boolean (/documentation/homekit/hmcharacteristictypemotiondetected) — matching the ADK, where occupancy is UInt8 and several neighbouring sensor characteristics are Bool. Apple also documents `FilterResetChangeIndication` and `HoldPosition` as "write-only Boolean" values, whereas the ADK types the former as UInt8 with range 1..1 and the latter as Bool. For `Reset Filter Indication` the wire format is the primary source's: **UInt8**, not Bool.

**Naming.** Apple's constant for the filter reset is `HMCharacteristicTypeFilterResetChangeIndication`; the ADK's is `ResetFilterIndication`. Same characteristic (`0xAD`), differently ordered words.

**HMCharacteristicMetadata expectations.** An app reads presentation constraints from `HMCharacteristic.metadata`, an `HMCharacteristicMetadata` whose purpose is explicitly to let an app "build a user interface that reflects the underlying units, minima, and maxima" (/documentation/homekit/hmcharacteristicmetadata). The properties that matter here are `format`, `units`, `minimumValue`, `maximumValue`, `stepValue` and `validValues`. Three things follow:

- `minimumValue`, `maximumValue` and `stepValue` "only apply to characteristics with a number type" (/documentation/homekit/hmcharacteristicmetadata/minimumvalue) — so they are meaningless on `Status Active`, `Hold Position` and `Obstruction Detected`, all Bool.
- `validValues` is "the subset of valid values supported by the characteristic when the format is of type unsigned integer" and is iOS 10.0+ (/documentation/homekit/hmcharacteristicmetadata/validvalues). This is the controller-side view of the ADK's `constraints.validValues`, and it only exists for unsigned-integer formats — which is exactly the set of enum characteristics in this document.
- `units` maps to `HMCharacteristicMetadataUnitsPercentage` for the position and rotation-speed characteristics (/documentation/homekit/hmcharacteristicmetadataunitspercentage). Because the ADK declares no unit for `Filter Life Level`, an app reading its metadata should not assume a percentage unit is present even though the value is semantically a percentage.

**Controller-enforced restrictions.** The framework rejects, before anything reaches the network: writes to a characteristic lacking write permission (`HMError.Code.readOnlyCharacteristic`), reads of a write-only characteristic (`HMError.Code.writeOnlyCharacteristic`), and notification registration on a characteristic that does not advertise event support (`HMError.Code.notificationNotSupported`) (/documentation/homekit/hmerror/code). Automation events (`HMMutableCharacteristicEvent`, `HMMutableCharacteristicThresholdRangeEvent`) both require that "The characteristic must support notification" — so any characteristic a user might plausibly automate on must carry `ev`.

**Service presentation.** `HMService.linkedServices` is iOS 10.0+ (/documentation/homekit/hmservice/linkedservices), so links an accessory declares are invisible to controllers older than iOS 10 — including a Filter Maintenance service linked to an Air Purifier. `isPrimaryService` is likewise iOS 10.0+. `isUserInteractive` (iOS 9.0+) tells an app whether a service is meant to be shown as a control at all. Apple's framing of a service is worth keeping in mind when deciding how many services to expose: a single accessory may have several user-controllable services, and "These services are what Apple's Home app labels as 'accessories'" (/documentation/homekit/hmservice).

**Taxonomy.** Apple groups `HMServiceTypeAirPurifier` under "Air Quality and Smoke Detection" (with the air-quality, CO, CO₂ and smoke sensors), `HMServiceTypeFilterMaintenance` under "Temperature and Humidity" (with HeaterCooler, Fan, Thermostat and the humidity services), `HMServiceTypeOccupancySensor` under "Safety and Security" (with MotionSensor, ContactSensor and SecuritySystem), and `HMServiceTypeWindowCovering` under "Windows" (with `HMServiceTypeWindow` and `HMServiceTypeSlats`). Accessory categories: Air Purifiers = 19, Window Coverings = 14, Sensors = 10 (HAP/HAP.h:3380, `:3399`).

**Deprecations.** None. No service type, characteristic type or value enum in scope is marked deprecated in the crawled Apple pages — checked across every topic page and confirmed for the full `HMServiceType*` range from Microphone through WindowCovering. The only deprecation encountered anywhere nearby is `HMService.init()`, which is irrelevant to a bridge (apps never construct services).

---

## Implications for a bridge plugin

**Advertising the right characteristics**

- Advertise exactly the required set, plus only those optional characteristics the device can actually back. Required: Air Purifier → `Active`, `Current Air Purifier State`, `Target Air Purifier State`; Filter Maintenance → `Filter Change Indication`; Occupancy Sensor → `Occupancy Detected`; Window Covering → `Target Position`, `Current Position`, `Position State`.
- Do **not** advertise `Swing Mode` on an air purifier with no oscillating element, and do not advertise `Hold Position` unless the device really can stop mid-travel — `Hold Position` is optional precisely so that a covering without a stop command need not pretend (HAP/HAPServiceTypes.h:605).
- If the device exposes a filter percentage but no discrete "needs changing" signal, you still must publish `Filter Change Indication`, because it is the service's only required characteristic. Derive it from the percentage and pick a threshold; neither source defines one, so the threshold is yours to choose and document. **INFERRED.**
- Declare `ev` on every state characteristic that can change without a controller write — `Occupancy Detected`, `Current Position`, `Position State`, `Filter Change Indication`, `Filter Life Level`, `Current Air Purifier State`, and `Active` when the device has physical controls. Without `ev` the Home app cannot subscribe and automations on that characteristic cannot be created at all.
- Declare `pw` on everything the Home app is expected to set: `Target Position`, `Target Air Purifier State`, `Active`, `Rotation Speed`, and the two write-only commands.

**Target-state valid values to advertise**

- For `Target Air Purifier State`, advertise `validValues` containing only the modes the device supports. A purifier with no automatic mode should advertise `{ Manual }` alone rather than the full 0..1 range — the HAP layer will then reject a write of `Auto` with InvalidData before it ever reaches your handler (HAP/HAPCharacteristic.c:432-451), which is far better than accepting a mode you cannot honour and silently doing something else.
- Restrict enums through `validValues` / `validValuesRanges`, never by narrowing `minValue`/`maxValue` — the valid-values mechanism is the only one the wire format honours for this purpose, and it only works on Apple-defined characteristic types.
- Do not restrict `Current Air Purifier State`. It is read-only, so valid values buy nothing, and an over-narrow declaration risks tripping the ADK's read-side constraint assertion if the device ever reports the excluded state.
- `Position State`'s three values should all be advertised even if the bridge can only ever report `Stopped`, since the characteristic is presentational and narrowing it gains nothing. **INFERRED.**

**Representing N discrete speeds on a 0-100 percentage**

`Rotation Speed` is a Float 0..100 with step 1 and a percentage unit, and the ADK rounds float values to the step on both read and write (HAP/HAPCharacteristic.c:1336, `:1363-1364`). Neither source describes how to map N discrete device speeds onto that range, so the following is **INFERRED**:

- Publish `minStep = 100 / N` so the Home app's slider detents land on real device speeds, and map percentage `p` to speed index `round(p / (100 / N))`. With three speeds that is a step of 33.33 and detents near 0, 33, 67, 100.
- Treat 0 as "off" only if the device treats its lowest speed that way; otherwise leave power to `Active` and let 0 be the lowest non-zero speed's neighbour. Because `Active` already carries power for an air purifier, prefer **not** to overload speed 0 with power semantics.
- When the device reports a discrete speed, publish the *centre* of that speed's percentage band rather than a band edge, so a read-back does not shift the slider to an adjacent detent.
- Put speed on either the Air Purifier's `Rotation Speed` or a linked `Fan`, never both — the ADK's "if the fan cannot be independently controlled" wording makes these alternatives, not complements.

**Linking a Filter Maintenance service**

- Since no source requires linking, a bridge may expose Filter Maintenance as a standalone service. Linking it to the Air Purifier is nonetheless the documented pattern and is what makes the Home app associate the filter with the purifier rather than presenting an unexplained second tile. **INFERRED** as a presentation benefit; the linkage itself is sourced, the Home-app consequence is not.
- If you link, both services must live on the **same accessory object**. In a bridge this means the purifier and its filter service belong to one bridged accessory; linking across bridged accessories fails validation outright.
- Use the linked service's `iid`, keep entries unique, never link a service to itself, and remember links are not transitive — if you want Air Purifier → Filter Maintenance and Air Purifier → Air Quality Sensor, declare both explicitly.
- Attach a Service Signature characteristic to any service that declares links, so the accessory remains correct if it is ever exposed over BLE.
- One filter service per physical filter; the ADK explicitly contemplates "one or more air filters" (HAP/HAPServiceTypes.h:821). Give each a distinct `Name`.

**Coupled state a bridge must maintain**

- If you expose a linked `Fan` alongside the Air Purifier, implement the asymmetric `Active` coupling exactly as specified: purifier off ⇒ fan off; fan off ⇒ purifier off; fan on ⇏ purifier on. Getting the third rule wrong is what breaks "Fan Only" mode.
- On a successful `Reset Filter Indication` write, reset `Filter Change Indication` to 0 **and** raise an event for it — the reset characteristic itself is write-only and cannot notify, so the change is invisible to the controller unless you raise the event on the indication characteristic.
- On a `Target Position` write, release any hold you are tracking, because the specification says the write releases it. Do not model hold as sticky state.
- Drive `Position State` from the relationship between current and target position (decreasing ⇒ 0, increasing ⇒ 1), not from device vocabulary. Return it to `Stopped` when motion ends; if the bridge cannot observe motion at all, report `Stopped` whenever idle rather than leaving it in a transitional value. **INFERRED** for the unobservable case.
- Raise events only on actual change, following Apple's reference handlers — an unchanged write should not notify.

**When the device is unreachable**

Neither source specifies bridge behaviour for an unreachable backing device; the following is **INFERRED**:

- Prefer `Status Active = false` (and, where the device genuinely has a fault rather than merely being unreachable, `Status Fault = General`) over inventing a sentinel value. This is the only honest signal available, since `Occupancy Detected` has no unknown state.
- Continue reporting the last known value for characteristics that have no status companion, rather than returning an error for every read — a HAP read that fails takes the whole accessory's tile into an error state in the controller.
- Never return a value outside the declared constraints while unreachable. The ADK asserts read values satisfy constraints, so a "magic" out-of-range value is a crash, not a signal.
- Do not raise events you cannot substantiate. If you do not know the current position, do not publish a fabricated one to satisfy `Position State`.
- `Status Active`, `Status Fault`, `Status Tampered` and `Status Low Battery` are optional on Occupancy Sensor but are the only vocabulary HomeKit gives for degraded operation — expose at least `Status Active` on any sensor whose backing device can go offline.

**Things not to do**

- Do not express purifier power through `Target Air Purifier State`; it has no off case.
- Do not treat `Filter Life Level` as consumed life — 0 means exhausted, not fresh.
- Do not publish fractional positions. `Current Position` and `Target Position` are UInt8 with step 1; Apple describes them as integer percentages.
- Do not assume 0 means "open" for a covering. 0 is closed / least light.
- Do not expose an `Occupancy Sensor` as a linked service of an Air Purifier expecting the controller to relate them — the ADK's Air Purifier definition sanctions only Filter Maintenance, Air Quality Sensor, Fan and Slat as linked services.
- Do not mark more than one service primary, and do not leave a service unmarked-hidden when all its characteristics are hidden.

---

## Open questions

Things neither source answers, listed so they are not silently assumed:

1. **Is a Filter Maintenance service required to be linked to a primary service?** The ADK says an air purifier *can have* linked filter services and states no requirement in either direction; the Apple pages say nothing about linkage for this service. The framing in the task's scope is not supported by either source read here. R14 §8.15 itself might state a requirement the ADK header does not paraphrase.
2. **The raw integer values behind Apple's framework enums.** Apple publishes case names and order only. The mapping to the ADK's numeric values is inferred from position.
3. **What unit, if any, `Filter Life Level` should advertise.** The ADK declares none; Apple calls the value a percentage. Whether an accessory should set `Unit: Percentage` on it is unresolved.
4. **The low-battery threshold** for `Status Low Battery`, and the tamper-clear condition beyond "reset to a non-tampered state".
5. **Any occupancy hold-off or debounce period.** Neither source defines how long `Occupancy Detected` should remain 1 after presence ends; it is left entirely to the accessory.
6. **A threshold relating `Filter Life Level` to `Filter Change Indication`.** The two are independent characteristics with no defined relationship.
7. **How the Home app actually renders these services** — tile layout, which characteristic becomes the primary control, whether a linked Filter Maintenance service appears inside the purifier's detail view. Apple's documentation describes the framework, not the Home app's presentation, and explicitly declines to replicate Home app behaviour in its sample.
8. **Whether a bridge may mark a bridged accessory's service primary** and how that interacts with the bridge accessory's own primary service.
9. **Reconciling the iOS 10.2 vs 10.3 floor** for the air-purifier/filter generation — whether the ADK's 10.3 reflects a later HAP requirement or is simply imprecise.
