# Lights, switches and outlets

This is the authoritative reference for the HomeKit services a bridge plugin uses to expose on/off and lighting control: `Light Bulb` (On, Brightness, Hue, Saturation, Color Temperature), `Switch`, `Outlet` (On, Outlet In Use) and `Stateless Programmable Switch` (Programmable Switch Event), plus the `Service Label` adjunct that multi-button accessories require. It covers the exact UUIDs, formats, units, ranges and permissions an accessory must publish; the behavioural rules the HomeKit Accessory Protocol imposes (what `0` means, when Hue/Saturation and Color Temperature may coexist, why a stateless button reads as `null`, and when notifications may be coalesced); what the HomeKit framework and Home app do with each of these on the controller side; and the concrete do/don't rules that follow for a bridge plugin. Momentary and stateless controls get their own rules section, because they are the one family in this group whose value is an event rather than a state.

**Sources:** HomeKitADK, commit `fb201f98`, 2021-10-23 (`HAP/HAPCharacteristicTypes.h`, `HAP/HAPServiceTypes.h`, `HAP/HAPCharacteristicTypes.c`, `HAP/HAPServiceTypes.c`, `HAP/HAPUUID.h`, `HAP/HAP.h`, `HAP/HAPCharacteristic.c`, `HAP/HAPAccessoryValidation.c`, `HAP/HAPIPAccessoryServer.c`, `HAP/HAPIPAccessory.c`, `HAP/HAPIPAccessoryProtocol.c`, `Applications/Lightbulb/*`); Apple developer documentation for the HomeKit framework, crawled 2026-09-12 (`/documentation/homekit/...`). Where the two disagree, the ADK (the accessory-side protocol definition) wins and the discrepancy is noted.

## UUID convention

All types below are Apple-defined and are given in the **short form** used throughout the ADK. The full UUID is `XXXXXXXX-0000-1000-8000-0026BB765291`, where `XXXXXXXX` is the short value zero-padded to eight hex digits — e.g. short `0x43` is the Light Bulb service `00000043-0000-1000-8000-0026BB765291` (HAP/HAPUUID.h:21-29, HAP/HAPUUID.h:37-40). Short forms here are written exactly as the ADK writes them (`0x8`, not `0x08`); pad to eight digits when emitting JSON or a hap-nodejs UUID.

Permission abbreviations follow HAP: `pr` = Paired Read, `pw` = Paired Write, `ev` = Notify / event notification, `hd` = hidden, `tw` = requires timed write, `aa` = supports authorization data, `wr` = write response. The ADK expresses these as the `HAPCharacteristicProperties` flags `readable`, `writable`, `supportsEventNotification`, `hidden`, `requiresTimedWrite`, `supportsAuthorizationData`, `ip.supportsWriteResponse` (Applications/Lightbulb/DB.c:54-64).

---

## Light Bulb

Service type `0x43`, debug description `"lightbulb"` (HAP/HAPServiceTypes.c:13; HAP/HAPServiceTypes.h:95-97). HAP R14 §8.23. "This service describes a light bulb." (HAP/HAPServiceTypes.h:77-79)

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| On | `0x25` | Bool | — | — | `false` = off, `true` = on (no named enum in either source) | pr, pw, ev | **Required** | HAP/HAPCharacteristicTypes.h:538-551; HAP/HAPCharacteristicTypes.c:53; HAP/HAPServiceTypes.h:81-82 |
| Brightness | `0x8` | Int (signed 32-bit) | Percentage | 0 / 100 / 1 | continuous range; no enum | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:55-73; HAP/HAPCharacteristicTypes.c:13; HAP/HAPServiceTypes.h:84-89 |
| Hue | `0x13` | Float | Arcdegrees | 0 / 360 / 1 | continuous range; no enum | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:244-261; HAP/HAPCharacteristicTypes.c:27; HAP/HAPServiceTypes.h:84-89 |
| Saturation | `0x2F` | Float | Percentage | 0 / 100 / 1 | continuous range; no enum | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:622-639; HAP/HAPCharacteristicTypes.c:61; HAP/HAPServiceTypes.h:84-89 |
| Color Temperature | `0xCE` | UInt32 | none declared (value is mirek / reciprocal megakelvin) | 50 / 400 / 1 | continuous range; no enum | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.h:2734-2756; HAP/HAPCharacteristicTypes.c:217; HAP/HAPServiceTypes.h:84-89 |
| Name | `0x23` | String | — | maxLength 64 in the ADK example (`constraints.maxLength`), not a spec range | — | pr | Optional | HAP/HAPCharacteristicTypes.h:502-516; HAP/HAPCharacteristicTypes.c:49; Applications/Lightbulb/DB.c:421-440 |

Notes on this table:

- The ADK lists the Light Bulb's optional characteristics as exactly `Brightness`, `Hue`, `Name`, `Saturation`, `Color Temperature` — nothing else (HAP/HAPServiceTypes.h:84-89). Adaptive-lighting transition characteristics do **not** appear anywhere in this ADK revision; see "Discrepancies".
- Neither source declares a `units` value for Color Temperature. The ADK units enum has only `None`, `Celsius`, `ArcDegrees`, `Percentage`, `Lux`, `Seconds` (HAP/HAP.h:505-538), so mirek has no unit constant and must be published as `kHAPCharacteristicUnits_None` / no unit.
- `kHAPServiceType_Lightbulb` and `kHAPServiceDebugDescription_Lightbulb` (lowercase "b") are marked `HAP_DEPRECATED_MSG("Use kHAPServiceType_LightBulb instead.")`; both spellings resolve to the same UUID `0x43` (HAP/HAPServiceTypes.h:99-103; HAP/HAPServiceTypes.c:13,15).

