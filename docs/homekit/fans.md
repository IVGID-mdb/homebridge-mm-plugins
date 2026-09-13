# Fans

This reference covers how HomeKit models fans: the `Fan` service (Apple-defined short UUID `0xB7`, debug description `"fanv2"`), the `Active`, `RotationSpeed`, `RotationDirection`, `SwingMode`, `CurrentFanState`, `TargetFanState` and `LockPhysicalControls` characteristics it may carry, the `On` characteristic used by the legacy fan generation, the meaning of every defined value, how fan speed is expressed (a 0–100 float percentage, never a step index), and what the "Fan v2" naming actually deprecates in Apple's reference implementation. It also covers the fan characteristics that appear on neighbouring services (`Air Purifier`, `Heater Cooler`, `Humidifier Dehumidifier`, `Slat`), because those services carry `Rotation Speed`, `Swing Mode` and `Lock Physical Controls` under their own rules.

**Sources:** HomeKitADK commit `fb201f98` (2021-10-23), whose headers are normative against *HomeKit Accessory Protocol Specification R14*; Apple developer documentation crawled 2026-09-12. Where the two disagree, or where a fact appears in only one, the text says so.

---

## Service: Fan — `0xB7`, debug description `"fanv2"`

"This service describes a fan." (HAP/HAPServiceTypes.h:728). Requires iOS 10.3 or later (HAP/HAPServiceTypes.h:733). Spec location: R14 Section 8.13 Fan (HAP/HAPServiceTypes.h:747-748). Service type constant `kHAPServiceType_Fan = HAPUUIDCreateAppleDefined(0xB7)` (HAP/HAPServiceTypes.c:65).

Short UUIDs below are the Apple-defined short form; the full UUID has the shape `XXXXXXXX-0000-1000-8000-0026BB765291` (HAP/HAPUUID.h:21-24).

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values (name = value: meaning) | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| Active | `0xB0` | UInt8 | none declared | 0 / 1 / 1 | `Inactive` = 0: service not currently active; `Active` = 1: service currently active | pr, pw, ev | **Required** | HAP/HAPCharacteristicTypes.h:2145-2172; HAP/HAPCharacteristicTypes.c:175 |
| Name | `0x23` | String | n/a | n/a (max length not stated in the header) | n/a — "describes a name and must not be a null value" | pr | Optional | HAP/HAPCharacteristicTypes.h:502-514; HAP/HAPCharacteristicTypes.c:49 |
| Current Fan State | `0xAF` | UInt8 | none declared | 0 / 2 / 1 | `Inactive` = 0: inactive; `Idle` = 1: idle; `BlowingAir` = 2: blowing air | pr, ev (**no** pw) | Optional; **required** when the Fan service is included in an air purifier accessory | HAP/HAPCharacteristicTypes.h:2113-2143; HAP/HAPCharacteristicTypes.c:173; HAP/HAPServiceTypes.h:730-731 |
| Target Fan State | `0xBF` | UInt8 | none declared | 0 / 1 / 1 | `Manual` = 0: manual; `Auto` = 1: auto | pr, pw, ev | Optional; **required** when the Fan service is included in an air purifier accessory | HAP/HAPCharacteristicTypes.h:2388-2415; HAP/HAPCharacteristicTypes.c:189; HAP/HAPServiceTypes.h:730-731 |
| Rotation Direction | `0x28` | Int (the declared enum is `uint8_t`) | none declared | 0 / 1 / 1 | `Clockwise` = 0: clockwise; `CounterClockwise` = 1: counter-clockwise | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:572-598; HAP/HAPCharacteristicTypes.c:57 |
| Rotation Speed | `0x29` | Float | Percentage | 0 / 100 / 1 | No enumerated valid values — a continuous percentage over `[0, 100]` on a step of 1 | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:600-619; HAP/HAPCharacteristicTypes.c:59 |
| Swing Mode | `0xB6` | UInt8 | none declared | 0 / 1 / 1 | `Disabled` = 0: swing disabled; `Enabled` = 1: swing enabled | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:2359-2386; HAP/HAPCharacteristicTypes.c:187 |
| Lock Physical Controls | `0xA7` | UInt8 | none declared | 0 / 1 / 1 | `Disabled` = 0: control lock disabled; `Enabled` = 1: control lock enabled | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:1912-1940; HAP/HAPCharacteristicTypes.c:159 |

Permission abbreviations are the strings the accessory server emits in the `perms` array of a characteristic object: `pr` (readable / Paired Read), `pw` (writable / Paired Write), `ev` (supportsEventNotification / Notify), `aa` (supportsAuthorizationData), `tw` (requiresTimedWrite), `wr` (ip.supportsWriteResponse), `hd` (hidden) (HAP/HAPIPAccessoryProtocol.c:737-785). None of the fan characteristics is documented as requiring a timed write, authorization data or a write response.

