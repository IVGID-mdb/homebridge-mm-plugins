# Heating, cooling and temperature

This is the authoritative reference for the HomeKit services and characteristics an accessory bridge uses to model heating, cooling and temperature: the `HeaterCooler`, `Thermostat` and `TemperatureSensor` services, and the characteristics `Active`, `CurrentHeaterCoolerState`, `TargetHeaterCoolerState` (including the valid-values mechanism that restricts which modes a controller offers), `CurrentTemperature`, `HeatingThresholdTemperature`, `CoolingThresholdTemperature`, `TargetTemperature`, `TemperatureDisplayUnits`, `RotationSpeed` when carried on `HeaterCooler`, and `SwingMode`. Every temperature value on the wire is degrees Celsius regardless of what the accessory or the Home app displays; `TemperatureDisplayUnits` is presentation metadata only. Ranges and step values below are the Apple-defined defaults documented for each characteristic — an accessory may narrow a range, but the units and the enumerated value meanings are fixed.

**Sources.** HomeKitADK commit `fb201f98` (2021-10-23), files under `HAP/` and `Applications/`; Apple developer documentation for the HomeKit framework, crawled 2026-09-12 (cited by page path). Where the two disagree, the disagreement is called out explicitly. Citations name the file and line, e.g. `(HAP/HAPCharacteristicTypes.h:2215)`, or the Apple page path, e.g. `(/documentation/homekit/hmcharacteristictyperotationspeed)`.

---

## Service: HeaterCooler

Short UUID `0000BC`, debug description `"heater-cooler"`, HAP spec R14 §8.18, requires iOS 10.3 or later per the ADK (HAP/HAPServiceTypes.c:75; HAP/HAPServiceTypes.h:860-899). The service describes a heater, a cooler, or a combined heater and cooler (HAP/HAPServiceTypes.h:862-865).

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values (name = value: meaning) | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Active | `B0` | UInt8 | none | 0 / 1 / 1 | `Inactive = 0`: service not active; `Active = 1`: service active | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.c:175; HAP/HAPCharacteristicTypes.h:2146-2171 |
| Current Temperature | `11` | Float | Celsius | 0 / 100 / 0.1 | — (continuous) | pr, ev | Required | HAP/HAPCharacteristicTypes.c:23; HAP/HAPCharacteristicTypes.h:195-213 |
| Current Heater Cooler State | `B1` | UInt8 | none | 0 / 3 / 1 | `Inactive = 0`; `Idle = 1`; `Heating = 2`; `Cooling = 3` | pr, ev | Required | HAP/HAPCharacteristicTypes.c:177; HAP/HAPCharacteristicTypes.h:2175-2207 |
| Target Heater Cooler State | `B2` | UInt8 | none | 0 / 2 / 1 | `HeatOrCool = 0`: hold between the two thresholds; `Heat = 1`: heat only; `Cool = 2`: cool only | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.c:179; HAP/HAPCharacteristicTypes.h:2211-2254 |
| Name | `23` | String | none | — (no min/max/step; must not be null) | — | pr | Optional | HAP/HAPCharacteristicTypes.c:49; HAP/HAPCharacteristicTypes.h:503-516 |
| Rotation Speed | `29` | Float | Percentage | 0 / 100 / 1 | — (continuous percentage) | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.c:59; HAP/HAPCharacteristicTypes.h:601-618 |
| Temperature Display Units | `36` | UInt8 | none | 0 / 1 / 1 | `Celsius = 0`; `Fahrenheit = 1` | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.c:73; HAP/HAPCharacteristicTypes.h:770-795 |
| Swing Mode | `B6` | UInt8 | none | 0 / 1 / 1 | `Disabled = 0`: swing off; `Enabled = 1`: swing on | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.c:187; HAP/HAPCharacteristicTypes.h:2360-2385 |
| Cooling Threshold Temperature | `0D` | Float | Celsius | 10 / 35 / 0.1 | — (continuous) | pr, pw, ev | Optional in the list, but mandatory for any accessory that cools | HAP/HAPCharacteristicTypes.c:15; HAP/HAPCharacteristicTypes.h:77-100; HAP/HAPServiceTypes.h:871 |
| Heating Threshold Temperature | `12` | Float | Celsius | 0 / 25 / 0.1 | — (continuous) | pr, pw, ev | Optional in the list, but mandatory for any accessory that heats | HAP/HAPCharacteristicTypes.c:25; HAP/HAPCharacteristicTypes.h:217-240; HAP/HAPServiceTypes.h:871 |
| Lock Physical Controls | `A7` | UInt8 | none | 0 / 1 / 1 | `Disabled = 0`; `Enabled = 1` | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.c:159; HAP/HAPCharacteristicTypes.h:1913-1940 |

`HeaterCooler` has **no** `Target Temperature` and **no** humidity characteristics in either list (HAP/HAPServiceTypes.h:878-891). Its setpoints are the two threshold characteristics.