## Switch

Service type `0x49`, debug description `"switch"` (HAP/HAPServiceTypes.c:23; HAP/HAPServiceTypes.h:190-192). HAP R14 §8.38. "This service describes a binary switch." (HAP/HAPServiceTypes.h:176-178)

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| On | `0x25` | Bool | — | — | `false` = off, `true` = on | pr, pw, ev | **Required** | HAP/HAPCharacteristicTypes.h:538-551; HAP/HAPServiceTypes.h:180-181 |
| Name | `0x23` | String | — | maxLength 64 (ADK example) | — | pr | Optional | HAP/HAPCharacteristicTypes.h:502-516; HAP/HAPServiceTypes.h:183-184 |

There is no `Active`, no target/current state pair and no state machine: `On` is the whole service (HAP/HAPServiceTypes.h:176-184).

## Outlet

Service type `0x47`, debug description `"outlet"` (HAP/HAPServiceTypes.c:21; HAP/HAPServiceTypes.h:170-172). HAP R14 §8.30. "This service describes a power outlet." (HAP/HAPServiceTypes.h:155-157)

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| On | `0x25` | Bool | — | — | `false` = off, `true` = on | pr, pw, ev | **Required** | HAP/HAPCharacteristicTypes.h:538-551; HAP/HAPServiceTypes.h:159-161 |
| Outlet In Use | `0x26` | Bool | — | — | `false` = nothing plugged in, `true` = an appliance is plugged in (even if that appliance is off) | pr, ev | **Required** | HAP/HAPCharacteristicTypes.h:555-569; HAP/HAPCharacteristicTypes.c:55; HAP/HAPServiceTypes.h:159-161 |
| Name | `0x23` | String | — | maxLength 64 (ADK example) | — | pr | Optional | HAP/HAPCharacteristicTypes.h:502-516; HAP/HAPServiceTypes.h:163-164 |

`Outlet In Use` is **read-only plus notify** — it has no Paired Write permission (HAP/HAPCharacteristicTypes.h:560-561). Unlike Switch, Outlet has two required characteristics, not one.

## Stateless Programmable Switch

Service type `0x89`, debug description `"stateless-programmable-switch"` (HAP/HAPServiceTypes.c:49; HAP/HAPServiceTypes.h:534-536). HAP R14 §8.37. Requires iOS 10.3 or later (HAP/HAPServiceTypes.h:521).

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| Programmable Switch Event | `0x73` | UInt8 | — | 0 / 2 / 1 | `SinglePress = 0`, `DoublePress = 1`, `LongPress = 2` | pr, ev (no pw) | **Required** | HAP/HAPCharacteristicTypes.h:1380-1412; HAP/HAPCharacteristicTypes.c:119; HAP/HAPServiceTypes.h:523-524 |
| Service Label Index | `0xCB` | UInt8 | — | min 1, step 1; **no maximum declared** | — | pr | Optional in general; **required** when the accessory has more than one instance of this service | HAP/HAPCharacteristicTypes.h:2681-2699; HAP/HAPCharacteristicTypes.c:213; HAP/HAPServiceTypes.h:513-517,526-528 |
| Name | `0x23` | String | — | maxLength 64 (ADK example) | — | pr | Optional | HAP/HAPCharacteristicTypes.h:502-516; HAP/HAPServiceTypes.h:526-528 |

### Service Label (adjunct, required for multi-button accessories)

Service type `0xCC`, debug description `"service-label"`, requires iOS 10.3 or later (HAP/HAPServiceTypes.c:79; HAP/HAPServiceTypes.h:947-962).

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
|---|---|---|---|---|---|---|---|---|
| Service Label Namespace | `0xCD` | UInt8 | — | 0 / 1 / 1 | `Dots = 0` ("." ".." "..." "...."), `ArabicNumerals = 1` (0,1,2,3) | pr | **Required** (of the Service Label service) | HAP/HAPCharacteristicTypes.h:2702-2731; HAP/HAPCharacteristicTypes.c:215; HAP/HAPServiceTypes.h:953-954 |

---

## Semantics and rules

### On / power

- `On` "represents the states for 'on' and 'off'" and is a Bool with Paired Read, Paired Write and Notify (HAP/HAPCharacteristicTypes.h:540-546). The same characteristic UUID `0x25` serves Light Bulb, Switch and Outlet — there is no per-service variant (HAP/HAPCharacteristicTypes.c:53; HAP/HAPServiceTypes.h:81,159,180).
- `true` means the accessory is powered on (/documentation/homekit/hmcharacteristictypepowerstate).
- The ADK reference implementation raises an event **only when the written value differs from the stored value**; an idempotent write raises nothing (Applications/Lightbulb/App.c:162-178).
- `On` in the reference database sets `requiresTimedWrite = false`, `ip.supportsWriteResponse = false`, `ip.controlPoint = false`, and BLE `supportsBroadcastNotification = true` / `supportsDisconnectedNotification = true` (Applications/Lightbulb/DB.c:445-463). Timed writes are reserved for security-sensitive characteristics such as Lock Target State, not for lighting (Applications/Lock/DB.c:489).