`On` is **not** in the Fan service's characteristic list at all — the Fan service's required list is exactly `Active` and its optional list is exactly `Name`, `Current Fan State`, `Target Fan State`, `Rotation Direction`, `Rotation Speed`, `Swing Mode`, `Lock Physical Controls` (HAP/HAPServiceTypes.h:735-745).

---

## The legacy Fan service, and what "Fan v2" deprecates

`HAPServiceTypes.h` declares one fan service, and both of its symbol names resolve to the same type:

```c
#define kHAPServiceDebugDescription_Fan "fanv2"
extern const HAPUUID kHAPServiceType_Fan;

HAP_DEPRECATED_MSG("Use kHAPServiceDebugDescription_Fan instead.")
#define kHAPServiceDebugDescription_FanV2 "fanv2"

HAP_DEPRECATED_MSG("Use kHAPServiceType_Fan instead.")
extern const HAPUUID kHAPServiceType_FanV2;
```
(HAP/HAPServiceTypes.h:751-759)

`kHAPServiceType_Fan` and `kHAPServiceType_FanV2` are both `HAPUUIDCreateAppleDefined(0xB7)` (HAP/HAPServiceTypes.c:65,67). So the deprecation marked in the ADK is of the **symbol spelling** `FanV2` in favour of `Fan` — it is not a deprecation of a service, and it does not describe a v1→v2 migration. The service the ADK calls "Fan" *is* the one whose debug description is `"fanv2"`.

What neither source contains:

- **No legacy v1 fan service is defined anywhere in the ADK.** The service-type table runs `AccessoryInformation 0x3E`, `GarageDoorOpener 0x41`, `LightBulb 0x43`, … `Fan 0xB7`, `Slat 0xB9`, … with no second fan entry (HAP/HAPServiceTypes.c:9-91). **The legacy Fan (v1) service's UUID is therefore not stated in either source, and this document does not supply one.** A readers' fact file names `0x40` as the legacy fan service UUID (facts/adk-21.md:35); that number appears nowhere in the ADK or in the crawled Apple pages, so it is treated here as unsourced. Primary source wins: the only fan service either source defines is `0xB7`.
- **The Apple framework has no "Fanv2" constant.** It exposes `HMServiceTypeFan` — "A fan service", available from iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmservicetypefan) — and a separate `HMServiceTypeVentilationFan`, available from iOS 10.2 / tvOS 10.1 / watchOS 3.1.1 (/documentation/homekit/hmservicetypeventilationfan). Neither page gives a UUID, so the mapping from `HMServiceTypeFan` to `0xB7` is not stated by Apple's documentation; it is only inferable from the ADK.
- **No fan symbol is deprecated in the HomeKit framework.** The only entries under "Deprecated characteristic types" are `HMCharacteristicTypeManufacturer`, `HMCharacteristicTypeModel`, `HMCharacteristicTypeFirmwareVersion` and `HMCharacteristicTypeSerialNumber` (/documentation/homekit/characteristic-types). `HMServiceTypeFan` carries no deprecation marker (/documentation/homekit/hmservicetypefan).

### `On` — the legacy fan generation's power characteristic

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| On | `0x25` | Bool | n/a (Bool characteristics declare no units and no constraints) | n/a | `true` / `false` — "represents the states for 'on' and 'off'"; no named enum constants are defined | pr, pw, ev | Not part of the Fan service; **required** on `Light Bulb` (R14 §8.23) and `Switch` (R14 §8.38) | HAP/HAPCharacteristicTypes.h:537-552; HAP/HAPCharacteristicTypes.c:53; HAP/HAPServiceTypes.h:180-190; HAP/HAP.h:942-981 |

Apple's app-side equivalent is `HMCharacteristicTypePowerState` — "The power state of the accessory… A value of `true` indicates that the accessory is powered on", filed under "Power and switches", available from iOS 8.0 (/documentation/homekit/hmcharacteristictypepowerstate). This is a different constant from `HMCharacteristicTypeActive`, which Apple files under "General state" (/documentation/homekit/hmcharacteristictypeactive). On/PowerState and Active/ActivationState must not be conflated.

---

## Fan characteristics on neighbouring services

These services are not fans, but they carry fan characteristics under their own required/optional lists.