## Service: Thermostat

Short UUID `00004A`, debug description `"thermostat"`, HAP spec R14 §8.42 (HAP/HAPServiceTypes.c:25; HAP/HAPServiceTypes.h:196-220). No iOS floor is stated in the ADK header for this service.

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values (name = value: meaning) | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current Heating Cooling State | `0F` | UInt8 | none | 0 / 2 / 1 | `Off = 0`; `Heat = 1`: heater is currently on; `Cool = 2`: cooler is currently on | pr, ev | Required | HAP/HAPCharacteristicTypes.c:19; HAP/HAPCharacteristicTypes.h:141-168 |
| Target Heating Cooling State | `33` | UInt8 | none | 0 / 3 / 1 | `Off = 0`; `Heat = 1`: heat if current temp below target; `Cool = 2`: cool if current temp above target; `Auto = 3`: hold within the heating/cooling thresholds of the target | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.c:67; HAP/HAPCharacteristicTypes.h:688-721 |
| Current Temperature | `11` | Float | Celsius | 0 / 100 / 0.1 | — | pr, ev | Required | HAP/HAPCharacteristicTypes.c:23; HAP/HAPCharacteristicTypes.h:195-213 |
| Target Temperature | `35` | Float | Celsius | 10.0 / 38.0 / 0.1 | — | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.c:71; HAP/HAPCharacteristicTypes.h:747-766 |
| Temperature Display Units | `36` | UInt8 | none | 0 / 1 / 1 | `Celsius = 0`; `Fahrenheit = 1` | pr, pw, ev | Required | HAP/HAPCharacteristicTypes.c:73; HAP/HAPCharacteristicTypes.h:770-795 |
| Cooling Threshold Temperature | `0D` | Float | Celsius | 10 / 35 / 0.1 | — | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.c:15; HAP/HAPCharacteristicTypes.h:77-100 |
| Heating Threshold Temperature | `12` | Float | Celsius | 0 / 25 / 0.1 | — | pr, pw, ev | Optional | HAP/HAPCharacteristicTypes.c:25; HAP/HAPCharacteristicTypes.h:217-240 |
| Current Relative Humidity | `10` | Float | Percentage | 0 / 100 / 1 | — | pr, ev | Optional (out of this topic's scope) | HAP/HAPCharacteristicTypes.c:21; HAP/HAPCharacteristicTypes.h:~171-193 |
| Target Relative Humidity | `34` | Float | Percentage | 0 / 100 / 1 | — | pr, pw, ev | Optional (out of this topic's scope) | HAP/HAPCharacteristicTypes.c:69; HAP/HAPCharacteristicTypes.h:~724-745 |
| Name | `23` | String | none | — | — | pr | Optional | HAP/HAPCharacteristicTypes.c:49; HAP/HAPCharacteristicTypes.h:503-516 |

`Thermostat` does **not** list `Active`, `RotationSpeed`, `SwingMode` or `Lock Physical Controls` (HAP/HAPServiceTypes.h:200-212).

## Service: TemperatureSensor

Short UUID `00008A`, debug description `"sensor.temperature"`, HAP spec R14 §8.41 (HAP/HAPServiceTypes.c:51; HAP/HAPServiceTypes.h:540-562).

| Characteristic | UUID (short) | Format | Units | Min/Max/Step | Valid values (name = value: meaning) | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current Temperature | `11` | Float | Celsius | 0 / 100 / 0.1 | — | pr, ev | Required | HAP/HAPCharacteristicTypes.c:23; HAP/HAPCharacteristicTypes.h:195-213 |
| Name | `23` | String | none | — | — | pr | Optional | HAP/HAPCharacteristicTypes.c:49; HAP/HAPCharacteristicTypes.h:503-516 |
| Status Active | `75` | Bool | none | — | `true`: accessory is active and functioning without errors | pr, ev | Optional | HAP/HAPCharacteristicTypes.c:121; HAP/HAPCharacteristicTypes.h:1416-1432 |
| Status Fault | `77` | UInt8 | none | 0 / 1 / 1 | `None = 0`: no fault; `General = 1`: fault that may interfere with intended functionality | pr, ev | Optional | HAP/HAPCharacteristicTypes.c:125; HAP/HAPCharacteristicTypes.h:1466-1493 |
| Status Low Battery | `79` | UInt8 | none | 0 / 1 / 1 | `Normal = 0`; `Low = 1` | pr, ev | Optional | HAP/HAPCharacteristicTypes.c:129; HAP/HAPCharacteristicTypes.h:1528-1554 |
| Status Tampered | `7A` | UInt8 | none | 0 / 1 / 1 | `NotTampered = 0`; `Tampered = 1` | pr, ev | Optional | HAP/HAPCharacteristicTypes.c:131; HAP/HAPCharacteristicTypes.h:1558-1584 |

### Notes on the table columns

- **UUID (short form).** The ADK builds each type with `HAPUUIDCreateAppleDefined(0x…)`; the short forms above are those constants, which expand to the usual `0000003E-0000-1000-8000-0026BB765291`-style Apple base UUID. Service UUIDs: Thermostat `4A`, TemperatureSensor `8A`, HeaterCooler `BC` (HAP/HAPServiceTypes.c:25,51,75).
- **Perms.** `pr` = Paired Read (`properties.readable`), `pw` = Paired Write (`properties.writable`), `ev` = Notify (`properties.supportsEventNotification`) (HAP/HAP.h:309,317,322-329). Over IP these are emitted in the fixed order `pr`, `pw`, `ev`, `aa`, `tw`, `wr`, `hd` (HAP/HAPIPAccessory.c:1009-1066).
- **Units.** The only unit vocabulary HAP has is `None`, `Celsius`, `ArcDegrees`, `Percentage`, `Lux`, `Seconds` (HAP/HAP.h:510-538), serialized on IP as `"unit":"celsius"` / `"percentage"` etc. (HAP/HAPIPAccessoryProtocol.c:798-844). There is no Fahrenheit unit on the wire.

---

## Semantics and rules

### Power and state

- `Active` means "the service is currently active"; it is the power control for `HeaterCooler`, with exactly two values, `Inactive = 0` and `Active = 1` (HAP/HAPCharacteristicTypes.h:2146-2171).
- `CurrentHeaterCoolerState` reports what the equipment is doing right now, with four values: `Inactive = 0`, `Idle = 1`, `Heating = 2`, `Cooling = 3`; it is read-only plus notify (HAP/HAPCharacteristicTypes.h:2175-2207). Apple's controller-side enumeration gives the same four cases with the same meanings: inactive, idle, "actively heating", "actively cooling" (/documentation/homekit/hmcharacteristicvaluecurrentheatercoolerstate). That `Inactive` corresponds to `Active = 0` while `Idle` means powered but neither heating nor cooling is the only consistent reading, but neither source states the mapping in those words — INFERRED.
- `Thermostat` uses a different state family: `CurrentHeatingCoolingState` has three values (`Off = 0`, `Heat = 1` "The Heater is currently on", `Cool = 2` "Cooler is currently on") (HAP/HAPCharacteristicTypes.h:141-168), and `TargetHeatingCoolingState` has four (`Off/Heat/Cool/Auto`) (HAP/HAPCharacteristicTypes.h:688-721). Apple keeps these as separate constants from the heater-cooler family and describes them as thermostat modes (/documentation/homekit/hmcharacteristictypetargetheatingcooling, /documentation/homekit/hmcharacteristictypecurrentheatingcooling). Do not mix the two families on one service.

### Target state and the threshold setpoints

- `"Heat or Cool" state must only be included for accessories which include both a cooler and a heater.` (HAP/HAPCharacteristicTypes.h:2215) A heat-only device must therefore not offer `TargetHeaterCoolerState = 0`.
- In `HeatOrCool` (0), the accessory always tries to keep `CurrentTemperature` between `HeatingThresholdTemperature` and `CoolingThresholdTemperature`, starting heating or cooling when the temperature falls below or rises above the respective threshold (HAP/HAPCharacteristicTypes.h:2216-2219).
- In `Heat` (1) the accessory starts heating when the current temperature is below `HeatingThresholdTemperature`; in `Cool` (2) it starts cooling when the current temperature is above `CoolingThresholdTemperature` (HAP/HAPCharacteristicTypes.h:2221-2223). The `HeaterCooler` setpoints are the thresholds, never `TargetTemperature`.
- A heater must include `HeatingThresholdTemperature`; a cooler must include `CoolingThresholdTemperature` (HAP/HAPServiceTypes.h:871). The "optional" classification in the characteristic list is therefore conditional, not free.
- For `Thermostat`, the thresholds are defined relative to `TargetHeatingCoolingState = Auto`: above the cooling threshold the cooling mechanism should turn on, below the heating threshold the heating mechanism should turn on (HAP/HAPCharacteristicTypes.h:83-85, 223-225). `Auto` is documented as maintaining temperature within the heating and cooling threshold of the target temperature (HAP/HAPCharacteristicTypes.h:713-718).
- Apple describes the same two characteristics from the controller side: `HMCharacteristicTypeCoolingThreshold` is "The temperature above which cooling will be active" and `HMCharacteristicTypeHeatingThreshold` "The temperature below which heating will be active", both floating-point degrees Celsius (/documentation/homekit/hmcharacteristictypecoolingthreshold, /documentation/homekit/hmcharacteristictypeheatingthreshold).
- Neither source states a rule that `HeatingThresholdTemperature` must be less than `CoolingThresholdTemperature`, nor a minimum dead band between them. Nothing in the ADK enforces a cross-characteristic ordering; the validation layer only checks each characteristic's own min/max/step (HAP/HAPAccessoryValidation.c:691-710).

### Temperature values and display units

- `CurrentTemperature` "describes the current temperature of the environment in Celsius irrespective of display units chosen in `Temperature Display Units`" (HAP/HAPCharacteristicTypes.h:195-198). It is read-only plus notify: a controller never writes it.
- `TargetTemperature` is the temperature the accessory is actively attempting to reach, in Celsius; the ADK's own example converts 75 °F to 23.9 °C for storage (HAP/HAPCharacteristicTypes.h:747-756).
- `TemperatureDisplayUnits` exists "for presentation purposes (e.g. the units of temperature displayed on the screen)" (HAP/HAPCharacteristicTypes.h:770-774). It changes no value on the wire. Apple states the controller-side contract directly: "HomeKit always reports temperature values in degrees Celsius, but your app should display the temperature in units chosen by the user." (/documentation/homekit/hmcharacteristictypetemperatureunits)
- Float writes are validated against `minimumValue`/`maximumValue` and, unless `stepValue` is zero, must land within a tolerance of a step multiple; the tolerance actually applied is `0.1f` of one step, after which the value is rounded to the nearest step before the handler sees it (HAP/HAPCharacteristic.c:51-56, 60-62, 1269, 1288-1293, 1336, 1364). So a controller write of 21.03 against step 0.1 arrives at the accessory as 21.0.

### Fan speed and swing on a HeaterCooler

- A heater/cooler accessory "may include `Rotation Speed` to control fan speed if the fan cannot be independently controlled" (HAP/HAPServiceTypes.h:873-874). If the fan *can* be controlled independently, the accessory should carry a separate `Fan` service instead, and a `Slat` service for vents (HAP/HAPServiceTypes.h:867-869). The two arrangements are alternatives.
- `RotationSpeed` is a Float percentage, 0 to 100, step 1 (HAP/HAPCharacteristicTypes.h:601-618). Apple: "The corresponding value is a floating point number representing the percentage of the maximum speed." (/documentation/homekit/hmcharacteristictyperotationspeed) It is a percentage, not an RPM and not a step index.
- `SwingMode` is `Disabled = 0` / `Enabled = 1` (HAP/HAPCharacteristicTypes.h:2360-2385); the service header describes swing mode as the slats swinging automatically (HAP/HAPServiceTypes.h:770). Apple: "The fan remains in a fixed position" vs "The fan swings back and forth" (/documentation/homekit/hmcharacteristicvalueswingmode).
- `RotationDirection` is offered only on the `Fan` service, not on `HeaterCooler` (HAP/HAPServiceTypes.h:885-891).

### Restricting an enumeration: valid values

- Valid-value restriction is a **UInt8-only** mechanism: only `HAPUInt8Characteristic` carries `constraints.validValues` and `constraints.validValuesRanges`; float characteristics carry only `minimumValue`/`maximumValue`/`stepValue` (HAP/HAP.h:1244-1268 vs 2569-2573). `TargetHeaterCoolerState`, `TargetHeatingCoolingState`, `Active`, `SwingMode` and `TemperatureDisplayUnits` can be restricted this way; `RotationSpeed` and the temperatures cannot.
- Both constraint fields are documented as "Only supported for Apple defined characteristics" (HAP/HAP.h:1250-1258), and the IP serializer enforces exactly that: it emits `"valid-values"` / `"valid-values-range"` only when `HAPUUIDIsAppleDefined(...)` holds for that characteristic (HAP/HAPIPAccessory.c:1518-1531, 1573, 1643). Over BLE the same data is carried as the HAP-Param-HAP-Valid-Values-Descriptor and HAP-Param-HAP-Valid-Values-Range-Descriptor (HAP/HAPBLEPDU+TLV.c:698-736, 763-805).
- An accessory must not declare both `validValues` and `validValuesRanges` on the same characteristic (HAP/HAPAccessoryValidation.c:548-559). `validValues` must be sorted strictly ascending with no duplicates (HAP/HAPAccessoryValidation.c:562-579, and the BLE serializer asserts the same at HAP/HAPBLEPDU+TLV.c:729); ranges must have `start <= end` and be sorted and non-overlapping (HAP/HAPAccessoryValidation.c:580-606).
- Once a restricted set is declared, a write of any value outside it is rejected at the HAP layer before the accessory's write handler runs, and reads are asserted to return only in-set values (HAP/HAPCharacteristic.c:385-412, 414-459). Narrowing `minValue`/`maxValue` alone is not the documented mechanism for an enumeration; the valid-values list is.
- Apple's controller side reads the same restriction as `HMCharacteristicMetadata.validValues`, "The subset of valid values supported by the characteristic when the format is of type unsigned integer" (iOS 10.0+) (/documentation/homekit/hmcharacteristicmetadata/validvalues).

### Events and notifications

- A characteristic marked `supportsEventNotification` requires a read handler, may be subscribed to only by controllers with a secured connection, and obliges the accessory: "When the characteristic state changes, the `HAPAccessoryServerRaiseEvent` or `HAPAccessoryServerRaiseEventOnSession` function must be called." (HAP/HAP.h:322-329) The API raises the event to all subscribed sessions, or to one session (HAP/HAP.h:4291-4320).
- The ADK does not raise events by itself on a controller write; the application does it, and Apple's own sample raises the event only when the written value actually differs from the stored state (`Applications/Lightbulb/App.c:168-176`). Hardware-originated changes are forwarded the same way through a notification hook (`Applications/Lightbulb/App.c:181-190`).
- Apple states the controller-side consequence: "You only receive updates for changes made outside your app, for example by Apple's Home app, or by the accessory itself." (/documentation/homekit/hmcharacteristic/value) A state change the bridge makes on its own — a thermostat reaching setpoint, a fireplace timing out, a mode changed at the physical panel — reaches controllers only if the bridge emits an event.
- Controllers subscribe with `enableNotification(_:completionHandler:)` and receive values through `accessory(_:service:didUpdateValueFor:)` (/documentation/homekit/hmcharacteristic/enablenotification(_:completionhandler:)). Subscribing to a characteristic that does not advertise notification support fails.
- Not every notifiable characteristic should be spammed. The ADK's explicit precedent is `Remaining Duration`, which must not notify during a normal countdown (HAP/HAPCharacteristicTypes.h:2853-2857); for BLE, the disconnected-notification property is documented as being for important state changes only — "a temperature sensor must not use this property for changes in temperature readings" (HAP/HAP.h:471-478).

---

## HomeKit framework / Home app view

- **Availability.** `HMServiceTypeThermostat` iOS 8.0 / tvOS 10.0 / watchOS 2.0; `HMServiceTypeTemperatureSensor` iOS 9.0; `HMServiceTypeHeaterCooler` iOS 10.2 / tvOS 10.1 / watchOS 3.1.1 (/documentation/homekit/hmservicetypethermostat, /documentation/homekit/hmservicetypetemperaturesensor, /documentation/homekit/hmservicetypeheatercooler).
- **Characteristic availability.** `HMCharacteristicTypeCurrentTemperature`, `TargetTemperature`, `TemperatureUnits`, `CoolingThreshold`, `HeatingThreshold`, `TargetHeatingCooling`, `CurrentHeatingCooling` and `RotationSpeed` are all iOS 8.0 constants. `Active`, `CurrentHeaterCoolerState`, `TargetHeaterCoolerState` and `SwingMode` are iOS 10.2 / tvOS 10.1 / watchOS 3.1.1 (/documentation/homekit/hmcharacteristictypeactive, /documentation/homekit/hmcharacteristictypecurrentheatercoolerstate, /documentation/homekit/hmcharacteristictypetargetheatercoolerstate, /documentation/homekit/hmcharacteristictypeswingmode, /documentation/homekit/hmcharacteristictyperotationspeed).
- **Discrepancy, ADK vs Apple.** The ADK header says `Active` and `SwingMode` require iOS 10.3 and that `CurrentHeaterCoolerState` / `TargetHeaterCoolerState` require iOS 11 (HAP/HAPCharacteristicTypes.h:2151, 2364, 2179, 2224), and that the `HeaterCooler` service requires iOS 10.3 (HAP/HAPServiceTypes.h:876). Apple's pages give iOS 10.2 for all of them. Both floors are far below any currently supported iOS, so this has no practical effect; where it matters, treat the ADK's statement as the accessory-side requirement and Apple's as the framework-symbol availability.
- **Value enumerations the controller expects.** `Active` → `HMCharacteristicValueActivationState` (`inactive`, `active`); `CurrentHeaterCoolerState` → `HMCharacteristicValueCurrentHeaterCoolerState` (`inactive`, `idle`, `heating`, `cooling`); `TargetHeaterCoolerState` → `HMCharacteristicValueTargetHeaterCoolerState` (`automatic` — "The accessory should choose whether to heat or cool" — `heat`, `cool`); `SwingMode` → `HMCharacteristicValueSwingMode` (`disabled`, `enabled`); `TemperatureUnits` → `HMCharacteristicValueTemperatureUnit` (`celsius`, `fahrenheit`); thermostat modes → `HMCharacteristicValueHeatingCooling` (`off`, `heat`, `cool`, `auto`) and, for the current mode, `HMCharacteristicValueCurrentHeatingCooling` (`off`, `heat`, `cool`) (/documentation/homekit/hmcharacteristicvalueactivationstate, …/hmcharacteristicvaluecurrentheatercoolerstate, …/hmcharacteristicvaluetargetheatercoolerstate, …/hmcharacteristicvalueswingmode, …/hmcharacteristicvaluetemperatureunit, …/hmcharacteristicvalueheatingcooling, …/hmcharacteristicvaluecurrentheatingcooling). Note the naming difference: HAP calls `TargetHeaterCoolerState = 0` "Heat or Cool", Apple calls the same raw value `automatic`. The raw values are unchanged.
- **Deprecations.** No deprecation is stated on any of these service or characteristic pages, and no replacement symbol is offered for any of them. `HMCharacteristicTypeActive` (iOS 10.2, "General state" group) is a *different* constant from `HMCharacteristicTypePowerState` (the iOS 8 on/off) and from `HMCharacteristicTypeStatusActive` ("An indicator of whether the service is working"); none of the three deprecates another (/documentation/homekit/hmcharacteristictypeactive).
- **`HMCharacteristicMetadata` expectations.** The controller builds its UI from metadata: "Querying a characteristic's metadata enables you to build a user interface that reflects the underlying units, minima, and maxima, and other aspects of the characteristic value." The class exposes `format`, `units`, `minimumValue`, `maximumValue`, `stepValue`, `maxLength`, `validValues` and `manufacturerDescription` (/documentation/homekit/hmcharacteristicmetadata, /documentation/homekit/hmcharacteristic/metadata). `minimumValue`, `maximumValue` and `stepValue` "only apply to characteristics with a number type" (/documentation/homekit/hmcharacteristicmetadata/minimumvalue, …/maximumvalue, …/stepvalue). Temperature characteristics should carry `HMCharacteristicMetadataUnitsCelsius` and `RotationSpeed` `HMCharacteristicMetadataUnitsPercentage`; the full unit vocabulary is percentage, parts per million, celsius, fahrenheit, seconds, lux, micrograms per cubic meter, arc degree (/documentation/homekit/characteristic-units, /documentation/homekit/hmcharacteristicmetadata/units).
- **Ordering of writes from the controller.** "Actions in an action set are performed in an unspecified order." (/documentation/homekit/hmactionset) A scene that sets `Active`, `TargetHeaterCoolerState` and a threshold may deliver those writes in any order, and HAP over IP allows several characteristics to be written in one request, so several handlers can fire from one user action.
- **Reachability.** A bridged accessory that stops responding is surfaced to apps as an unreachable accessory rather than as a per-characteristic error: `HMError.bridgedAccessoryNotReachable` ("An error indicating the bridged accessory cannot be reached.", iOS 10.0+) is distinct from `accessoryNotReachable` ("not reachable over the network"), which means the bridge itself is unreachable (/documentation/homekit/hmerror/bridgedaccessorynotreachable, /documentation/homekit/hmerror/accessorynotreachable). Accessories expose reachability via `HMAccessory.isReachable`, and changes arrive through `accessoryDidUpdateReachability(_:)` (/documentation/homekit/hmaccessory/isreachable, /documentation/homekit/hmaccessordelegate/accessorydidupdatereachability(_:)).
- **Naming and removal.** Each named tile in the Home app is an `HMService`, not an `HMAccessory` (/documentation/homekit/configuring-a-home-automation-device); a bridged accessory cannot be removed individually — only the bridge can (/documentation/homekit/hmaccessory/isbridged).
- **How the Home app renders a `HeaterCooler` versus a `Thermostat` tile** — single setpoint versus dual threshold sliders, which modes appear in the mode picker, whether a restricted `validValues` set removes a mode button — is not documented on any crawled Apple page. Behaviour of the Home app UI is stated nowhere in either source; see Open questions.

---

## Implications for a bridge plugin

**Choosing the service.**

- Use `Thermostat` when the device has a single setpoint the user dials to a temperature, and `HeaterCooler` when the device is a heater, a cooler, or an air conditioner driven by thresholds. The two services have incompatible setpoint models: `Thermostat` requires `TargetTemperature`, `HeaterCooler` has no such characteristic and uses the thresholds instead (HAP/HAPServiceTypes.h:200-212 vs 878-891). Do not try to bridge between the models on one service.
- Use `TemperatureSensor` for a read-only probe. Its only required characteristic is `CurrentTemperature` (HAP/HAPServiceTypes.h:542-546). Do not add a `TemperatureSensor` alongside a `HeaterCooler` purely to expose the same reading — `CurrentTemperature` is already required on `HeaterCooler`. INFERRED (the sources state each service's contents but not this composition rule).
- Never put `CurrentHeatingCoolingState`/`TargetHeatingCoolingState` on a `HeaterCooler`, or `CurrentHeaterCoolerState`/`TargetHeaterCoolerState` on a `Thermostat`; the required-characteristic lists and Apple's two enumeration families are disjoint (HAP/HAPServiceTypes.h:200-205, 878-882).

**Target state valid values.**

- Advertise `TargetHeaterCoolerState` with an explicit `validValues` list matching what the hardware can actually do: `[1]` for a heat-only device, `[2]` for a cool-only device, `[0,1,2]` only when the accessory genuinely has both a heater and a cooler (HAP/HAPCharacteristicTypes.h:2215).
- List the values strictly ascending with no duplicates, and do not also set `validValuesRanges` on the same characteristic (HAP/HAPAccessoryValidation.c:548-579).
- Do **not** express the restriction by narrowing `minValue`/`maxValue`; the valid-values descriptor is the mechanism the transports serialize and the controller reads back as `HMCharacteristicMetadata.validValues` (HAP/HAPIPAccessory.c:1518-1531; /documentation/homekit/hmcharacteristicmetadata/validvalues).
- Even so, make the write handler defensive: reject or clamp a mode the device cannot perform rather than assuming the constraint layer filtered it. Rejection at the HAP layer is documented for the ADK's own server (HAP/HAPCharacteristic.c:414-459); a bridge running a different HAP implementation gets whatever that implementation enforces. INFERRED.
- If the device supports exactly one mode, you still must expose `TargetHeaterCoolerState` — it is required on the service (HAP/HAPServiceTypes.h:878-882) — with that single value advertised.

**Thresholds.**

- Expose `HeatingThresholdTemperature` on any accessory that heats, `CoolingThresholdTemperature` on any accessory that cools, and both on a combined unit (HAP/HAPServiceTypes.h:871).
- Respect the documented ranges: heating threshold 0–25 °C, cooling threshold 10–35 °C, both step 0.1 (HAP/HAPCharacteristicTypes.h:77-92, 217-232). A device whose native setpoint range is wider must be clamped into the advertised range, and a device whose range is narrower should advertise the narrower min/max so the controller's UI cannot ask for an unreachable value. INFERRED for the narrowing advice; the ranges themselves are sourced.
- Keep heating below cooling yourself. Nothing in HAP enforces the ordering (HAP/HAPAccessoryValidation.c:691-710), so a controller can write a crossing pair; decide and document a policy (for example, push the other threshold along) rather than leaving the device in an undefined state. INFERRED.
- Do not treat `TargetTemperature` as a `HeaterCooler` setpoint. It does not exist on that service.

**Temperature reporting.**

- Report `CurrentTemperature` in Celsius always, converting from whatever the backend speaks (HAP/HAPCharacteristicTypes.h:195-198). Round to the 0.1 step; the server rounds anyway, and writes that miss a step by more than 10 % of it are rejected (HAP/HAPCharacteristic.c:51-56, 1269).
- Expose `TemperatureDisplayUnits` only if the physical device really has a display whose units can change, and never let a write to it alter any reported temperature value (HAP/HAPCharacteristicTypes.h:770-774; /documentation/homekit/hmcharacteristictypetemperatureunits). It is required on `Thermostat` and optional on `HeaterCooler` (HAP/HAPServiceTypes.h:205 vs 887). On a `Thermostat`, if the device has no such setting, publish a stable value (Celsius) and accept writes without side effects. INFERRED.
- A `HeaterCooler` with no temperature sensor still must publish `CurrentTemperature` (HAP/HAPServiceTypes.h:880). Publish the best available proxy and keep it stable rather than oscillating; do not publish a value that implies precision the device lacks. INFERRED.

**Fan speed on a HeaterCooler.**

- Put `RotationSpeed` on the `HeaterCooler` service only when the fan cannot be controlled independently; otherwise add a separate `Fan` service (HAP/HAPServiceTypes.h:867-874). Do not do both for the same blower.
- `RotationSpeed` is a 0–100 percentage with step 1 (HAP/HAPCharacteristicTypes.h:601-618). To represent **N discrete speeds**, advertise `minStep = 100 / N` so each detent is an exact multiple — for 4 speeds, step 25, giving 0/25/50/75/100 — then map an incoming value to the nearest detent and report back the detent's exact percentage so the controller's slider and the device agree. This follows from the float step/rounding rules (HAP/HAPCharacteristic.c:60-62, 1288-1293) and from the characteristic being a percentage of maximum speed (/documentation/homekit/hmcharacteristictyperotationspeed), but neither source prescribes the N-speed mapping — INFERRED.
- Decide explicitly what `RotationSpeed = 0` means for your device. HAP defines the characteristic's minimum as 0 but does not say that 0 implies the fan is off or that the service becomes inactive (HAP/HAPCharacteristicTypes.h:607-609). Do not make `Active` and `RotationSpeed = 0` contradict each other: if the hardware stops the fan at 0, either keep `Active = 1` with speed 0, or set `Active = 0` and say so consistently on every read. INFERRED.
- Treat signed zero as zero when testing whether speed is off; the ADK's own float helper treats `-0.0` and `+0.0` alike (`HAPFloatIsZero`, PAL/HAPBase.h:1293, as used at HAP/HAPCharacteristic.c:1289). INFERRED as advice; the helper's behaviour is sourced.
- Do not require a particular write order. A scene may deliver `Active`, `TargetHeaterCoolerState`, `RotationSpeed` and `SwingMode` in any order and possibly in one request (/documentation/homekit/hmactionset); debounce and apply the resulting combined state rather than acting on each write in isolation. INFERRED.

**Events.**

- Mark every state characteristic notifiable (`ev`) and raise an event whenever the value changes for a reason the controller did not cause: thermostat reaching setpoint, mode changed at the panel or by remote, fan speed changed by the device, threshold changed by a schedule (HAP/HAP.h:322-329; /documentation/homekit/hmcharacteristic/value).
- Raise the event only when the value actually changed, following the ADK sample's `if (state != value) { … RaiseEvent }` pattern (Applications/Lightbulb/App.c:168-176).
- Do not emit an event for every sensor tick. Coalesce `CurrentTemperature` updates to meaningful changes; the ADK explicitly warns against treating temperature readings as important-enough-to-wake state, and against notifying on a routine countdown (HAP/HAP.h:471-478; HAP/HAPCharacteristicTypes.h:2853-2857).
- Keep `CurrentHeaterCoolerState` consistent with `Active` and `TargetHeaterCoolerState` after every change, and raise events for all of the characteristics that moved, not just the one the controller wrote. INFERRED.

**When the device is unreachable.**

- Fail the read or write rather than inventing a value. In ADK terms a transient backend failure is `kHAPError_Busy` ("If the request failed temporarily"), distinct from `kHAPError_Unknown` (HAP/HAPCharacteristic.h:325, per the ADK's error documentation).
- Do not report a stale `CurrentTemperature` or a fabricated `CurrentHeaterCoolerState` as though it were live; the controller has a dedicated way to express this state, `bridgedAccessoryNotReachable`, which is surfaced separately from the bridge's own reachability (/documentation/homekit/hmerror/bridgedaccessorynotreachable). INFERRED that erroring the characteristic is preferable to a stale value — neither source states the rule for a bridge in so many words.
- Do not remove and re-add the accessory to signal a fault: bridged accessories cannot be removed individually by the user, only the whole bridge can (/documentation/homekit/hmaccessory/isbridged).
- If the device exposes health, prefer the `TemperatureSensor` status characteristics (`StatusActive`, `StatusFault`, `StatusLowBattery`, `StatusTampered`) over abusing a state value to mean "broken" (HAP/HAPCharacteristicTypes.h:1416-1584).

**Category.**

- Pick the accessory category that matches the device: `Thermostats = 9`, `Heaters = 20`, `AirConditioners = 21` (HAP/HAP.h:3353, 3402, 3405). Apple's matching framework constants are `HMAccessoryCategoryTypeThermostat` (iOS 9.0), `HMAccessoryCategoryTypeAirHeater` and `HMAccessoryCategoryTypeAirConditioner` (both iOS 10.2), grouped as "Temperature and humidity" (/documentation/homekit/hmaccessorycategorytypethermostat, …/hmaccessorycategorytypeairheater, …/hmaccessorycategorytypeairconditioner).

**A note on hap-nodejs.** The workspace also contains a hap-nodejs 2.2.2 reference, which is the runtime a Homebridge plugin actually meets. It differs from the ADK in two places relevant here: it defines `CurrentTemperature` with a minimum of **-270** rather than the ADK's documented 0, and it lists `Name` as a required characteristic of `HeaterCooler`, `Thermostat` and `TemperatureSensor` where the ADK lists it as optional (HAP/HAPServiceTypes.h:884, 207-212, 550-556). The ADK and Apple documentation are the primary sources for what the specification says; the runtime's wider `CurrentTemperature` range is an implementation allowance, and a bridge that reports sub-zero outdoor temperatures depends on it rather than on anything either primary source guarantees.

---

## Open questions

Neither the HomeKitADK nor the crawled Apple documentation answers these:

1. How the Home app renders a `HeaterCooler` tile — whether a restricted `TargetHeaterCoolerState` valid-values set removes modes from the picker, and what controls appear for `HeatOrCool` versus single-mode operation.
2. Whether `minStep` on `RotationSpeed` produces detents in the Home app's slider, and how the app labels discrete speeds.
3. Whether a required ordering or minimum dead band exists between `HeatingThresholdTemperature` and `CoolingThresholdTemperature`, and what a controller does with a crossing pair.
4. What the Home app displays for `CurrentTemperature` when the accessory is reachable but the characteristic read fails, and whether a null event value (HAP/HAPIPAccessoryProtocol.c:1978-1980) is rendered as stale or as unavailable.
5. Whether `TemperatureDisplayUnits` written by a controller is expected to be persisted across reboots by the accessory, and whether the Home app writes it at all given that it uses the user's own locale preference.
6. The precise relationship the controller expects between `Active = 0` and `CurrentHeaterCoolerState = Inactive`, and whether reporting `Idle` while `Active = 0` is treated as an error.
7. Whether `RotationSpeed = 0` on a `HeaterCooler` is interpreted by the controller as "fan off" or as "service off".
8. Whether a `Thermostat` is permitted to omit `Auto` from `TargetHeatingCoolingState` via valid values, and how `TargetTemperature` and the thresholds interact when it does.