### Brightness, and what 0 means

- Brightness "describes a perceived level of brightness … The value is expressed as a percentage (%) of the maximum level of supported brightness", Format Int, min 0, max 100, step 1, unit Percentage (HAP/HAPCharacteristicTypes.h:55-73).
- Neither the ADK nor Apple's documentation states that Brightness `0` means "off", and neither states that writing `0` must turn the light off or that turning a light on must restore a non-zero Brightness. What is sourced is only that `0` is the bottom of the percentage scale of *supported* brightness and that `On` is a separate, required characteristic (HAP/HAPCharacteristicTypes.h:55-73; HAP/HAPServiceTypes.h:81-89). Any coupling between `On = false` and `Brightness = 0` is accessory policy, not protocol.
- Brightness is **Int, not Float** — the format must be used exactly as the specification defines it, and the ADK calls Brightness out by name as the worked example of that rule: "in the specification the Brightness characteristic is defined to have type 'int'. Therefore, a HAPIntCharacteristic must be used for it" (HAP/HAP.h:227-237). Apple's controller documentation agrees: "The corresponding value is an integer representing a percentage of the maximum brightness" (/documentation/homekit/hmcharacteristictypebrightness).
- Hue and Saturation, by contrast, are **Float** (HAP/HAPCharacteristicTypes.h:248,626; /documentation/homekit/hmcharacteristictypehue, /documentation/homekit/hmcharacteristictypesaturation). Brightness Int vs. Hue/Saturation Float is a genuine asymmetry in the specification, not an error.

### Colour: Hue/Saturation vs. Color Temperature

- Hue is 0..360 arcdegrees, step 1; Saturation is 0..100 percent, step 1 (HAP/HAPCharacteristicTypes.h:244-261, 622-639). Apple describes the hue circle as "starting from red, through yellow, green, cyan, blue, and finally magenta, before wrapping back to red" (/documentation/homekit/hmcharacteristictypehue). Note the range is inclusive of both 0 and 360, which are the same colour; neither source says which the accessory should report.
- **Exclusivity rule:** "If this characteristic is included in the `Light Bulb`, `Hue` and `Saturation` must not be included as optional characteristics in `Light Bulb`. This characteristic must not be used for lamps which support color." (HAP/HAPCharacteristicTypes.h:2739-2740). So a Light Bulb service publishes *either* Hue+Saturation *or* Color Temperature, never both, and a colour-capable lamp must use Hue/Saturation.
- Color Temperature is in mirek / reciprocal megakelvin: `M = 1,000,000 / K` (HAP/HAPCharacteristicTypes.h:2736-2737). The ADK range is 50..400 mirek, step 1, Format UInt32 (HAP/HAPCharacteristicTypes.h:2745-2750) — i.e. 2500 K..20000 K. Apple's controller documentation gives the same conversion with a worked example: 3200 K tungsten ≈ 312 mired (/documentation/homekit/hmcharacteristictypecolortemperature).
- Color Temperature requires iOS 10.3 or later on the accessory-protocol side (HAP/HAPCharacteristicTypes.h:2742).
- Neither source specifies an ordering requirement between writes of Hue and Saturation (or between On and Brightness) — there is no "apply both together" transaction rule stated anywhere in either source for the Light Bulb service.

### Outlet In Use

- "This characteristic describes if the power outlet has an appliance e.g., a floor lamp, physically plugged in. This characteristic is set to 'True' even if the plugged-in appliance is off." (HAP/HAPCharacteristicTypes.h:555-560). It is therefore a *presence* signal, not a *power draw* signal, and it is explicitly independent of `On`.
- Apple's controller-side wording is looser — "set to `true` when the outlet is in use, and `false` otherwise" (/documentation/homekit/hmcharacteristictypeoutletinuse) — but does not contradict the accessory rule.
- It is `pr` + `ev` only; a controller that writes it gets `-70404` "Cannot write to read only characteristic" from the accessory (HAP/HAPCharacteristicTypes.h:561; HAP/HAPIPAccessoryServer.c:43-44, 946).

### Momentary / stateless controls

These rules apply to `Programmable Switch Event` and are the reason a stateless button cannot be modelled like an ordinary characteristic.