| Service | Debug description | Fan characteristics it may carry | Notes | Source |
|---|---|---|---|---|
| Air Purifier | `"air-purifier"` | Optional: `Name`, `Rotation Speed`, `Swing Mode`, `Lock Physical Controls` (required: `Active`, `Current Air Purifier State`, `Target Air Purifier State`) | May include `Rotation Speed` "to control fan speed if the fan cannot be independently controlled"; may instead link a `Fan` service. Carries **no** `Rotation Direction`. | HAP/HAPServiceTypes.h:820-851 |
| Heater Cooler | `"heater-cooler"` | Optional: `Name`, `Rotation Speed`, `Temperature Display Units`, `Swing Mode`, `Cooling/Heating Threshold Temperature`, `Lock Physical Controls` | Same "if the fan cannot be independently controlled" rule; may link a `Fan` service. Carries **no** `Rotation Direction`. | HAP/HAPServiceTypes.h:859-891 |
| Humidifier Dehumidifier | — | Optional list includes `Name`, `Relative Humidity` thresholds, and (per the same pattern) `Rotation Speed`, `Swing Mode`, `Lock Physical Controls` | Same "if the fan cannot be independently controlled" rule; may link a `Fan` service. | HAP/HAPServiceTypes.h:899-916 |
| Slat | `"vertical-slat"` | Optional: `Name`, `Swing Mode`, `Current Tilt Angle`, `Target Tilt Angle` (required: `Current Slat State`, `Slat Type`) | "`Swing Mode` implies that the slats can swing automatically (e.g. vents on a fan)." | HAP/HAPServiceTypes.h:762-790 |

`Rotation Direction` is offered only by the `Fan` service; it does not appear in the Air Purifier, Heater Cooler, Humidifier Dehumidifier or Slat characteristic lists (HAP/HAPServiceTypes.h:742; HAP/HAPServiceTypes.h:844-848; HAP/HAPServiceTypes.h:884-891).

---

## Semantics and rules

**Power and activity**

- `Active` = 0 means the service is Inactive and `Active` = 1 means it is Active; the characteristic "indicates whether the service is currently active" (HAP/HAPCharacteristicTypes.h:2148, 2166-2171).
- `Current Fan State` = 0 (`Inactive`), 1 (`Idle`), 2 (`BlowingAir`) (HAP/HAPCharacteristicTypes.h:2134-2142). Apple's controller-side enum names the third case `.active` and defines it as "The fan is blowing air", with `.idle` as "The fan is idle" — so a fan that is powered but not moving air is `Idle`, not the blowing-air value (/documentation/homekit/hmcharacteristicvaluecurrentfanstate/active, /documentation/homekit/hmcharacteristicvaluecurrentfanstate/idle).
- `Current Fan State` is read-only: its permissions are Paired Read and Notify, with no Paired Write (HAP/HAPCharacteristicTypes.h:2121). A controller can never set it.
- `Target Fan State` = 0 (`Manual`), 1 (`Auto`) (HAP/HAPCharacteristicTypes.h:2409-2414). There is no off/inactive member: on/off is expressed only through `Active` (/documentation/homekit/hmcharacteristicvaluetargetfanstate).

**Speed**

- `Rotation Speed` is a Float with minimum 0, maximum 100, step 1, unit Percentage (HAP/HAPCharacteristicTypes.h:605-610). Nothing in either source assigns `0` a meaning distinct from "zero percent of maximum speed"; in particular, **neither source says that `Rotation Speed` = 0 turns the fan off** — `Active` is the separate on/off control.
- Apple states the controller-side value is "a floating point number representing the percentage of the maximum speed" (/documentation/homekit/hmcharacteristictyperotationspeed). It is a percentage of maximum, not RPM and not a step index.
- Over IP the unit is serialized into the characteristic object as `"unit":"percentage"` (HAP/HAPIPAccessoryProtocol.c:835). Over BLE the HAP Percentage unit maps to BT SIG unit `0x27AD` (HAP/HAPBLEPDU+TLV.c:195-206).
- A float write is first checked against the declared constraints and rejected with `kHAPError_InvalidData` if it falls outside them; only then is the accepted value **rounded to the nearest step** before the write handler is invoked (HAP/HAPCharacteristic.c:1356-1364, 1287-1294). A value satisfies the constraints when it lies within `[minimumValue, maximumValue]` and, if the step is non-zero, `(value - minimumValue) / stepValue` is within rounding distance of an integer (HAP/HAPCharacteristic.c:51-56).
- A step value of `0` means "no step constraint" (HAP/HAPCharacteristic.c:1289; HAP/HAP.h:2561-2573).
- Reads are rounded the same way: the value returned by the read handler is asserted against the constraints and then rounded to the step (HAP/HAPCharacteristic.c:1331-1337).

**Direction, swing, child lock**

- `Rotation Direction` = 0 (`Clockwise`), 1 (`CounterClockwise`) (HAP/HAPCharacteristicTypes.h:591-597). Neither source assigns "forward"/"reverse", "summer"/"winter" or any seasonal meaning to either value — only the physical sense of rotation (/documentation/homekit/hmcharacteristicvaluerotationdirection).
- `Swing Mode` = 0 (`Disabled`), 1 (`Enabled`) (HAP/HAPCharacteristicTypes.h:2380-2385). Apple's semantics are head oscillation: `.disabled` = "The fan remains in a fixed position", `.enabled` = "The fan swings back and forth" (/documentation/homekit/hmcharacteristicvalueswingmode/disabled, /documentation/homekit/hmcharacteristicvalueswingmode/enabled). On a `Slat` service the same characteristic means the slats can swing automatically (HAP/HAPServiceTypes.h:770).
- `Lock Physical Controls` = 0 (`Disabled`), 1 (`Enabled`) — "a way to lock a set of physical controls on an accessory (eg. child lock)" (HAP/HAPCharacteristicTypes.h:1915, 1933-1939). Apple's enum names the two states `.notLocked` and `.locked` (/documentation/homekit/hmcharacteristicvaluelockphysicalcontrolsstate). There is no third "unsupported" value.

**Service composition and consistency**

- If the Fan service is included in air purifier accessories, `Current Fan State` and `Target Fan State` are required characteristics (HAP/HAPServiceTypes.h:730-731).
- When a `Fan` is a linked service of an `Air Purifier`: changing `Active` on the Air Purifier **must** produce a corresponding change to `Active` on the Fan; changing the Fan's `Active` from Inactive to Active does **not** require the Air Purifier's `Active` to change (this is what enables "Fan Only" mode); changing the Fan's `Active` from Active to Inactive **must** set the Air Purifier's `Active` to Inactive (HAP/HAPServiceTypes.h:826-832).
- An Air Purifier, Heater Cooler or Humidifier Dehumidifier service may include `Rotation Speed` itself *only* where the fan cannot be independently controlled; where it can, the fan belongs in a linked `Fan` service (HAP/HAPServiceTypes.h:834-835, 873-874, 914-916).

**Events**

- "When the characteristic state changes, the `HAPAccessoryServerRaiseEvent` or `HAPAccessoryServerRaiseEventOnSession` function must be called" (HAP/HAP.h:326-327). `HAPAccessoryServerRaiseEvent` notifies all subscribed sessions; the `OnSession` variant targets one (HAP/HAP.h:4291-4320).
- Only characteristics whose properties set `supportsEventNotification` can be subscribed to; that flag is what emits `ev` in the perms array (HAP/HAP.h:329; HAP/HAPIPAccessoryProtocol.c:751-757). Of the fan characteristics, every one except `Name` declares Notify (see the table above); `Name` is Paired Read only (HAP/HAPCharacteristicTypes.h:508).
- Event notifications are not raised automatically on write — the application raises them after its own state changes, and Apple's reference handlers raise an event only when the written value actually differs from the current one (HAP/HAP.h:326-327; readers' facts facts/adk-00.md:146-147, citing Applications/Lightbulb/App.c:169-175).
- From the controller side: "You only receive updates for changes made outside your app, for example by Apple's Home app, or by the accessory itself" (/documentation/homekit/hmcharacteristic/value). A fan changed at its own remote or wall control is invisible to controllers until the accessory emits an event.

**Valid-values descriptors**

- `validValues` and `validValuesRanges` exist **only** on the UInt8 characteristic struct; UInt16/UInt32/UInt64/Int/Float have only minimum/maximum/step (HAP/HAP.h:1244-1268 vs 2561-2573). `Rotation Speed`, being a Float, therefore cannot carry an enumerated valid-values list at all; `Rotation Direction`, declared as format Int, likewise cannot.
- Where they are used, entries must be sorted ascending and a characteristic must not declare both lists at once; violations fail accessory validation (HAP/HAPAccessoryValidation.c:548-591).
- The IP transport does **not** serialize valid-values into the characteristic object — only `format`, `unit`, `minValue`, `maxValue`, `minStep`, `perms` and `ev` appear there (HAP/HAPIPAccessoryProtocol.c:729-1010). The BLE transport emits a Valid Values Descriptor, but only when the format is UInt8 and the list is non-empty, and only for Apple-defined characteristics (HAP/HAPBLEPDU+TLV.c:683-711).

**Accessory-definition validation**

- A characteristic whose `minimumValue > maximumValue`, or whose `stepValue` is negative (for Int and Float), fails accessory validation outright (HAP/HAPAccessoryValidation.c:672-707).
- The accessory category `Fans` is `3`; a bridged accessory must instead declare `kHAPAccessoryCategory_BridgedAccessory` (= 0), and only the bridge itself carries a functional category (HAP/HAP.h:3317-3327; HAP/HAPAccessoryValidation.c:788-800).
- `HAPAccessoryValidation.c` validates generic structure — instance IDs, UTF-8 debug descriptions, constraint sanity, linked-service references, hidden-service consistency — but contains **no** service-specific rule for Fan and does not check that a Fan service actually carries `Active`. The required/optional lists are specification prose in the header, not code-enforced (HAP/HAPAccessoryValidation.c:60-300, 755-800).