- The value is an **event, not a state**. "Reading this characteristic must return the last event triggered for BLE. For IP accessories, the accessory must set the value of Paired Read to null (i.e. `"value" : null`) in the attribute database. A read of this characteristic must always return a null value for IP accessories. The value must only be reported in the events ('ev') property." (HAP/HAPCharacteristicTypes.h:1382-1387)
- The ADK enforces this in three separate code paths rather than trusting the application: the characteristic's read handler is bypassed and a literal `null` is emitted in `GET /accessories` (HAP/HAPIPAccessory.c:891-902), in the characteristic-read response serializer (HAP/HAPIPAccessoryProtocol.c:652-665), and in the read dispatcher — but *only* when the session context is not an event notification, so the real value still flows on the event path (HAP/HAPIPAccessoryServer.c:1781-1786, 4255-4260). The log line is explicit: "Sending null value (readHandler callback is only called for HAP events)."
- **Notification coalescing is bypassed for this characteristic only.** The ADK coalesces IP event notifications with a delay of up to `kHAPIPAccessoryServer_MaxEventNotificationDelay` = 1 second (HAP/HAPIPAccessoryServer.c:143-146). `Programmable Switch Event` is whitelisted out of that: "Network-based notifications must be coalesced by the accessory using a delay of no less than 1 second. The exception to this rule includes notifications for the following characteristics which must be delivered immediately. … Section 6.8 Notifications" (HAP/HAPIPAccessoryServer.c:3279-3307).
- Values are `SinglePress = 0`, `DoublePress = 1`, `LongPress = 2`, with min 0, max 2, step 1 (HAP/HAPCharacteristicTypes.h:1392-1412). There is no "press and hold released" or "triple press" value in either source.
- Requires iOS 10.3 or later (HAP/HAPCharacteristicTypes.h:1389).
- **Multi-button rules**, stated as service-level rules in the ADK (HAP/HAPServiceTypes.h:510-519):
  - Each physical switch on the accessory must be represented by a unique instance of the service.
  - If there are multiple instances, they must be linked to a `Service Label`, and `Service Label Index` becomes a required characteristic.
  - `Service Label Index` must be unique among the instances linked to the same `Service Label`.
  - The user-visible label printed on the physical accessory should match the `Service Label Namespace` the accessory declares.
  - If there is only one instance of the service, `Service Label` is not required and `Service Label Index` **must not be present**.
- `Service Label Index` has minimum value 1 and step 1, and **no maximum is declared** in the ADK (HAP/HAPCharacteristicTypes.h:2688-2691) — so index numbering starts at 1, not 0.

### Constraint enforcement on the accessory side

- A write whose value violates `minimumValue` / `maximumValue` / `stepValue` is **rejected**, not clamped: `IS_VALUE_IN_RANGE` requires `value >= min && value <= max && (!step || (value - min) % step == 0)`, and the write handler returns `kHAPError_InvalidData` before the application handler is ever called (HAP/HAPCharacteristic.c:47-49, 414-431, 518-522 for UInt8; 1062-1083, 1143-1146 for Int; 1358-1361 for Float).
- Float **reads** are rounded to the declared step on the way out (`HAPFloatCharacteristicRoundValueToStep`, HAP/HAPCharacteristic.c:1288-1294), and float writes are range-checked with a tolerance rather than exactly (HAP/HAPCharacteristic.c:51-57). Integer formats get no such tolerance.
- `stepValue = 0` means "no step constraint" (Applications/Lightbulb/DB.c:349-353).
- The ADK's accessory validation rejects a database where `minimumValue > maximumValue`, where a negative step is declared, or where `validValues` / `validValuesRanges` are not sorted ascending (HAP/HAPAccessoryValidation.c:534-544, 548-607, 672-707). It does **not** validate that Apple-defined characteristics carry the ranges the specification assigns them, and it does **not** enforce the Light Bulb colour-exclusivity rule — no ADK source file outside the type headers mentions `ColorTemperature`, `Brightness`, `Hue` or `Saturation` at all.
- A service in which every characteristic is hidden must itself be marked hidden (HAP/HAPAccessoryValidation.c:724-734).
- Events are pushed with `HAPAccessoryServerRaiseEvent(server, characteristic, service, accessory)`, called by the application after its own state changes — the ADK does not raise events automatically on write (HAP/HAP.h:4291-4299; Applications/Lightbulb/App.c:162-178, 182-190).
- Subscribing to a characteristic whose `supportsEventNotification` is false returns `-70406` "Notification is not supported for characteristic" (HAP/HAPIPAccessoryServer.c:49-50, 891-892).

---

## HomeKit framework / Home app view

### Names and availability

| HAP name | HomeKit framework symbol | Availability |
|---|---|---|
| Light Bulb (service) | `HMServiceTypeLightbulb` | iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0, tvOS 10.0, visionOS 1.0, watchOS 2.0 (/documentation/homekit/hmservicetypelightbulb) |
| Switch (service) | `HMServiceTypeSwitch` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmservicetypeswitch) |
| Outlet (service) | `HMServiceTypeOutlet` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmservicetypeoutlet) |
| Stateless Programmable Switch (service) | `HMServiceTypeStatelessProgrammableSwitch` | iOS 9.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmservicetypestatelessprogrammableswitch) |
| Service Label (service) | `HMServiceTypeLabel` | iOS 10.3 / tvOS 10.2 / watchOS 3.2 (/documentation/homekit/hmservicetypelabel) |
| On | `HMCharacteristicTypePowerState` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmcharacteristictypepowerstate) |
| Brightness | `HMCharacteristicTypeBrightness` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmcharacteristictypebrightness) |
| Hue | `HMCharacteristicTypeHue` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmcharacteristictypehue) |
| Saturation | `HMCharacteristicTypeSaturation` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmcharacteristictypesaturation) |
| Color Temperature | `HMCharacteristicTypeColorTemperature` | iOS 11.0, iPadOS 11.0, Mac Catalyst 11.0, tvOS 11.0, visionOS 1.0, watchOS 4.0 (/documentation/homekit/hmcharacteristictypecolortemperature) |
| Outlet In Use | `HMCharacteristicTypeOutletInUse` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmcharacteristictypeoutletinuse) |
| Programmable Switch Event | `HMCharacteristicTypeInputEvent` | iOS 9.0 / tvOS 10.0 / watchOS 2.0 (/documentation/homekit/hmcharacteristictypeinputevent) |
| — (values of the above) | `HMCharacteristicValueInputEvent` (`.singlePress`, `.doublePress`, `.longPress`) | iOS 10.3, iPadOS 10.3, Mac Catalyst 10.3, tvOS 10.2, visionOS 1.0, watchOS 3.2 (/documentation/homekit/hmcharacteristicvalueinputevent) |