---

## HomeKit framework / Home app view

**Availability.** The fan family splits cleanly into two generations:

| Symbol | iOS / iPadOS / Mac Catalyst | tvOS | watchOS | Source |
|---|---|---|---|---|
| `HMServiceTypeFan` | 8.0 | 10.0 | 2.0 | /documentation/homekit/hmservicetypefan |
| `HMServiceTypeVentilationFan` | 10.2 | 10.1 | 3.1.1 | /documentation/homekit/hmservicetypeventilationfan |
| `HMCharacteristicTypeRotationSpeed` | 8.0 | 10.0 | 2.0 | /documentation/homekit/hmcharacteristictyperotationspeed |
| `HMCharacteristicTypeRotationDirection` | 8.0 | 10.0 | 2.0 | /documentation/homekit/hmcharacteristictyperotationdirection |
| `HMCharacteristicTypePowerState` (the HAP `On`) | 8.0 | 10.0 | 2.0 | /documentation/homekit/hmcharacteristictypepowerstate |
| `HMCharacteristicTypeActive` | 10.2 | 10.1 | 3.1.1 | /documentation/homekit/hmcharacteristictypeactive |
| `HMCharacteristicTypeCurrentFanState` | 10.2 | 10.1 | 3.1.1 | /documentation/homekit/hmcharacteristictypecurrentfanstate |
| `HMCharacteristicTypeTargetFanState` | 10.2 | 10.1 | 3.1.1 | /documentation/homekit/hmcharacteristictypetargetfanstate |
| `HMCharacteristicTypeSwingMode` | 10.2 | 10.1 | 3.1.1 | /documentation/homekit/hmcharacteristictypeswingmode |
| `HMCharacteristicTypeLockPhysicalControls` | 10.2 | 10.1 | 3.1.1 | /documentation/homekit/hmcharacteristictypelockphysicalcontrols |
| `HMAccessoryCategoryTypeFan` | 9.0 | 10.0 | 2.0 | /documentation/homekit/hmaccessorycategorytypefan |

The ADK states the *accessory-side* floor differently: the Fan service and the `Active`, `Current Fan State`, `Target Fan State`, `Swing Mode` and `Lock Physical Controls` characteristics each "require iOS 10.3 or later" (HAP/HAPServiceTypes.h:733; HAP/HAPCharacteristicTypes.h:2118, 2150, 2364, 2393, 1917). Apple's framework pages put the same symbols at iOS 10.2. This is a genuine discrepancy between the two sources; both are recorded, and the ADK's 10.3 is the conservative figure for an accessory implementation.

**Grouping.** Apple's "Fans" group is exactly `HMCharacteristicTypeCurrentFanState`, `HMCharacteristicTypeTargetFanState`, `HMCharacteristicTypeRotationDirection`, `HMCharacteristicTypeRotationSpeed`, `HMCharacteristicTypeSwingMode` (/documentation/homekit/characteristic-types). `Active` is filed under "General state" and `LockPhysicalControls` under "Locks and openers" (/documentation/homekit/hmcharacteristictypeactive, /documentation/homekit/hmcharacteristictypelockphysicalcontrols). `HMServiceTypeFan` itself is filed under "Temperature and Humidity" (/documentation/homekit/hmservicetypefan).

**Deprecations.** None in the fan family. The framework's deprecated-characteristic list contains only Manufacturer, Model, FirmwareVersion and SerialNumber (/documentation/homekit/characteristic-types). The only fan-related deprecation in either source is the ADK's `kHAPServiceType_FanV2` / `kHAPServiceDebugDescription_FanV2` symbol aliases, superseded by the `_Fan` spellings of the identical `0xB7` type (HAP/HAPServiceTypes.h:755-759).

**`HMCharacteristicMetadata` expectations.** Controllers build their UI from metadata the accessory publishes: "Querying a characteristic's metadata enables you to build a user interface that reflects the underlying units, minima, and maxima, and other aspects of the characteristic value" (/documentation/homekit/hmcharacteristicmetadata). The relevant properties are `minimumValue`, `maximumValue` and `stepValue` — each "only applies to characteristics with a number type" (/documentation/homekit/hmcharacteristicmetadata/minimumvalue, /maximumvalue, /stepvalue) — plus `units`, whose value for a fan speed is `HMCharacteristicMetadataUnitsPercentage`, rendered as the symbol `%` in Apple's own example extension (/documentation/homekit/hmcharacteristicmetadata/units, /documentation/homekit/hmcharacteristicmetadataunitspercentage). `validValues` is "The subset of valid values supported by the characteristic **when the format is of type unsigned integer**", available from iOS 10.0 (/documentation/homekit/hmcharacteristicmetadata/validvalues) — consistent with the ADK restricting valid-values lists to UInt8.

**What the controller enforces.** The framework validates writes before they reach the accessory: `HMError.Code.valueHigherThanMaximum` — "An attempt to use a numeric value higher than the specified maximum value"; `HMError.Code.valueLowerThanMinimum` — "An attempt to use a numeric value lower than the specified minimum value"; `HMError.Code.readOnlyCharacteristic` — "An attempt to modify a read-only value"; `HMError.Code.notificationNotSupported` — "An attempt to register for notifications from an accessory that does not support notifications" (/documentation/homekit/hmerror/code/valuehigherthanmaximum, /valuelowerthanminimum, /readonlycharacteristic, /notificationnotsupported).

**How fans are presented.** Each service — not each accessory — is what the Home app calls an "accessory": "These services are what Apple's Home app labels as 'accessories'" (/documentation/homekit/hmservice), and "Each item that the user names… appears in the Home app as an 'accessory'. However, in HomeKit, these are hmservice instances" (/documentation/homekit/configuring-a-home-automation-device). Each service is separately named and renamable by the user (/documentation/homekit/hmaccessorydelegate/accessory(_:didupdatenamefor:)). Services are also discovered by type: `HMHome.servicesWithTypes(_:)` "Returns an array of all services provided by accessories in the home that match the specified types" (/documentation/homekit/hmhome/serviceswithtypes(_:)).

`associatedServiceType` — the mechanism by which a user re-types a tile — is explicitly scoped to outlets and switches: "The type of the service associated with an outlet or a switch… The associated service can be any service defined by the HomeKit Accessory Profile that supports `HMCharacteristicTypePowerState`, other than `HMServiceTypeOutlet` or `HMServiceTypeSwitch`" (/documentation/homekit/hmservice/associatedservicetype). Because the `0xB7` Fan service carries `Active` rather than `On`/PowerState, it is **not** eligible as an associated service type under that definition.

**Ordering of writes.** "Actions in an action set are performed in an unspecified order" (/documentation/homekit/hmactionset). A scene that sets both `Active` and `RotationSpeed` may deliver them in either order.

**Percentage vs steps.** Apple documents the *value* as a floating-point percentage of maximum speed and documents `stepValue` as "The minimum interval between values for the characteristic" (/documentation/homekit/hmcharacteristictyperotationspeed, /documentation/homekit/hmcharacteristicmetadata/stepvalue). **Neither source describes how the Home app renders a fan-speed control** — no source text describes a slider, discrete detents, or a mapping from `minStep` to a number of on-screen speed positions. Any claim about "N-position fan controls in the Home app" is unsupported by both sources; see Open questions.

---

## Implications for a bridge plugin

**Service choice**

1. Expose the `0xB7` service (`Fan` / `"fanv2"` / HAP-NodeJS `Fanv2`) for new fan accessories. It is the only fan service the ADK defines (HAP/HAPServiceTypes.c:65,67).
2. Do not treat "Fan v2" as a version to migrate *to* within the ADK's model — `Fan` and `FanV2` are the same UUID, and only the `FanV2` *symbol names* are deprecated (HAP/HAPServiceTypes.h:755-759).
3. If a plugin currently exposes a legacy `On`-based fan service, understand that the type it is using is defined by neither source. INFERRED: because `Active` (iOS 10.2 framework / iOS 10.3 ADK) is newer than `On` (iOS 8.0), the legacy service is the only fan representation older controllers understand; nothing in either source states that the legacy service stopped working, only that Apple's reference implementation no longer defines it.

**Power and state**

4. Always publish `Active` — it is the sole required characteristic (HAP/HAPServiceTypes.h:735-736). Never publish `On` on a `0xB7` service; it is not in the service's list.
5. Publish `Current Fan State` read-only (`pr`+`ev`) and never accept writes to it (HAP/HAPCharacteristicTypes.h:2121).
6. Report `Idle` (1) when the fan is Active but not moving air, and `BlowingAir` (2) only when air is actually moving (/documentation/homekit/hmcharacteristicvaluecurrentfanstate/idle, /active). INFERRED: for a device that gives no "is it actually spinning" feedback, deriving `CurrentFanState` from `Active` plus a non-zero `RotationSpeed` is the closest honest approximation — but omitting the characteristic entirely is more accurate than inventing a state, since it is optional outside air-purifier accessories.
7. Advertise `TargetFanState` only if the device really has an automatic mode; its only values are `Manual` (0) and `Auto` (1), and there is no "off" member (HAP/HAPCharacteristicTypes.h:2409-2414). A device with no auto mode should omit the characteristic rather than pin it to `Manual`. INFERRED. Since `TargetFanState` is a UInt8, a plugin that supports only one mode *may* constrain it with a `validValues` list — that mechanism is UInt8-only and Apple-defined-only (HAP/HAP.h:1244-1268) — but note the IP transport does not transmit valid-values at all (HAP/HAPIPAccessoryProtocol.c:729-1010), so min/max are the constraint controllers actually see over IP.