The framework name for HAP `On` is `PowerState`, and it is filed under "Power and switches" alongside `OutletInUse`, `OutputState` and `InputEvent`, not under "Light" (/documentation/homekit/hmcharacteristictypepowerstate). "Light" contains `CurrentLightLevel`, `Hue`, `Brightness`, `Saturation`, `ColorTemperature` (/documentation/homekit/hmcharacteristictypebrightness).

Note the availability split on Color Temperature: the ADK says the *characteristic* requires iOS 10.3+ (HAP/HAPCharacteristicTypes.h:2742), while Apple's framework constant `HMCharacteristicTypeColorTemperature` is marked iOS 11.0+ (/documentation/homekit/hmcharacteristictypecolortemperature). These are different things — protocol support vs. the public API symbol — and both are accurate as stated.

The three `HMCharacteristicValueInputEvent` cases are iOS 10.3+ even though `HMCharacteristicTypeInputEvent` itself is iOS 9.0+; before that enum existed the raw value had no public constant.

### Deprecations and replacements

- The only deprecation in this family on the accessory side is spelling: `kHAPServiceType_Lightbulb` → `kHAPServiceType_LightBulb`, and `kHAPServiceDebugDescription_Lightbulb` → `kHAPServiceDebugDescription_LightBulb` (HAP/HAPServiceTypes.h:99-103). The UUID is unchanged.
- Apple's framework symbol keeps the old spelling: `HMServiceTypeLightbulb`, not `HMServiceTypeLightBulb` (/documentation/homekit/hmservicetypelightbulb). This is a naming split between the two sources, not a deprecation.
- No deprecation is recorded in either source for On, Brightness, Hue, Saturation, Color Temperature, Outlet In Use or Programmable Switch Event.
- `HMCharacteristicEvent.updateTriggerValue(_:completionHandler:)` is marked deprecated (/documentation/homekit/hmcharacteristicevent); it is the API an app uses to re-target a characteristic-based automation trigger, which is how a stateless switch press drives a scene.

### HMCharacteristicMetadata expectations

`HMCharacteristicMetadata` is "Metadata that describes a characteristic's value and that may be useful for presentation purposes", and "Querying a characteristic's metadata enables you to build a user interface that reflects the underlying units, minima, and maxima, and other aspects of the characteristic value" (/documentation/homekit/hmcharacteristicmetadata). What an accessory publishes therefore drives controller UI directly:

- `minimumValue`, `maximumValue`, `stepValue` — each "only applies to characteristics with a number type" (/documentation/homekit/hmcharacteristicmetadata/minimumvalue, /maximumvalue, /stepvalue).
- `validValues` — "The subset of valid values supported by the characteristic when the format is of type unsigned integer" (iOS 10.0+) (/documentation/homekit/hmcharacteristicmetadata/validvalues). Only meaningful for UInt formats, so it applies to `Programmable Switch Event` and `Service Label Namespace` in this topic, and not to Brightness (Int), Hue/Saturation (Float) or On (Bool).
- `units` — Brightness and Saturation should surface `HMCharacteristicMetadataUnitsPercentage`; Hue should surface `HMCharacteristicMetadataUnitsArcDegree` (/documentation/homekit/hmcharacteristicmetadata/units, /documentation/homekit/characteristic-units). There is **no** unit constant for mirek, so Color Temperature has no `units` value to publish.
- `format` — expect `HMCharacteristicMetadataFormatInt` for Brightness, `…FormatFloat` for Hue and Saturation, `…FormatUInt32` for Color Temperature, `…FormatBool` for On and Outlet In Use, `…FormatUInt8` for Programmable Switch Event (/documentation/homekit/characteristic-data-formats, cross-referenced with the ADK formats above).
- `properties` carries only `HMCharacteristicPropertyReadable`, `HMCharacteristicPropertyWritable` and `HMCharacteristicPropertyHidden` on the controller side (/documentation/homekit/characteristic-properties) — notify support is exposed separately through `enableNotification(_:completionHandler:)` / `isNotificationEnabled` (/documentation/homekit/hmcharacteristic/enablenotification(_:completionhandler:)).

### What the controller enforces and how it presents the service

- HomeKit validates numeric writes against the published metadata before they reach the accessory: `HMError.Code.valueHigherThanMaximum` "An attempt to use a numeric value higher than the specified maximum value" and `valueLowerThanMinimum` "An attempt to use a numeric value lower than the specified minimum value" (/documentation/homekit/hmerror/code/valuehigherthanmaximum, /documentation/homekit/hmerror/code/valuelowerthanminimum). A wrong value type gives `invalidValueType` (/documentation/homekit/hmerror/code/invalidvaluetype).
- Writing a characteristic without write permission gives `readOnlyCharacteristic`; reading a write-only one gives `writeOnlyCharacteristic` (/documentation/homekit/hmerror/code/readonlycharacteristic, /writeonlycharacteristic).
- Enabling notifications on a characteristic that does not advertise them gives `notificationNotSupported` (/documentation/homekit/hmerror/code/notificationnotsupported).
- `HMCharacteristic.value` is only "the last value that the system saw"; apps are told to call `readValue(completionHandler:)` to be current, and delegates receive `accessory(_:service:didUpdateValueFor:)` only "as a result of a change in value initiated by the accessory. Programmatic changes initiated by the app do not result in this method being called" (/documentation/homekit/hmcharacteristic/value, /documentation/homekit/hmaccessorydelegate/accessory(_:service:didupdatevaluefor:)).
- **Switch and Outlet are special in the Home app**: `associatedServiceType` is "The type of the service associated with an outlet or a switch … a lamp plugged into an outlet associates a lightbulb service with the outlet, even if the lamp itself is not a supported HomeKit accessory. The associated service can be any service defined by the HomeKit Accessory Profile that supports `HMCharacteristicTypePowerState`, other than `HMServiceTypeOutlet` or `HMServiceTypeSwitch`." (/documentation/homekit/hmservice/associatedservicetype). The user can change this at any time and the accessory is told nothing — it is controller-side state (/documentation/homekit/hmaccessorydelegate/accessory(_:didupdateassociatedservicetypefor:)).
- Each service the user names appears in the Home app as its own tile; the HomeKit object that the user sees as an "accessory" is an `HMService`, owned by an `HMAccessory` representing the physical device (/documentation/homekit/configuring-a-home-automation-device).
- `isPrimaryService` (iOS 10.0+) and `isUserInteractive` (iOS 9.0+) are read-only controller-side reflections of what the accessory declared (/documentation/homekit/hmservice/isprimaryservice, /isuserinteractive).
- A stateless switch press is consumed by automations through `HMCharacteristicEvent`, whose `triggerValue` of `nil` "corresponds to any change in the value of the characteristic" (/documentation/homekit/hmcharacteristicevent/triggervalue) — which is exactly how a `null`-reading, event-only characteristic is usable as a trigger.
- Reachability is an accessory-level, not characteristic-level, concept on the controller: `HMAccessory.isReachable`, with `accessoryDidUpdateReachability(_:)` and the errors `accessoryNotReachable` (the accessory/bridge itself) and `bridgedAccessoryNotReachable` (one accessory behind a reachable bridge) (/documentation/homekit/hmaccessory/isreachable, /documentation/homekit/hmerror/code/accessorynotreachable).
- Relevant accessory categories: `HMAccessoryCategoryTypeLightbulb`, `HMAccessoryCategoryTypeSwitch`, `HMAccessoryCategoryTypeOutlet`, `HMAccessoryCategoryTypeProgrammableSwitch` (all iOS 9.0+) (/documentation/homekit/hmaccessorycategorytypelightbulb and siblings). The ADK's Light Bulb example sets `.category = kHAPAccessoryCategory_Lighting` at the accessory level, not per service (Applications/Lightbulb/App.c:124-125).

---

## Implications for a bridge plugin

**Types and ranges**

1. Publish Brightness as **Int** with min 0, max 100, step 1, unit percentage — never Float. The ADK names this exact characteristic as the example of the "format must match the specification" rule (HAP/HAP.h:227-237).
2. Publish Hue as **Float** 0..360 step 1 arcdegrees and Saturation as **Float** 0..100 step 1 percentage (HAP/HAPCharacteristicTypes.h:244-261, 622-639). Do not "simplify" them to Int to match Brightness.
3. Publish Color Temperature as **UInt32** in mirek with min 50 and max 400 unless your device's real range is narrower, in which case narrow it — publishing a range your device cannot reach means the Home app will send values you must then fudge. INFERRED (from the ADK range being the outer bound and the controller enforcing published metadata: /documentation/homekit/hmerror/code/valuehigherthanmaximum).
4. Convert Kelvin to mirek as `round(1000000 / K)` and back as `round(1000000 / M)` (HAP/HAPCharacteristicTypes.h:2736-2737; /documentation/homekit/hmcharacteristictypecolortemperature). Remember mirek is *inverse*: a larger mirek value is a warmer, lower-Kelvin light. Clamp the result into the advertised min/max before publishing it, because an out-of-range value is rejected outright rather than clamped by the HAP layer (HAP/HAPCharacteristic.c:414-431).
5. Never invent a `units` string for Color Temperature — no such constant exists in either source (HAP/HAP.h:505-538; /documentation/homekit/characteristic-units).

**Service composition**