**Representing N discrete speeds on a 0–100 percentage**

8. `RotationSpeed` has no "number of speeds" concept: it is a Float over `[0, 100]` with a declared step (HAP/HAPCharacteristicTypes.h:605-609), and Apple defines the value as a percentage of maximum speed (/documentation/homekit/hmcharacteristictyperotationspeed). A device with N speeds must be mapped onto that percentage.
9. INFERRED (mechanism sourced, arithmetic not): for a device with N discrete speeds, declare `minStep = 100 / N` so that the valid points are exactly `0, 100/N, 2·100/N, …, 100`, giving N non-zero positions plus zero. The sourced part is that constraint enforcement accepts a value only when `(value - min) / step` is near-integral and then rounds it to the nearest step (HAP/HAPCharacteristic.c:51-56, 1287-1294), and that the controller refuses values outside `[min, max]` (/documentation/homekit/hmerror/code/valuehigherthanmaximum, /valuelowerthanminimum).
10. Prefer a step that divides 100 exactly (N ∈ {1, 2, 4, 5, 10, 20, 25, 50}) so that the top position lands on exactly 100. INFERRED: for N = 3, a step of `100/3` is not exactly representable as a float, and since writes are validated against the step *before* rounding, a controller value that is not near-integral in step units is rejected with `kHAPError_InvalidData` (HAP/HAPCharacteristic.c:1356-1361) — safer to keep `minStep = 1` and quantize inside the plugin than to declare a non-dividing step.
11. If you keep `minStep = 1`, quantize in the write handler and then **raise an event with the quantized value** so controllers converge on the value the device actually took (HAP/HAP.h:326-327, 4291-4303). Do not silently accept 37 and report 37 while the hardware runs at 33.
12. Never use `RotationSpeed = 0` as the off switch. Nothing in either source gives 0 that meaning; `Active` is the on/off control (HAP/HAPCharacteristicTypes.h:2148, 605-609). INFERRED: publish `Active = Inactive` for off and leave the last speed in `RotationSpeed`, or report speed 0 alongside `Active = Inactive` — but do not require a controller to write 0 to turn the fan off, because a scene may write `Active` and `RotationSpeed` in either order (/documentation/homekit/hmactionset).
13. Do not publish speeds as RPM or as a step index — the declared unit is Percentage, serialized as `"unit":"percentage"` over IP and BT SIG `0x27AD` over BLE (HAP/HAPCharacteristicTypes.h:610; HAP/HAPIPAccessoryProtocol.c:835; HAP/HAPBLEPDU+TLV.c:195-206).
14. Publish accurate `minValue`/`maxValue`, because the controller validates writes against the published metadata before they reach the bridge (/documentation/homekit/hmerror/code/valuehigherthanmaximum, /valuelowerthanminimum). A fan whose real range is 20–100 % should still declare 0–100 unless the device genuinely cannot be commanded below 20; INFERRED, since neither source discusses non-zero minima for fan speed.

**Direction, swing, child lock**

15. Expose `RotationDirection` only on the `0xB7` Fan service — no other service lists it (HAP/HAPServiceTypes.h:742, 844-848, 884-891).
16. Map "reverse"/"winter" modes onto exactly `Clockwise` (0) and `CounterClockwise` (1); there is no third value and no documented seasonal semantics (HAP/HAPCharacteristicTypes.h:591-597; /documentation/homekit/hmcharacteristicvaluerotationdirection). INFERRED: pick one mapping and keep it stable across releases, since a change would silently invert every user's automations.
17. Expose `SwingMode` only for a device that physically "swings back and forth" (/documentation/homekit/hmcharacteristicvalueswingmode/enabled). INFERRED: a ceiling fan has no oscillating head, so `SwingMode` has no honest mapping there; and a device whose vents tilt rather than oscillate belongs in a linked `Slat` service, where `Swing Mode` means the slats swing automatically (HAP/HAPServiceTypes.h:770).
18. Expose `LockPhysicalControls` only when the device has a real child lock; there are exactly two states and no "unsupported" value (HAP/HAPCharacteristicTypes.h:1933-1939).

**Composition**