6. A Light Bulb needs only `On`. Add Brightness only if the device actually dims; a fake Brightness that snaps 0→100 gives the user a slider that lies. (Required/optional per HAP/HAPServiceTypes.h:81-89.)
7. Expose **either** Hue+Saturation **or** Color Temperature on one Light Bulb service, never both, and use Hue/Saturation for any lamp that can produce colour (HAP/HAPCharacteristicTypes.h:2739-2740). Nothing in the ADK enforces this at runtime, so the plugin must enforce it itself.
8. For a colour lamp whose backend speaks CCT as well as RGB, expose Hue/Saturation and translate CCT into it internally; do not add a second Light Bulb service just to carry Color Temperature. INFERRED (from the exclusivity rule plus "This characteristic must not be used for lamps which support color", HAP/HAPCharacteristicTypes.h:2739-2740).
9. Use `Switch` for a bare relay and `Outlet` for a socket. Outlet requires **both** `On` and `Outlet In Use` — a plugin that exposes Outlet with only `On` is publishing an invalid service (HAP/HAPServiceTypes.h:159-161).
10. If the backend cannot tell whether anything is plugged in, prefer `Switch` over `Outlet` rather than hard-coding `Outlet In Use = true`. INFERRED (from the characteristic's defined meaning, "has an appliance … physically plugged in", HAP/HAPCharacteristicTypes.h:555-560).
11. `Outlet In Use` must be `true` whenever something is plugged in **even when `On` is false** — do not derive it from power draw or from `On` (HAP/HAPCharacteristicTypes.h:555-560).
12. Set exactly one user-facing service per accessory as the primary service, as the ADK example does (Applications/Lightbulb/DB.c:473). Remember each named service becomes its own Home app tile (/documentation/homekit/configuring-a-home-automation-device).

**Events**

13. Give `On`, `Brightness`, `Hue`, `Saturation`, `Color Temperature` and `Outlet In Use` the notify permission and actually raise events when the physical device changes by itself (a wall switch, an app, a schedule). Controllers only hear about accessory-initiated changes through notifications (/documentation/homekit/hmcharacteristic/value), and subscribing to a non-notifying characteristic fails with `notificationNotSupported` (/documentation/homekit/hmerror/code/notificationnotsupported; HAP/HAPIPAccessoryServer.c:891-892).
14. Suppress the event when the value did not actually change, as Apple's reference handler does (Applications/Lightbulb/App.c:162-178).
15. Do not rely on being able to push more than one state change per second for ordinary characteristics — IP notifications are coalesced with a delay of up to 1 second (HAP/HAPIPAccessoryServer.c:143-146). Design brightness ramps and colour fades to publish an endpoint, not every intermediate frame. INFERRED (from the coalescing window).

**Stateless / momentary controls**

16. Model a physical button as `Stateless Programmable Switch`, never as a `Switch` that the plugin flips back after a delay. A self-resetting `Switch` is a state characteristic being abused as an event and shows up in the Home app as a toggle rather than as a trigger. INFERRED (from the event-only semantics of `Programmable Switch Event`, HAP/HAPCharacteristicTypes.h:1382-1387, and from `HMCharacteristicValueInputEvent` describing what the switch "detected", /documentation/homekit/hmcharacteristicvalueinputevent/singlepress).
17. `Programmable Switch Event` must be `pr` + `ev` with **no write permission**, and a read over IP must yield `null` (HAP/HAPCharacteristicTypes.h:1382-1387; HAP/HAPIPAccessory.c:891-902). If the bridge library caches "last value" and serves it on read, that is a protocol violation — return `null`.
18. Advertise min 0, max 2, step 1 and, if the library supports `validValues`, advertise **only the press types the hardware can actually produce** (e.g. `[0]` for a single-action button). `validValues` is meaningful precisely because this is a UInt format (/documentation/homekit/hmcharacteristicmetadata/validvalues), and it stops the Home app offering "Double Press" automations the button can never fire. INFERRED (from validValues semantics; neither source states a per-button subset requirement).
19. Deliver the press immediately — do not batch it behind a debounce/aggregation queue. This is the one characteristic in this topic explicitly exempted from notification coalescing (HAP/HAPIPAccessoryServer.c:3279-3307).
20. One physical button = one service instance. For a multi-button remote, add a `Service Label` service with `Service Label Namespace`, link every switch instance to it, and give each instance a unique `Service Label Index` starting at 1 (HAP/HAPServiceTypes.h:510-519; HAP/HAPCharacteristicTypes.h:2688-2691).
21. For a **single**-button accessory, omit `Service Label` *and* `Service Label Index` — the index "must not be present" when there is only one instance (HAP/HAPServiceTypes.h:518-519).
22. Choose the `Service Label Namespace` value that matches what is printed on the hardware: `Dots = 0` for ". / .. / ..." markings, `ArabicNumerals = 1` for "1 / 2 / 3" (HAP/HAPCharacteristicTypes.h:2724-2730; HAP/HAPServiceTypes.h:516-517).

**Writes and validation**

23. Do not expect the HAP layer to clamp: a write outside min/max/step is rejected with `kHAPError_InvalidData` before your handler runs (HAP/HAPCharacteristic.c:414-431, 1143-1146, 1358-1361). Conversely, the controller will not normally send such a value, because it validates against your published metadata first (/documentation/homekit/hmerror/code/valuehigherthanmaximum). The failure mode to guard against is *your own* code publishing an out-of-range value on the read/notify path.
24. Never use `requiresTimedWrite` on lighting or switch characteristics; the ADK reserves it for security-sensitive targets such as locks (Applications/Lightbulb/DB.c:455; Applications/Lock/DB.c:489).
25. Do not publish `Name` as writable. In the ADK reference database the per-service `Name` is `pr` only (Applications/Lightbulb/DB.c:421-440; HAP/HAPCharacteristicTypes.h:502-508); renaming is a controller-side concern.

**Unreachable devices**

26. When the backend device is offline, fail the read or write rather than inventing a value. HomeKit distinguishes `accessoryNotReachable` (the bridge itself) from `bridgedAccessoryNotReachable` (one accessory behind a healthy bridge), and the latter is the honest signal for a dead device behind a running bridge (/documentation/homekit/hmerror/code/accessorynotreachable; /documentation/homekit/hmerror). INFERRED as a *policy* recommendation: neither source prescribes how a bridge must behave when its backend is unreachable, only what error codes exist to describe it.
27. Do not raise events for a device you cannot reach; a stale-but-unchanged cached value is less misleading than a fabricated one. INFERRED.

**Home app presentation**

28. You cannot control whether the Home app shows your Switch as a light, a fan or a switch — the user sets `associatedServiceType` and the accessory is never told (/documentation/homekit/hmservice/associatedservicetype; /documentation/homekit/hmaccessorydelegate/accessory(_:didupdateassociatedservicetypefor:)). If the thing genuinely *is* a light, publish `Light Bulb`, not `Switch` with a hint. INFERRED from those two pages.
29. Set the accessory category to match the dominant service (`Lighting`, `Switches`, `Outlets`, `ProgrammableSwitches`) — it is an accessory-level field set once, not per service (Applications/Lightbulb/App.c:124-125).

---

## Discrepancies between sources

1. **Color Temperature range and format.** The ADK gives UInt32, min 50, max 400 (HAP/HAPCharacteristicTypes.h:2745-2750). The hap-nodejs 2.2.2 reference bundled in this project's research material lists Color Temperature as `int`, min 140, max 500 (`scratchpad/hapnodejs-2.2.2-reference.md`, Lightbulb optional table). Apple's framework page states neither. **The ADK wins for what the protocol defines**; but note that a bridge built on hap-nodejs will inherit 140..500 (≈2000 K..7143 K) as its default, which is a *narrower, warmer* band inside the ADK's 50..400 — these are inconsistent in both directions and a plugin should set the range explicitly rather than accept a library default.
2. **`Name` required vs. optional.** The ADK lists `Name` as an *optional* characteristic of Light Bulb, Switch and Outlet (HAP/HAPServiceTypes.h:84-89, 163-164, 183-184). The hap-nodejs reference lists `Name` under "Required" for all three. The ADK wins; the reference implementation in `Applications/Lightbulb/DB.c:421-440` does include a Name characteristic, so including it is correct practice even though it is not mandatory.
3. **Service spelling.** ADK `kHAPServiceType_LightBulb` (deprecating `Lightbulb`) vs. Apple's `HMServiceTypeLightbulb`. Same UUID `0x43`; no action needed beyond not assuming one spelling is wrong (HAP/HAPServiceTypes.h:95-103; /documentation/homekit/hmservicetypelightbulb).
4. **Color Temperature OS requirement.** ADK says iOS 10.3 or later (HAP/HAPCharacteristicTypes.h:2742); Apple's API page says iOS 11.0 (/documentation/homekit/hmcharacteristictypecolortemperature). Not a contradiction — protocol support predates the public framework constant — but quote the right one for the right audience.
5. **Adaptive-lighting characteristics.** The hap-nodejs reference lists `Characteristic Value Active Transition Count` (`0x24B`), `Characteristic Value Transition Control` (`0x143`) and `Supported Characteristic Value Transition Configuration` (`0x144`) as optional Light Bulb characteristics. **Neither primary source contains these**: they do not appear in this ADK revision's `HAPCharacteristicTypes.h`/`.c`, and no Apple page in the crawl documents them. Treat them as out of scope for this reference; anything a plugin does with adaptive lighting is unsourced here.

## Open questions (unanswered by both sources)

- Whether `Brightness = 0` is required to mean, or is permitted to mean, "off", and whether writing `Brightness = 0` should drive `On` to `false` (or writing `On = true` should restore a previous brightness). Neither source states any coupling.
- Whether an accessory should report Hue `0` or `360` for red, given the inclusive 0..360 range.
- Whether `On` and `Brightness` (or `Hue` and `Saturation`) written in the same controller batch must be applied atomically, and in what order — no ordering or transaction rule appears in either source for this service family.
- What a Light Bulb should do with a Brightness write while `On` is false: apply it silently, apply and turn on, or reject. Unspecified.
- The maximum permitted `Service Label Index`, and therefore the maximum number of buttons on one labelled accessory — the ADK declares a minimum of 1 and a step of 1 but no maximum (HAP/HAPCharacteristicTypes.h:2688-2691).
- Whether an accessory may narrow `Programmable Switch Event` via `validValues` to advertise only the press types it supports — permitted by the metadata model, but neither source says a controller honours it for this characteristic.
- Whether there is any debounce or minimum interval between consecutive `Programmable Switch Event` notifications, or any defined behaviour when two presses occur inside one event-delivery cycle. The coalescing exemption says "deliver immediately" but says nothing about ordering or loss.
- What a bridge should report for a characteristic whose backend device is unreachable (error status vs. last known value vs. a default). HomeKit defines `bridgedAccessoryNotReachable` as a controller-side error code but neither source prescribes accessory behaviour.
- Whether the Home app renders a Light Bulb differently depending on which optional characteristics are present (e.g. colour wheel vs. temperature slider vs. plain toggle). No source in this crawl documents Home app rendering rules.
- Whether `Outlet In Use` is expected to be derived from measured current, and what threshold applies, for outlets that can only infer presence electrically.