19. If the fan is part of an air purifier accessory, `CurrentFanState` and `TargetFanState` become mandatory on the Fan service (HAP/HAPServiceTypes.h:730-731).
20. When linking a `Fan` to an `Air Purifier`, implement the three `Active` propagation rules exactly — purifier→fan mirroring, fan-on without purifier-on (Fan Only), and fan-off forcing purifier-off (HAP/HAPServiceTypes.h:826-832).
21. Put `Rotation Speed` directly on an `Air Purifier` / `Heater Cooler` / `Humidifier Dehumidifier` service only when its fan cannot be controlled independently; otherwise model the fan as a linked `Fan` service (HAP/HAPServiceTypes.h:834-835, 873-874, 914-916).
22. Give each service its own meaningful `Name`, because every service becomes a separately named Home-app tile (/documentation/homekit/hmservice; /documentation/homekit/hmaccessorydelegate/accessory(_:didupdatenamefor:)).
23. Set the bridge's own accessory category appropriately; bridged accessories must use `kHAPAccessoryCategory_BridgedAccessory` (0), not `Fans` (3) (HAP/HAP.h:3317-3327; HAP/HAPAccessoryValidation.c:788-800).

**Events and unreachability**

24. Declare `ev` on every fan characteristic whose value can change asynchronously (`Active`, `RotationSpeed`, `RotationDirection`, `SwingMode`, `CurrentFanState`, `TargetFanState`, `LockPhysicalControls`) — a subscription attempt on a characteristic without it fails with `notificationNotSupported` (/documentation/homekit/hmerror/code/notificationnotsupported), and the header declares Notify on all of them (see the service table).
25. Emit an event whenever the device changes state by itself — a pull-chain, an RF remote, a wall switch, a timer — because controllers otherwise learn nothing until their next explicit read (HAP/HAP.h:326-327; /documentation/homekit/hmcharacteristic/value).
26. Suppress no-op events: raise only when the value actually changed (readers' facts facts/adk-00.md:147, citing Applications/Lightbulb/App.c:169-175).
27. When the backing device is unreachable, **neither source specifies a characteristic-level "unknown" value for any fan characteristic** — there is no unreachable member in `Active`, `CurrentFanState`, `TargetFanState`, `RotationDirection`, `SwingMode` or `LockPhysicalControls`. Unreachability is surfaced controller-side as a property of the accessory (`HMAccessory.isReachable`, /documentation/homekit/hmaccessory/isreachable) and distinguished as `accessoryNotReachable` vs `bridgedAccessoryNotReachable` in the error taxonomy (readers' facts facts/apple-11.md:125, citing /documentation/homekit/hmerror). INFERRED: a read handler should return the last known value, or fail the read with an error status, rather than fabricate `Inactive`/speed 0 — reporting a fabricated "off" makes an unreachable fan look deliberately switched off in every controller and in automation conditions.
28. Do not require a particular write ordering. A scene may deliver `Active` and `RotationSpeed` in any order and possibly in one aggregate write (/documentation/homekit/hmactionset), so a handler must accept a speed write that arrives before the fan is made Active.

---

## Open questions

Neither source answers these:

- **How the Home app renders fan speed.** No source text describes whether `minStep` produces discrete detents, a continuous slider, or a fixed set of positions, nor whether a 4-speed fan declared with `minStep = 25` shows four positions. The percentage semantics are documented; the presentation is not.
- **The legacy Fan (v1) service's UUID and characteristic list.** The ADK defines no such service and the Apple pages give no UUIDs, so neither the type nor its required/optional characteristics can be stated from these sources.
- **Whether `HMServiceTypeFan` maps to `0xB7` or to a legacy type.** Apple's page gives no UUID; the iOS 8.0 availability of `HMServiceTypeFan` predates the iOS 10.2/10.3 `0xB7` service, which leaves the mapping ambiguous from Apple's documentation alone.
- **What `HMServiceTypeVentilationFan` corresponds to in HAP.** It appears as a framework constant with no UUID and no ADK counterpart; the ADK defines no ventilation-fan service type.
- **Whether `RotationSpeed = 0` should imply `Active = Inactive`.** Neither source states a required relationship between the two, in either direction, nor what an accessory should do when it receives a speed of 0 while Active.
- **The iOS floor discrepancy.** The ADK says the Fan service and the iOS-10.x fan characteristics require iOS 10.3; Apple's framework pages say 10.2. Neither source explains the difference.
- **`Name` maximum length on the Fan service.** The `Name` characteristic's header block states format String and Paired Read but declares no `maxLength`; the 64-character limit seen in sample databases is an application choice, not a spec constraint stated in the header.
- **Behaviour of `LockPhysicalControls` with respect to HAP writes.** Neither source says whether enabling the child lock is expected to block HomeKit writes as well as physical controls, or only the latter.
- **Whether an accessory may restrict `TargetFanState` to a single value.** The valid-values mechanism exists for UInt8 characteristics but is not transmitted over IP, and neither source says what a controller does when a target-state characteristic advertises only one usable value.
