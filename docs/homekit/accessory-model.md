# Accessory model: information, naming, services, categories, bridges

This reference covers the structural layer of a HomeKit accessory as seen by an accessory-side implementation and by the controller: the mandatory `Accessory Information` service and each of its characteristics (Name, Manufacturer, Model, SerialNumber, FirmwareRevision, HardwareRevision, Identify, and the ProductData / AccessoryFlags slots), the `HAP Protocol Information` service, the `Service Label` service together with `Service Label Namespace` / `Service Label Index`, the difference between `Name` and `ConfiguredName`, the three service properties a controller cares about (primary, hidden, linked), the accessory-category enumeration, the rules governing accessory instance IDs (aid) and service/characteristic instance IDs (iid) in a bridge, the limits and obligations placed on a bridge, the validation performed by `HAPAccessoryValidation`, the firmware-version gate the accessory server applies at every start, and the corresponding `HMAccessory` / `HMService` / `HMCharacteristic` surface in the HomeKit framework. It does not cover pairing, transport framing, or the behaviour of individual functional services (fan, thermostat, lock, …) beyond their interaction with service labels and linking.

**Sources:** HomeKitADK commit fb201f98 (2021-10-23), file paths relative to the ADK root; Apple developer documentation crawled 2026-09-12, cited by documentation path. Where the readers' extracted facts and the primary sources disagree, the primary source is used and the discrepancy is noted in [Discrepancies and gaps](#discrepancies-and-gaps).

## UUID notation

Apple-defined service and characteristic types are 16-byte UUIDs built from a fixed HAP base. `HAPUUIDCreateAppleDefined(x)` stores the bytes `91 52 76 BB 26 00 00 80 00 10 00 00` followed by `x` as a little-endian uint32 (HAP/HAPUUID.h:37-40), i.e. the canonical form `0000xxxx-0000-1000-8000-0026BB765291`. A UUID is recognised as Apple-defined by comparing those first twelve bytes (HAP/HAPUUID.c:20-27), and its string description is emitted in short form with leading zeros suppressed (HAP/HAPUUID.c:30-113). Throughout this document, "UUID" columns give the short form (e.g. `3E`, `A6`) exactly as the ADK defines it.

---

## 1. Accessory Information service

Service type UUID `3E`, debug description `"accessory-information"` (HAP/HAPServiceTypes.c:9; HAP/HAPServiceTypes.h:46-48). "Every accessory must expose a single instance of the Accessory information service" and "The values of Manufacturer, Model, Name and Serial Number must be persistent through the lifetime of the accessory" (HAP/HAPServiceTypes.h:21-24). Spec reference: R14 §8.1.

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identify | `14` | Bool | — | — | Write `true` runs the identify routine; writing `false` is rejected as invalid data | pw | Required | HAP/HAPCharacteristicTypes.h:265-280; HAP/HAPCharacteristicTypes.c:29; HAP/HAPRequestHandlers+AccessoryInformation.c:12-31 |
| Manufacturer | `20` | String (`maxLength` 64) | — | max length 64 bytes (validated) | — | pr | Required | HAP/HAPCharacteristicTypes.h:450-464; HAP/HAPCharacteristicTypes.c:43; Applications/Lightbulb/DB.c:68-87 |
| Model | `21` | String (`maxLength` 64) | — | 1..64 bytes | — | pr | Required | HAP/HAPCharacteristicTypes.h:467-482; HAP/HAPCharacteristicTypes.c:45; HAP/HAPAccessoryValidation.c:26-40 |
| Name | `23` | String (`maxLength` 64) | — | max 64 bytes | must not be a null value | pr | Required | HAP/HAPCharacteristicTypes.h:502-516; HAP/HAPCharacteristicTypes.c:49; Applications/Lightbulb/DB.c:110-129 |
| Serial Number | `30` | String (`maxLength` 64) | — | 2..64 bytes | — | pr | Required | HAP/HAPCharacteristicTypes.h:642-657; HAP/HAPCharacteristicTypes.c:63; HAP/HAPAccessoryValidation.c:42-56 |
| Firmware Revision | `52` | String (`maxLength` 64 — the format default) | — | `x[.y[.z]]`, each component ≤ 2^32−1; **parsed and range-checked at every server start**, see [§8](#8-firmware-version-gate-at-server-start) | — | pr | Required | HAP/HAPCharacteristicTypes.h:891-918; HAP/HAPCharacteristicTypes.c:85; HAP/HAP.h:3511-3518; HAP/HAPAccessoryServer.c:490-501 |
| Hardware Revision | `53` | String (`maxLength` 64 — the format default) | — | `x[.y[.z]]`; never parsed or compared by the ADK | — | pr | Optional | HAP/HAPCharacteristicTypes.h:921-948; HAP/HAPCharacteristicTypes.c:87; HAP/HAP.h:3520-3526 |
| Accessory Flags | `A6` | UInt32 | — | none stated | `RequiresAdditionalSetup = 1 << 0` ("Requires additional setup") | pr, ev | Optional | HAP/HAPCharacteristicTypes.h:1887-1908; HAP/HAPCharacteristicTypes.c:157 |
| Product Data | — | — | — | — | — | — | **Not defined in this ADK** — see below | (absence: HAP/HAPCharacteristicTypes.c:9-278) |
| ADK Version (ADK-specific, not Apple-defined) | `34AB8811-AC7F-4340-BAC3-FD6A85F9943B` | String (`maxLength` 64) | — | — | value is `"<version>;<build>"` | pr, hd | ADK extension | HAP/HAPCharacteristicTypes.c:274-278; HAP/HAPCharacteristicTypes.h:2981-2983; Applications/Lightbulb/DB.c:194-213 |

**The 64-byte string limit.** Three distinct rules produce the same number and should not be conflated:

- **The HAP format default for string characteristics.** `#define kHAPIPAccessorySerialization_DefaultMaxStringBytes ((size_t) 64)`, documented as the default "if the characteristic format is `string`" and cited to "HomeKit Accessory Protocol Specification R14, Table 6-3 Properties of Characteristic Objects in JSON" (HAP/HAPIPAccessory.c:11-17; readers' facts facts/adk-08.md:47). It is a specification default, not an application choice, and both transports treat it as "unconstrained": the IP database serializer emits `"maxLen"` only when `maxLength != 64` (HAP/HAPIPAccessory.c:1298-1307, 1533-1550), the read-response serializer does the same (HAP/HAPIPAccessoryProtocol.c:1016-1027), and the BLE serializer omits the length descriptor entirely at 64, citing the same table (HAP/HAPBLEPDU+TLV.c:427-435). A string characteristic declaring `maxLength = 64` therefore reaches the controller carrying no length key at all.
- **The accessory-level validated limits.** `HAPAccessoryValidation` enforces byte counts on four `HAPAccessory` struct fields, each constant carrying its own R14 section reference: name ≤ 64 (§9.62), manufacturer ≤ 64 (§9.58), model 1..64 (§9.59), serial number 2..64 (§9.87) (HAP/HAPAccessoryValidation.c:13-58). These are hard — an over-long value fails validation before the server starts. They do **not** extend to `firmwareVersion` or `hardwareVersion`, whose documented 64-byte maxima (HAP/HAP.h:3511-3526) are never checked.
- **The reference-database values.** Every string characteristic in the ADK sample databases declares `.constraints = { .maxLength = 64 }` (Applications/Lightbulb/DB.c:85, 106, 127, 148, 169, 190, 211, 273, 438), which is simply the default restated explicitly.

The `maxLength` unit is **bytes** on the accessory side (`HAPStringGetNumBytes`), while Apple documents the controller-side `maxLength` as "UTF-8 characters" — for multi-byte characters the two differ (HAP/HAPAccessoryValidation.c:13-58; /documentation/homekit/hmcharacteristicmetadata/maxlength).

**ProductData.** No `ProductData` characteristic type, UUID, format, or permission set exists anywhere in this ADK release. The only trace is a reserved instance-ID slot in a sample attribute database, `#define kIID_AccessoryInformationProductData ((uint64_t) 0x000A)`, which is never used to instantiate a characteristic (Applications/Lightbulb/DB.c:27). The crawled Apple documentation contains no `HMCharacteristicTypeProductData` symbol either. **The UUID, format and permissions of ProductData are not stated by either source and are not invented here.**

**AccessoryFlags** additionally carries a usage restriction: "Use of Accessory Flags requires written approval by Apple in advance" (HAP/HAPCharacteristicTypes.h:1889-1891). The crawled Apple documentation contains no corresponding `HMCharacteristicType` symbol.

**Permission rules for this service.** "Any other Apple-defined characteristics added to this service must only contain one or more of the following permissions: Paired Read or Notify. Custom characteristics added to this service must only contain one or more of the following permissions: Paired Read, Notify, Broadcast, and Hidden. All other permissions are not permitted." (HAP/HAPServiceTypes.h:26-29). `Identify` is the sole exception, and the header states the converse restriction explicitly: "Only the `Accessory Information` is allowed to contain the Identify characteristic." (HAP/HAPCharacteristicTypes.h:270).

**Reference instance layout.** In the ADK sample databases the Accessory Information service is instance ID 1 and its characteristics occupy 2..9 (Applications/Lightbulb/DB.c:18-27). The service itself is declared `.name = NULL`, `.properties = { .primaryService = false, .hidden = false, .ble = { .supportsConfiguration = false } }`, `.linkedServices = NULL`, with characteristics in the order Identify, Manufacturer, Model, Name, SerialNumber, FirmwareRevision, HardwareRevision, ADKVersion (Applications/Lightbulb/DB.c:215-231).

---

## 2. HAP Protocol Information service

Service type UUID `A2`, debug description `"protocol.information.service"` (HAP/HAPServiceTypes.c:63; HAP/HAPServiceTypes.h:720-722). "Every accessory must expose a single instance of the HAP protocol information. For a bridge accessory, only the primary HAP accessory object must contain this service. The `Version` value is transport dependent." (HAP/HAPServiceTypes.h:707-711). Spec reference: R14 §8.17.

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Version | `37` | String (`maxLength` 64) | — | — | ADK emits `"1.1.0"` over IP, `"2.2.0"` over BLE | pr | Required | HAP/HAPCharacteristicTypes.h:798-812; HAP/HAPCharacteristicTypes.c:75; HAP/HAPAccessoryServer+Internal.h:317-333; HAP/HAPRequestHandlers+HAPProtocolInformation.c:12-32 |
| Service Signature | `A5` | Data (`maxLength` 2097152 in reference DB) | — | — | ADK returns a zero-length value as a controller workaround | pr | Required in practice for BLE service properties / linked services | HAP/HAPCharacteristicTypes.h:1872-1884; HAP/HAPCharacteristicTypes.c:155; HAP/HAPRequestHandlers.c:11-25; Applications/Lightbulb/DB.c:235-254 |

The HAP Protocol Information service is the only service permitted to set `properties.ble.supportsConfiguration`; validation rejects any other service that sets it (HAP/HAPAccessoryValidation.c:736-745). The reference DB sets `.properties = { .primaryService = false, .hidden = false, .ble = { .supportsConfiguration = true } }` (Applications/Lightbulb/DB.c:277-287).

Note the related but distinct `Pairing` service, UUID `55` (HAP/HAPServiceTypes.c:27), which the ADK deliberately omits from the attribute database over IP: `HAPAccessoryServerSupportsService` returns false for the Pairing service when the transport is IP (HAP/HAPAccessoryServer.c:1506-1519).

---

## 3. Service Label service, and the label characteristics

Service type UUID `CC`, debug description `"service-label"`, requires iOS 10.3 or later, R14 §8.32 (HAP/HAPServiceTypes.c:79; HAP/HAPServiceTypes.h:946-962).

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Service Label Namespace | `CD` | UInt8 | — | min 0 / max 1 / step 1 | `Dots = 0` (". " ".." "..." "…."), `ArabicNumerals = 1` (0,1,2,3) | pr | **Required** on Service Label | HAP/HAPCharacteristicTypes.h:2702-2730; HAP/HAPCharacteristicTypes.c:215 |

`Service Label Index` is **not** a member of the Service Label service; it lives on each of the labelled services:

| Characteristic | UUID | Format | Units | Min/Max/Step | Valid values | Perms | Required/Optional | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Service Label Index | `CB` | UInt8 | — | min 1 / step 1 / **no maximum stated** | — | pr | Optional on Stateless Programmable Switch and Valve; conditionally required (see rules below) | HAP/HAPCharacteristicTypes.h:2680-2699; HAP/HAPCharacteristicTypes.c:213; HAP/HAPServiceTypes.h:526-528, 1049-1051 |

Both require iOS 10.3 or later (HAP/HAPCharacteristicTypes.h:2684, 2708).

---

## 4. Accessory categories

`HAPAccessoryCategory` (HAP/HAP.h:3316-3421). "An accessory with support for multiple categories should advertise the primary category. An accessory for which a primary category cannot be determined or the primary category isn't among the well defined categories falls in the `Other` category." (HAP/HAP.h:3307-3315). Spec reference: R14 §13.

| Value | Constant | Notes |
| --- | --- | --- |
| 0 | `BridgedAccessory` | "Accessory that is accessed through a bridge" |
| 1 | `Other` | |
| 2 | `Bridges` | |
| 3 | `Fans` | |
| 4 | `GarageDoorOpeners` | must use programmable tags if NFC is supported |
| 5 | `Lighting` | |
| 6 | `Locks` | must use programmable tags if NFC is supported |
| 7 | `Outlets` | |
| 8 | `Switches` | |
| 9 | `Thermostats` | |
| 10 | `Sensors` | |
| 11 | `SecuritySystems` | must use programmable tags if NFC is supported |
| 12 | `Doors` | must use programmable tags if NFC is supported |
| 13 | `Windows` | must use programmable tags if NFC is supported |
| 14 | `WindowCoverings` | |
| 15 | `ProgrammableSwitches` | |
| 16 | `RangeExtenders` | "Obsolete since R10" |
| 17 | `IPCameras` | |
| 19 | `AirPurifiers` | |
| 20 | `Heaters` | |
| 21 | `AirConditioners` | |
| 22 | `Humidifiers` | |
| 23 | `Dehumidifiers` | |
| 28 | `Sprinklers` | |
| 29 | `Faucets` | |
| 30 | `ShowerSystems` | |

Values 18 and 24-27 are not defined in this enumeration; the ADK assigns no constant to them. The category is externally visible before pairing: it is published as the `ci` key of the `_hap._tcp` Bonjour TXT record, alongside the primary accessory's `model` as `md` and its `name` as the service instance name (HAP/HAPIPServiceDiscovery.c:26-50, 110-152, 181-190).

The HomeKit framework exposes categories as string constants rather than integers (`HMAccessoryCategory.categoryType`), with 33 constants documented, including `HMAccessoryCategoryTypeBridge`, `HMAccessoryCategoryTypeOther`, and several with no ADK counterpart in this release — `VideoDoorbell`, `AudioReceiver`, `Speaker`, `Television`, `TelevisionSetTopBox`, `TelevisionStreamingStick`, `WiFiRouter`, `AirPort` (/documentation/homekit/accessory-category-types). There is no documented `HMAccessoryCategoryType` corresponding to `kHAPAccessoryCategory_BridgedAccessory`.

---

## 5. Service structure: name, primary, hidden, linked

`HAPService` fields (HAP/HAP.h:3241-3303):

| Field | Rule |
| --- | --- |
| `iid` | unique across all service **and** characteristic instance IDs of the accessory; must not change while paired, including over firmware updates; must be 1 for the Accessory Information service; must not be 0; must not exceed `UINT16_MAX` for accessories supporting BLE |
| `serviceType` | the service type UUID |
| `debugDescription` | based on the "Type" field of the HAP specification |
| `name` | must be set if the service provides user-visible state or interaction; must not be set for user-invisible services such as a Firmware Update service; user edits on the controller are local only and do not sync to the accessory; "If a name is set, a Name characteristic must be attached to the service" |
| `properties` | `primaryService`, `hidden`, `ble.supportsConfiguration` |
| `linkedServices` | 0-terminated array of `uint16_t` instance IDs |
| `characteristics` | NULL-terminated array |

`HAPServiceProperties` (HAP/HAP.h:3173-3205):

- `primaryService` — "The service is the primary service on the accessory. Only one service may be marked as primary."
- `hidden` — "The service should be hidden from the user… Generic HomeKit applications on the controller won't show these services. When all characteristics in a service are marked hidden then the service must also be marked as hidden."
- `ble.supportsConfiguration` — BLE only; "This must be set on the HAP Protocol Information service. This must not be set on other services."
- "If service properties are enabled, a Service Signature characteristic must be attached to the service. This is only necessary if the accessory supports Bluetooth LE, but also okay for IP accessories."

`linkedServices` constraints (HAP/HAP.h:3286-3294): "Links are not transitive. If A links to B and B links to C, it is not implied that A links to C as well." and "Services may not link to themselves." A linked-services array also requires a Service Signature characteristic on BLE.

Wire representation over IP: each service object is serialized as `"iid"`, `"type"`, `"primary"` (`true`/`false`), `"hidden"` (`true`/`false`), `"linked"` (array of instance IDs, emitted as `[]` when `linkedServices` is NULL), then `"characteristics"` (HAP/HAPIPAccessory.c:480-668). Characteristic permission strings are `pr`, `pw`, `ev`, `aa`, `tw`, `wr`, `hd` (HAP/HAPIPAccessory.c:1017-1055). A UInt8 characteristic of an Apple-defined type also carries its `"valid-values"` and/or `"valid-values-range"` arrays in this same object; both are emitted when both constraints are set, `valid-values` first (HAP/HAPIPAccessory.c:1513-1530, 1573, 1604-1615, 1643). They exist only in this attribute-database representation — the `GET /characteristics?meta=1` read-response serializer has no branch for either (HAP/HAPIPAccessoryProtocol.c:797-1042). Over BLE the same three service properties are packed into a 16-bit HAP Service Properties value: primary `0x0001`, hidden `0x0002`, supportsConfiguration `0x0004` (HAP/HAPBLEPDU+TLV.c:599-632).

---

## 6. Bridges: aid/iid, limits, obligations

`HAPAccessory.aid` (HAP/HAP.h:3456-3466):

- Regular (BLE / IP) accessory: "Must be 1."
- Bridged accessory: "Must be unique for the bridged accessory and not change across firmware updates or power cycles."

The IP layer hard-codes the primary accessory's aid as 1 (`kHAPIPAccessoryProtocolAID_PrimaryAccessory`) and the Accessory Information service's instance ID as 1 (`kHAPIPAccessoryProtocolIID_AccessoryInformation`) (HAP/HAPIPAccessoryProtocol.h:20-22).

`HAPAccessory.category` (HAP/HAP.h:3468-3477): regular accessories "Must match the functionality of the accessory's primary service"; bridged accessories "Must be `kHAPAccessoryCategory_BridgedAccessory`."

Bridge limits and lifecycle (HAP/HAP.h:4192-4224):

- `#define kHAPAccessoryServerMaxBridgedAccessories ((size_t) 149)` — "Maximum number of supported bridged accessories not including the bridge itself" (R14 §2.5.3.2). The precondition is enforced at start: the array is counted and `i <= kHAPAccessoryServerMaxBridgedAccessories` is asserted (HAP/HAPAccessoryServer.c:675-681).
- "A bridge must ensure that the instance ID assigned to the HAP accessory objects exposed on behalf of its connected bridged endpoints do not change for the lifetime of the server/client pairing."
- Bridging is "Only supported for HAP over IP (Ethernet / Wi-Fi)."
- "To change the bridged accessories (e.g. after firmware update or after modified bridge configuration), stop the server, then apply changes to the `bridgedAccessories` array, then start the server again." The `configurationChanged` argument to `HAPAccessoryServerStartBridge` "includes adding / removing accessories or updating FW of a bridged accessory", and when true the server increments the configuration number (HAP/HAPAccessoryServer.c:659-695).

Over BLE, bridging is structurally impossible in this ADK: the GATT database is built only from `server->primaryAccessory`, and BLE event delivery asserts `accessory->aid == 1` (HAP/HAPBLEPeripheralManager.c:1461-1462, 1485-1486; HAP/HAPBLEAccessoryServer+Advertising.c:710, 1105).

Service-type indexing is computed across the bridge as a whole — the primary accessory's services first, then each bridged accessory's in array order (HAP/HAPAccessoryServer.c:1522-1610).

---

## 7. Accessory validation rules (`HAPAccessoryValidation`)

Two entry points (HAP/HAPAccessoryValidation.h:20-39): `HAPRegularAccessoryIsValid(server, accessory)` and `HAPBridgedAccessoryIsValid(bridgedAccessory)`; both delegate to the shared `AccessoryIsValid` (HAP/HAPAccessoryValidation.c:67).

Length constants (HAP/HAPAccessoryValidation.c:13-58): name max 64; manufacturer max 64; model min 1, max 64; serial number min 2, max 64.

Shared rules, in evaluation order (HAP/HAPAccessoryValidation.c:68-748):

1. `name` must be set, ≤ 64 bytes, valid UTF-8 (:71-91).
2. `manufacturer` must be set, ≤ 64 bytes, valid UTF-8 (:93-118).
3. `model` must be set, 1..64 bytes, valid UTF-8 (:120-141).
4. `serialNumber` must be set, 2..64 bytes, valid UTF-8 (:143-170).
5. `firmwareVersion` must be set and valid UTF-8 (:172-188). No length or `x.y.z` shape check is performed here.
6. `hardwareVersion`, if present, must be valid UTF-8 (:190-201).
7. `services` must be non-NULL: "Accessory must at least contain the Accessory Information Service." (:203-207).
8. Per service: `debugDescription` must be set and valid UTF-8; `name`, if set, must be valid UTF-8 (:208-236).
9. Per service `linkedServices`: no duplicate entries, and every linked instance ID must resolve to a service on the *same* accessory (:238-270).
10. Per characteristic: `debugDescription` must be set and valid UTF-8; `manufacturerDescription`, if set, must be valid UTF-8 (:283-315).
11. Per characteristic, the `BASE_CHARACTERISTIC_CHECKS` macro requires: `readable` ⇒ read handler; `writable` ⇒ write handler; `supportsEventNotification` ⇒ read handler; `readRequiresAdminPermissions` ⇒ `readable`; `writeRequiresAdminPermissions` ⇒ `writable`; admin-read + writable ⇒ admin-write; `requiresTimedWrite` ⇒ `writable`; `supportsAuthorizationData` ⇒ `writable`; `ip.supportsWriteResponse` ⇒ `writable` + read handler + write handler; `ble.supportsBroadcastNotification` ⇒ read handler; `ble.supportsDisconnectedNotification` ⇒ `readable` + `supportsEventNotification` + `ble.supportsBroadcastNotification` + read handler (:321-519).
12. Numeric constraints: for UInt8/UInt16/UInt32/UInt64, `minimumValue <= maximumValue`; for Int and Float additionally `stepValue >= 0`, and for Float min/max must be finite-or-infinite and step finite (:521-710).
13. UInt8 valid values: `validValues`/`validValuesRanges` may only be used on Apple-defined characteristic types; `validValues` must be strictly ascending; each range must satisfy `start <= end`, and consecutive ranges must not overlap (`validValuesRanges[k]->start >= validValuesRanges[k-1]->end`) (:548-611). Those three are the **only** checks. In particular there is no rule of mutual exclusion between the two lists: a characteristic may legally declare both, and the IP serializer then emits both, `valid-values` first (HAP/HAPIPAccessory.c:1604-1615, 1643). See [Discrepancies and gaps](#discrepancies-and-gaps).
14. "Service must be marked hidden if all of its characteristics are marked hidden." (R14 §2.3.2.4) (:724-734).
15. "Only the HAP Protocol Information service may support configuration." — `ble.supportsConfiguration` on any other service type is rejected (:736-745).

Regular-accessory-only rules (`HAPRegularAccessoryIsValid`, :751-787):

16. `aid != 1` ⇒ "Primary accessory must have aid 1." (:757-760).
17. `category` must be non-zero — i.e. a regular accessory may not use `kHAPAccessoryCategory_BridgedAccessory` (:762-766).
18. If the BLE transport is present, `name` is scanned for `':'` and `';'` (a warning derived from Accessory Design Guidelines R7 §11.4: "The Local Name should match the accessory's markings and packaging and not contain ':' or ';'") (:768-786).

Bridged-accessory-only rules (`HAPBridgedAccessoryIsValid`, :789-807):

19. `aid == 1` ⇒ "Bridged accessory must have aid other than 1." (:792-795).
20. `category != kHAPAccessoryCategory_BridgedAccessory` ⇒ "Bridged accessory must have category kHAPAccessoryCategory_BridgedAccessory." (:796-802).
21. Otherwise identical generic validation (:804-806).

**Not validated** by this code, despite being documented as requirements in HAP/HAP.h: uniqueness of `iid` values within an accessory; `iid == 1` for the Accessory Information service; `iid != 0`; `iid <= UINT16_MAX` on BLE; "only one service may be marked as primary"; the presence of a `Name` characteristic when `service->name` is set; the presence of an Accessory Information service (only a non-NULL `services` array is checked); and the presence of an `identify` callback (asserted at write time instead — HAP/HAPRequestHandlers+AccessoryInformation.c:17). Also unchecked here: any mutual exclusion between `validValues` and `validValuesRanges`, and both the `x[.y[.z]]` grammar and the documented 64-byte maximum of `firmwareVersion` — the grammar is enforced instead at server start ([§8](#8-firmware-version-gate-at-server-start)), the length nowhere at all.

---

## 8. Firmware version gate at server start

Separately from `HAPAccessoryValidation`, the accessory server parses the **primary** accessory's `firmwareVersion` on every start and compares it against the value persisted from the previous run. `HAPAccessoryServerStart` and `HAPAccessoryServerStartBridge` both route through the same `HAPAccessoryServerPrepareStart`, so the gate applies identically to a standalone accessory and to a bridge (HAP/HAPAccessoryServer.c:465-468, 626-648, 659-688). It runs after the accessory definition has been validated (:635, :674-681) and after `server->state` has already been set to `kHAPAccessoryServerState_Running` (:478-480).

`firmwareVersion` is mandatory: it is the only non-nullable version field on `HAPAccessory` — "x[.y[.z]] (e.g. "100.1.1"); Each number must not be greater than UINT32_MAX; Maximum length 64 (excluding NULL-terminator)" (HAP/HAP.h:3511-3518) — it is asserted non-NULL before parsing (HAP/HAPAccessoryServer.c:493), and validation independently rejects an accessory that leaves it unset (HAP/HAPAccessoryValidation.c:172-188).

There are three outcomes:

1. **Unparseable version — fatal.** `ParseVersionString` accepts only decimal digits in at most three `.`-separated components; it rejects an empty component (a leading, doubled or trailing `.`), any non-digit character, and any component that would exceed `UINT32_MAX`. Any of these returns `kHAPError_InvalidData`, on which the caller invokes `HAPFatalError()` (HAP/HAPAccessoryServer.c:320-380, 490-501). A `v` prefix, a pre-release suffix (`1.2.0-beta.3`), build metadata (`1.2.0+build.7`) and a fourth component (`1.2.0.4`) all land here. Note where this is *not* caught: `HAPAccessoryValidation` checks only that `firmwareVersion` is set and is valid UTF-8, never its grammar or its length (HAP/HAPAccessoryValidation.c:172-188).
2. **Downgrade — the server refuses to start.** The parsed `(major, minor, revision)` triple is compared against the triple persisted under `kHAPKeyValueStoreKey_Configuration_FirmwareVersion` (configuration domain, key `0x10`); a stored value of unexpected length is itself fatal (HAP/HAPAccessoryServer.c:509-534; HAP/HAP+KeyValueStoreDomains.h:62). If the new triple sorts below the stored one — major, then minor, then revision — the ADK logs "[\<previous\> > \<new\>] Firmware must not be downgraded! Not starting HAPAccessoryServer.", sets the state back to `kHAPAccessoryServerState_Idle` and returns (:538-553). Both start functions then observe the non-Running state and return without bringing up any transport (:645-648, :685-688). Nothing is thrown, no error is returned to the caller and no precondition trips: the start call simply completes and the accessory never appears on the network.
3. **Upgrade — post-update tasks run.** Any other change to the triple runs `HAPHandleFirmwareUpdate`, which increments the configuration number and, when the BLE transport is present, removes the persisted GSN and expires the broadcast encryption key; the new triple is then persisted (:554-569, 580-594; HAP/HAPAccessoryServer+Reset.c:52-94). On a first-ever start nothing is compared and the triple is simply stored (:571-579).

Two consequences worth stating explicitly:

- The comparison is over the parsed numbers, not over the string, so `1.2` and `1.2.0` are the same version and neither counts as a change — and `1.10.0` is correctly newer than `1.9.0`, which a string comparison would get backwards.
- Only the primary accessory's `firmwareVersion` participates. A bridge's own version gates the whole server; the `firmwareVersion` values of bridged accessories are never parsed, compared or persisted (:493).

---

## Semantics and rules

**Accessory identity**

- The Accessory Information service must be exposed exactly once per accessory, and Manufacturer, Model, Name and Serial Number must remain stable for the accessory's lifetime (HAP/HAPServiceTypes.h:21-24).
- Its instance ID must be 1; this is stated as a constraint on every service's `iid` field and hard-coded as `kHAPIPAccessoryProtocolIID_AccessoryInformation` (HAP/HAP.h:3243-3251; HAP/HAPIPAccessoryProtocol.h:22).
- The `Name` characteristic read returns `HAPAccessory.name` for the accessory being addressed, so in a bridge each bridged accessory's Accessory Information service reports that accessory's own name (HAP/HAPRequestHandlers+AccessoryInformation.c:87-110).
- The Accessory Information service's own service-level `.name` is NULL in the reference database: the display name is carried by the Name characteristic, not by a service name (Applications/Lightbulb/DB.c:215-218).
- Accessory Information characteristics are read-only in the reference database; every one except Identify has `.handleWrite = NULL`, and Identify has `.handleRead = NULL` (Applications/Lightbulb/DB.c:48-213).
- Firmware Revision must be `x[.y[.z]]` where `<x>` is required, `<y>` is required if non-zero or if `<z>` is present, and `<z>` is required if non-zero; a later firmware may lower `<y>` only if `<x>` increased, and may lower `<z>` only if `<x>` or `<y>` increased; each component must not exceed 2^32−1; "The characteristic value must change after every firmware update." (HAP/HAPCharacteristicTypes.h:892-913). These are not merely documented expectations: the ADK parses the string at every server start, treats an unparseable value as fatal, and refuses to start the server at all if the version went backwards — see [§8](#8-firmware-version-gate-at-server-start) (HAP/HAPAccessoryServer.c:490-501, 538-553).
- Hardware Revision follows the same `x[.y[.z]]` shape and monotonicity rules, is "tracked when the board or components of the same accessory is changed", and "must change after every hardware update" (HAP/HAPCharacteristicTypes.h:922-943).
- Model "must be 1" character minimum; Serial Number's "length must be greater than 1" — validated as 2..64 bytes (HAP/HAPCharacteristicTypes.h:469-471, 644-646; HAP/HAPAccessoryValidation.c:26-56).

**Identify**

- Identify is write-only Bool; writing `true` invokes `HAPAccessory.callbacks.identify`, and writing `false` returns `kHAPError_InvalidData` with the log "Received invalid identify request." (HAP/HAPRequestHandlers+AccessoryInformation.c:12-31).
- "The accessory must implement an identify routine, a means of identifying the accessory so that it can be located by the user. The identify routine should run no longer than five seconds." (HAP/HAP.h:3538-3546).
- Unpaired identify (`POST /identify` on an open, unsecured session) is served by locating the primary accessory's service whose `iid == 1` **and** whose type is Accessory Information, then the first characteristic of type Identify that is a writable Bool; the handler's error is only logged and the response is still sent (HAP/HAPIPAccessoryServer.c:2505-2557). Unpaired identify therefore only ever targets the bridge itself, never a bridged accessory.
- The identify request carries a `remote` flag indicating the request appears to have come via a remote controller such as an Apple TV, and the `session` may belong to an admin controller rather than the originating user (HAP/HAP.h:3424-3445).

**Naming**

- `Name` "describes a name and must not be a null value"; it is Paired Read only — no write, no notify (HAP/HAPCharacteristicTypes.h:503-510).
- A user renaming an accessory or service on the controller changes nothing on the accessory: "The user may adjust the name on the controller. Such changes are local only and won't sync to the accessory." — stated both for `HAPAccessory.name` and for `HAPService.name` (HAP/HAP.h:3480-3486, 3262-3269).
- A service that "provides user visible state or interaction" must set `name`, and must then attach a Name characteristic; user-invisible services (the example given is a Firmware Update service) must not set it (HAP/HAP.h:3260-3269). The generic handler `HAPHandleNameRead` returns `request->service->name` (HAP/HAPRequestHandlers.c:28-45).
- `ConfiguredName` does not exist in this ADK release — it appears in no characteristic type table and in no service definition (absence: HAP/HAPCharacteristicTypes.c:9-278; HAP/HAPServiceTypes.h:1-1126). On the controller side it is documented as "A `UTF-8` encoded user visible name on an accessory", available from iOS 18.0 / watchOS 11.0 / visionOS 2.0, with these rules: it "must not be defined as an empty string unless you define a nonempty `HMCharacteristicTypeName`"; the initial value is the current or default name set on the television; it "is an editable text from either the accessory or the controller"; and "When it's an empty string, use HMCharacteristicTypeName as the name for this input source" (/documentation/homekit/hmcharacteristictypeconfiguredname). **Its UUID, format, permissions and length limits are not stated by either source.**

**Primary, hidden and linked services**

- Exactly one service per accessory may set `primaryService` (HAP/HAP.h:3173-3179). This is not machine-enforced by validation.
- A hidden service is one that "Generic HomeKit applications on the controller won't show"; likewise a hidden characteristic. The consistency requirement runs one way only: if *all* characteristics in a service are hidden, the service must also be hidden (HAP/HAP.h:3181-3189, 330-339; enforced at HAP/HAPAccessoryValidation.c:724-734). A hidden characteristic still appears in the attribute database, carrying the `hd` permission (HAP/HAPIPAccessory.c:1050-1056).
- Linking is directed and non-transitive, and self-links are forbidden (HAP/HAP.h:3286-3292). Linked instance IDs must exist on the same accessory and must not repeat (HAP/HAPAccessoryValidation.c:238-270). Over IP the `linked` array is always emitted, empty when there are no links (HAP/HAPIPAccessory.c:623-668).
- On BLE, any service that sets a non-default property or has linked services must expose a Service Signature characteristic; "Accessories must include the 'HAP Service Properties' characteristic only if it supports non-default properties or has linked services. Other services must not include this characteristic." (HAP/HAPBLEPDU+TLV.c:606-620).

**Service labels**

- `Service Label Namespace` "describes the naming schema for an accessory… can be used to describe the type of labels used to identify individual services of an accessory", with `Dots = 0` and `ArabicNumerals = 1` (HAP/HAPCharacteristicTypes.h:2702-2730).
- `Service Label Index` "should be used identify the index of the label that maps to `Service Label Namespace` used by the accessory", minimum 1, step 1 (HAP/HAPCharacteristicTypes.h:2680-2699).
- For Stateless Programmable Switch: each physical switch must be a unique instance of the service; multiple instances "must be linked to a `Service Label`"; with multiple instances "`Service Label Index` is a required characteristic"; index values "for each instance of this service linked to the same `Service Label` must be unique"; the visible label on the hardware should match the namespace; and with only one instance "`Service Label` is not required and consequently `Service Label Index` must not be present" (HAP/HAPServiceTypes.h:510-519).
- For Valve, `Service Label Index` must be present on each instance when the accessory is either (a) "a bridge accessory (the `Service Label` service must be included here) which includes multiple bridged accessories each with `Valve` service" or (b) "an accessory (the `Service Label` service must be included here) which includes multiple linked `Valve` services" (HAP/HAPServiceTypes.h:1023-1028).
- "If an accessory has this service with `Service Label Index` included, the default `Name` must be empty string unless user has already assigned a name to this valve before accessory is HomeKit paired. In such a case, the default name should be the user configured name for this valve." (HAP/HAPServiceTypes.h:1030-1033).
- The Irrigation System documentation describes the bridge pattern explicitly: an irrigation accessory may be "a combination of `Irrigation System` service on a bridge accessory with a collection of one or more `Valve` services (with `Valve Type` set to 'Irrigation') as bridged accessories", or the same collection as *linked* services on one accessory (HAP/HAPServiceTypes.h:970-985).

**Categories and discovery**

- A bridge advertises category `Bridges = 2`; the accessories behind it use `BridgedAccessory = 0` and do not advertise independently (HAP/HAP.h:3318-3325, 3474-3476).
- The advertised category, the primary accessory's model and its name are public before pairing via the `ci`, `md` TXT keys and the Bonjour service instance name (HAP/HAPIPServiceDiscovery.c:26-50, 110-190).
- Changing the bridge configuration bumps the configuration number `c#`, which is what tells a controller to re-read the attribute database (HAP/HAPIPServiceDiscovery.c:26-28; HAP/HAPAccessoryServer.c:689-695).

**Instance IDs**

- Every service and characteristic `iid` "Must be unique across all service or characteristic instance IDs of the accessory", "Must not change while the accessory is paired, including over firmware updates", "Must not be 0", and "For accessories that support Bluetooth LE, must not exceed UINT16_MAX" (HAP/HAP.h:3243-3251, and identically on every characteristic struct, e.g. :689-696, :949-956).
- `iid` is `uint64_t` in the struct but `linkedServices` is an array of `uint16_t`, so a service that is ever the *target* of a link is effectively limited to a 16-bit instance ID even on IP (HAP/HAP.h:3286-3294).
- Instance IDs are scoped per accessory, not per bridge: two bridged accessories may reuse the same iid values, since the address is the (aid, iid) pair (HAP/HAPIPAccessoryProtocol.h:24-38).

**Error surface**

- Per-characteristic IP status codes: `0` success, `-70401` insufficient privileges, `-70402` unable to perform operation, `-70403` resource is busy, `-70404` write to read-only characteristic, `-70405` read from write-only characteristic, `-70406` notification not supported, `-70407` out of resources, `-70409` resource does not exist, `-70410` invalid value in write, `-70411` insufficient authorization (HAP/HAPIPAccessoryServer.c:32-62).
- ADK handler errors map to those codes: `kHAPError_Unknown` and `kHAPError_InvalidState` → `-70402`, `kHAPError_InvalidData` → `-70410`, `kHAPError_OutOfResources` → `-70407`, `kHAPError_NotAuthorized` → `-70411`, `kHAPError_Busy` → `-70403` (HAP/HAPIPAccessoryServer.c:824-846).
- Every Accessory Information string read returns `kHAPError_OutOfResources` when the value plus its NUL terminator does not fit the caller's buffer (HAP/HAPRequestHandlers+AccessoryInformation.c:34-57 and the parallel handlers).

---

## HomeKit framework / Home app view

**HMAccessory** (iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0, tvOS 10.0, visionOS 1.0, watchOS 2.0). "An HMAccessory instance represents a physical device… Each physical accessory in the home is represented by exactly one accessory instance". Accessories are never constructed by an app; they arrive via `HMHome.accessories` or `HMRoom.accessories` (/documentation/homekit/hmaccessory).

| Property | Availability | Notes |
| --- | --- | --- |
| `name: String` | iOS 8.0 | changed via `updateName(_:completionHandler:)` (iOS/iPadOS/Mac Catalyst/visionOS only — not tvOS or watchOS) |
| `uniqueIdentifier: UUID` | iOS 9.0 | replaces `identifier`, deprecated in iOS 9.0: "An identifier is stable for as long as an accessory is in a home. If an accessory is removed from a home, it will get a new identifier when it is next added" |
| `category: HMAccessoryCategory` | iOS 9.0 | `categoryType: String` from accessory-category-types; `localizedDescription` for display |
| `manufacturer`, `model`, `firmwareVersion: String?` | iOS 11.0 | these **replace** the deprecated characteristic constants (see below) |
| `isReachable: Bool` | iOS 8.0 | per-accessory, including each bridged accessory |
| `isBlocked: Bool` | iOS 8.0 | a misbehaving accessory becomes blocked; only `HMHome.unblockAccessory(_:)` clears it |
| `supportsIdentify: Bool` | iOS 11.3 | "If false, any calls to the identify(completionHandler:) method return an error. However, even if this property is true, calls… may not succeed" |
| `identify(completionHandler:)` | iOS 8.0 | "Accessories typically identify themselves by briefly doing something the user can see or hear" |
| `isBridged: Bool` | iOS 8.0 | see bridge semantics below |
| `uniqueIdentifiersForBridgedAccessories: [UUID]?` | iOS 9.0 | `nil` for non-bridges; replaces `identifiersForBridgedAccessories`, deprecated iOS 9.0 |
| `bridgedAccessories: [HMAccessory]` | iOS 13.0 | "If the receiver represents a bridge, an array of the accessories behind the bridge, otherwise empty" |
| `hapInstanceID: UInt64?` | iOS 26.1 (visionOS 1.0 for the Swift symbol, 26.0 for the Objective-C `HAPInstanceID`) | "Returns the HAP Accessory Instance ID, or nil if the receiver does not represent a HAP accessory. Requires vendor-level access to this accessory." — i.e. the `aid` is normally invisible to apps |
| `isVendorAccessory: Bool` | iOS 26.1 | whether the current process has vendor-level access |

**Bridge semantics as the controller sees them** (/documentation/homekit/hmaccessory/isbridged): "Bridged accessories have the isBridged property set to true… All other accessories, including the bridge itself, have an isBridged property setting of false." Adding a bridge adds its accessories automatically, and "The home's delegate doesn't receive a `home(_:didAdd:)` delegate message for the bridge, but does receive one for each accessory behind the bridge." Adding a bridge to a *room* does not move its accessories: "Manage each accessory's room independently." Removal is all-or-nothing: "If you remove a bridge from the home, all of its accessories are also removed. On the other hand, you can't directly remove a bridged accessory from the home. You can only remove the bridge." Otherwise "you treat the accessories behind a bridge in the same way as any other accessory". The matching errors are `HMError.Code.cannotRemoveNonBridgeAccessory` ("You can only remove standalone or bridge accessories"), `cannotUnblockNonBridgeAccessory`, and `bridgedAccessoryNotReachable` (iOS 10.0) — "An error indicating the bridged accessory cannot be reached", which is distinct from `accessoryNotReachable` (iOS 8.0) for the bridge itself (/documentation/homekit/hmerror/code/bridgedaccessorynotreachable, /documentation/homekit/hmerror/code/accessorynotreachable).

**HMService** (iOS 8.0). "Accessories have both user-controllable services, like a light, and services that are for the use of the accessory itself, like a firmware update service… These services are what Apple's Home app labels as 'accessories'." (/documentation/homekit/hmservice)

| Property | Availability | Notes |
| --- | --- | --- |
| `serviceType: String` | iOS 8.0 | one of accessory-service-types |
| `name: String` | iOS 8.0 | user-specified; `updateName(_:completionHandler:)` requires a name that "must not match an existing name in the home" |
| `uniqueIdentifier: UUID` | iOS 9.0 | |
| `localizedDescription: String` | iOS 9.0 | framework-supplied human-readable name for the type |
| `isPrimaryService: Bool` | **iOS 10.0**, tvOS 10.0, watchOS 3.0 | the controller-side view of the `primary` flag |
| `isUserInteractive: Bool` | iOS 9.0 | documented only as "A Boolean value that indicates whether this service supports user interaction" — the crawl contains no discussion text mapping it to the HAP `hidden` flag |
| `linkedServices: [HMService]?` | **iOS 10.0**, tvOS 10.0, watchOS 3.0 | resolved objects rather than instance IDs |
| `associatedServiceType: String?` | iOS 8.0 | see below |
| `accessory: HMAccessory` | iOS 8.0 | back-reference |

`associatedServiceType` is a controller-side concept with no HAP characteristic behind it: "Because different things can be plugged into outlets or controlled by switches, there is a tight association between a switch or outlet service and another service that it controls — for example, a lamp plugged into an outlet associates a lightbulb service with the outlet, even if the lamp itself is not a supported HomeKit accessory." It is settable only via `updateAssociatedServiceType(_:completionHandler:)`, "only valid for services of type HMServiceTypeOutlet or HMServiceTypeSwitch", and the associated type "can be any service defined by the HomeKit Accessory Profile that supports HMCharacteristicTypePowerState, other than HMServiceTypeOutlet or HMServiceTypeSwitch" (/documentation/homekit/hmservice/associatedservicetype, /documentation/homekit/hmservice/updateassociatedservicetype(_:completionhandler:)).

**Service-type constants in scope:** `HMServiceTypeAccessoryInformation` (iOS 8.0) and `HMServiceTypeLabel` (iOS 10.3, tvOS 10.2, watchOS 3.2) — "A label namespace service used when an accessory supports multiple services of the same type." Apple groups exactly these two under "Information" (/documentation/homekit/hmservicetypeaccessoryinformation, /documentation/homekit/hmservicetypelabel). There is no documented `HMServiceType` for HAP Protocol Information: the controller does not surface that service to apps.

**Characteristic-type constants and deprecations.** These four Accessory Information constants are deprecated as of iOS 11.0 / watchOS 4.0 in favour of accessory properties:

| Constant | Status | Replacement |
| --- | --- | --- |
| `HMCharacteristicTypeManufacturer` | deprecated iOS 11.0 | "Use the accessory's manufacturer property instead" |
| `HMCharacteristicTypeModel` | deprecated iOS 11.0 | "Use the accessory's model property instead" |
| `HMCharacteristicTypeFirmwareVersion` | deprecated iOS 11.0 | "Use the accessory's firmwareVersion property instead" |
| `HMCharacteristicTypeSerialNumber` | deprecated iOS 11.0 | "This variable is no longer supported" — **no replacement property exists** |

Still current: `HMCharacteristicTypeName` (iOS 8.0, "The corresponding value is a string"), `HMCharacteristicTypeIdentify` (iOS 8.0, "Use the corresponding write-only Boolean value to ask the accessory to identify itself in the physical world"), `HMCharacteristicTypeHardwareVersion` (iOS 8.0), `HMCharacteristicTypeVersion` (iOS 8.0), `HMCharacteristicTypeLabelIndex` and `HMCharacteristicTypeLabelNamespace` (iOS 10.3, tvOS 10.2, watchOS 3.2), and `HMCharacteristicTypeConfiguredName` (iOS 18.0, watchOS 11.0, visionOS 2.0). `HMCharacteristicValueLabelNamespace` has cases `.dot` ("the number of dots, like `.`, `..`, `...`") and `.numeral` ("the arabic numeral, like 1, 2, 3"); `HMCharacteristicTypeLabelIndex`'s "corresponding value is an integer that's greater than or equal to `1`" (/documentation/homekit/hmcharacteristictypelabelindex, /documentation/homekit/hmcharacteristicvaluelabelnamespace).

**HMCharacteristicMetadata expectations** (iOS 8.0). "Querying a characteristic's metadata enables you to build a user interface that reflects the underlying units, minima, and maxima, and other aspects of the characteristic value." Fields: `format` (characteristic-data-formats), `units`, `minimumValue`, `maximumValue`, `stepValue`, `validValues` (iOS 10.0; "The subset of valid values supported by the characteristic when the format is of type unsigned integer"), `maxLength` ("The maximum number of UTF-8 characters allowed in a characteristic that uses a string format… only applies to characteristics with a string type"), and `manufacturerDescription` ("You can present this string to the user to help the user identify the purpose of the characteristic") (/documentation/homekit/hmcharacteristicmetadata and its property pages). The framework validates writes against this metadata and reports `valueHigherThanMaximum`, `valueLowerThanMinimum`, `stringLongerThanMaximum`, `stringShorterThanMinimum`, `invalidValueType` and `invalidDataFormatSpecified` rather than clamping (/documentation/homekit/hmerror).

`HMCharacteristic.properties` is an array of strings tested against `HMCharacteristicPropertyReadable` (iOS 8.0), `HMCharacteristicPropertyWritable` (iOS 8.0), `HMCharacteristicPropertyHidden` (iOS 9.3, watchOS 2.2), `HMCharacteristicPropertySupportsEventNotification`, and `HMCharacteristicPropertyRequiresAuthorizationData` (/documentation/homekit/hmcharacteristic/properties). Writing to a characteristic lacking write permission fails client-side with `HMError.Code.readOnlyCharacteristic`, and subscribing to one lacking the event permission fails with `notificationNotSupported` (/documentation/homekit/hmerror).

**Change notification.** `HMAccessoryDelegate` reports `accessoryDidUpdateName(_:)`, `accessoryDidUpdateReachability(_:)`, `accessoryDidUpdateServices(_:)`, `accessory(_:didUpdateNameFor:)` for a service, `accessory(_:didUpdateAssociatedServiceTypeFor:)`, `accessory(_:didUpdateFirmwareVersion:)`, and `accessory(_:service:didUpdateValueFor:)`. Value callbacks arrive only after `enableNotification(_:completionHandler:)` on that characteristic, and "Changes that your app initiates… generate delegate callbacks in other apps, but not in your own" (/documentation/homekit/hmaccessorydelegate).

**Naming rules enforced by the controller.** `HMError.Code.nameContainsProhibitedCharacters`: "Only letters, symbols, numbers, spaces, and apostrophes are permitted in names." Object names must also be unique in their scope (`objectWithSimilarNameExistsInHome`) (/documentation/homekit/hmerror).

---

## Implications for a bridge plugin

**Accessory Information**

1. Emit one Accessory Information service per exposed accessory — the bridge itself and every bridged accessory — with instance ID 1 in that accessory's ID space, carrying at minimum Identify, Manufacturer, Model, Name, SerialNumber and FirmwareRevision (HAP/HAPServiceTypes.h:30-36; HAP/HAPAccessoryValidation.c:203-207).
2. Keep Manufacturer, Model, Name and SerialNumber byte-identical across restarts and upgrades; they are declared persistent for the accessory's lifetime (HAP/HAPServiceTypes.h:23-24). INFERRED: derive them from a stable device identity from the downstream protocol, never from an enumeration order or a per-process value, or controllers will treat a restarted bridge as carrying different hardware.
3. Respect the length envelope: name ≤ 64 bytes, manufacturer ≤ 64, model 1..64, serial 2..64, all valid UTF-8 (HAP/HAPAccessoryValidation.c:13-58, 71-170). Count **bytes**, not characters — the constants are byte counts (`HAPStringGetNumBytes`), so a name of 40 emoji will fail.
4. Give every accessory a distinct serial number of at least 2 bytes; a one-character serial fails validation outright (HAP/HAPAccessoryValidation.c:42-56).
5. Format FirmwareRevision as `x`, `x.y` or `x.y.z` with no prefix or suffix, and change it whenever the underlying firmware changes (HAP/HAPCharacteristicTypes.h:892-913). Both halves of that are enforced at server start, not just documented ([§8](#8-firmware-version-gate-at-server-start)): an unparseable value is a `HAPFatalError()`, and a version lower than the one stored from the previous run makes the server log "Firmware must not be downgraded! Not starting HAPAccessoryServer." and return to Idle without ever going on the network (HAP/HAPAccessoryServer.c:490-501, 538-553). INFERRED, and the practical trap for a bridge plugin: if you publish your own package version as FirmwareRevision, a pre-release suffix (`1.2.0-beta.3`) or a `v` prefix crashes the server at startup, and shipping a hotfix with a *lower* number than a release the user already ran — `1.4.1` after `1.5.0`, or a rollback to a previous release — silently prevents the bridge from starting at all, with the version that broke it persisted in the key-value store rather than in your config. Normalise to the first three numeric components, and treat FirmwareRevision as a monotonic counter you control rather than as a mirror of a package version whose ordering you do not.
6. Do not add writable characteristics to Accessory Information. Beyond Identify, Apple-defined characteristics there may only be Paired Read and/or Notify; custom ones may additionally be Broadcast or Hidden (HAP/HAPServiceTypes.h:26-29).
7. Do not place Identify on any other service (HAP/HAPCharacteristicTypes.h:270).
8. Do not advertise ProductData or AccessoryFlags. ProductData has no definition in this ADK, and AccessoryFlags "requires written approval by Apple in advance" (HAP/HAPCharacteristicTypes.h:1889-1891; absence in HAP/HAPCharacteristicTypes.c:9-278).
9. HardwareRevision is optional; only emit it if you actually have a stable hardware revision from the device, and note that when the characteristic is present the underlying field must be non-NULL (HAP/HAPRequestHandlers+AccessoryInformation.c:167-177).

**Identify**

10. Implement an identify routine for every accessory: the ADK asserts the callback exists the moment a controller writes Identify (HAP/HAPRequestHandlers+AccessoryInformation.c:17), and the routine "should run no longer than five seconds" (HAP/HAP.h:3540-3541).
11. Treat a write of `false` as invalid rather than as "stop identifying" (HAP/HAPRequestHandlers+AccessoryInformation.c:19-22).
12. INFERRED: for a device that has no physical identify affordance, implement the callback as a no-op returning success rather than omitting it — omitting it trips an assertion, and `HMAccessory.supportsIdentify` is documented to be unreliable in the other direction anyway ("even if this property is true, calls… may not succeed", /documentation/homekit/hmaccessory/supportsidentify).
13. Unpaired identify only reaches the bridge's own accessory object (HAP/HAPIPAccessoryServer.c:2505-2557). INFERRED: make the bridge's identify do something visible at the bridge (a log line, an LED, a host notification) rather than fanning out to every downstream device.

**Naming**

14. Set `HAPService.name` (and attach a Name characteristic) on every service that has user-visible state, and leave it unset on plumbing services (HAP/HAP.h:3260-3269).
15. Never expose Name as writable or notifying — it is Paired Read only (HAP/HAPCharacteristicTypes.h:503-510).
16. Do not attempt to track user renames: controller-side renames never reach the accessory (HAP/HAP.h:3480-3486). INFERRED: a plugin that re-publishes its own configured name on every restart is doing the right thing at the HAP level; the user's chosen name lives only in the home database and will not be overwritten by a Name read.
17. If you need a name the user can edit *and* the accessory can read back, ConfiguredName is the only mechanism — but it is absent from this ADK and requires iOS 18 on the controller (/documentation/homekit/hmcharacteristictypeconfiguredname; absence in HAP/HAPCharacteristicTypes.c:9-278). INFERRED: treat ConfiguredName as an opt-in enhancement for modern controllers only, and never as the sole source of a service's display name; keep a non-empty Name alongside it, which is also what the Apple text requires when ConfiguredName is empty.
18. Restrict generated names to letters, symbols, numbers, spaces and apostrophes, or controller-side rename operations on them will fail with `nameContainsProhibitedCharacters` (/documentation/homekit/hmerror). INFERRED: strip characters such as `/`, `:`, `#` and `_` when deriving a HomeKit name from a downstream device label; on a bridge that may later add BLE, also strip `:` and `;` from the bridge's own accessory name (HAP/HAPAccessoryValidation.c:768-786).

**Primary, hidden and linked services**

19. Mark at most one service per accessory primary (HAP/HAP.h:3173-3179). Validation will not catch a second one, so enforce it in your own model. INFERRED: for a single-function bridged accessory the primary service is the one whose type matches the accessory's category.
20. Never mark a service hidden while leaving any characteristic on it visible — the only enforced rule is the converse, but hiding a service removes it from generic controllers, including the Home app (HAP/HAP.h:3181-3189).
21. If you hide every characteristic in a service, you **must** mark the service hidden, or `HAPAccessoryValidation` rejects the accessory (HAP/HAPAccessoryValidation.c:724-734).
22. Keep linked-service instance IDs within 16 bits and within the same accessory; a link to an iid on a different bridged accessory is invalid (HAP/HAP.h:3286-3294; HAP/HAPAccessoryValidation.c:238-270).
23. Emit links in both directions if you want both directions understood: linking is directed and non-transitive (HAP/HAP.h:3288-3290). INFERRED: for the common "sensor belongs to this device" grouping, link the subordinate service from the primary one and confirm the Home app grouping you expect, since the framework only exposes `linkedServices` as a resolved array with no documented directional semantics.
24. Attach a Service Signature characteristic to any service with non-default properties or with links if the bridge might ever run over BLE; it is harmless over IP (HAP/HAP.h:3167-3172, 3286-3293).

**Service labels**

25. When one accessory (or one bridge) exposes several instances of the same service type that the user must tell apart, add a Service Label service with a Service Label Namespace, link the instances to it, and give each instance a unique Service Label Index starting at 1 (HAP/HAPServiceTypes.h:510-519, 1023-1028; HAP/HAPCharacteristicTypes.h:2690-2693).
26. With only a single instance, omit both the Service Label service and the index: "`Service Label Index` must not be present" (HAP/HAPServiceTypes.h:518-519).
27. When a service carries a Service Label Index, its default Name must be the empty string unless the user had already named that unit before pairing (HAP/HAPServiceTypes.h:1030-1033). INFERRED: this is the opposite of the usual advice to always name a service — a plugin exposing e.g. four irrigation valves should let the label index supply the "1/2/3/4" and not invent names like "Valve 1", which would double-label them in the Home app.
28. Choose the namespace to match what is physically printed on the hardware — dots for a dotted faceplate, numerals for a numbered one (HAP/HAPServiceTypes.h:516-517).

**Categories**

29. The bridge accessory advertises `Bridges = 2`; every bridged accessory must be `BridgedAccessory = 0`, and any other value fails validation (HAP/HAP.h:3318-3325; HAP/HAPAccessoryValidation.c:796-802).
30. Never advertise `BridgedAccessory` as a bridge's own category; a regular accessory must have a non-zero category (HAP/HAPAccessoryValidation.c:762-766).
31. INFERRED: because the per-device category is `BridgedAccessory` for everything behind a bridge, the Home app's per-device icon and grouping derive from the service types you publish, not from a category — so getting the *service* type right matters more in a bridge than it does for a standalone accessory.
32. For a standalone (non-bridge) mode, pick the category matching the primary service, falling back to `Other = 1` when no well-defined category applies (HAP/HAP.h:3307-3315).

**Bridging**

33. Give the bridge `aid = 1`; give each bridged accessory a unique `aid != 1` that is stable across restarts, firmware updates and power cycles for the life of the pairing (HAP/HAP.h:3457-3466; HAP/HAPAccessoryValidation.c:757-760, 792-795; HAP/HAP.h:4202-4204). INFERRED: derive aid from a hash of a stable device key and persist the mapping to disk; never assign aid by array position, because reordering after a device drops off will silently re-point a controller's automations at a different device.
34. Likewise keep each accessory's service and characteristic iids stable while paired, including across firmware updates (HAP/HAP.h:3245-3247).
35. Cap the bridge at 149 bridged accessories (HAP/HAP.h:4192-4197). INFERRED: a plugin that can discover more devices than that must either shard across multiple bridge instances or expose a selection mechanism; the ADK treats exceeding the limit as a hard precondition failure at start, not a warning.
36. A bridge must publish the HAP Protocol Information service on the bridge accessory only, not on the bridged ones (HAP/HAPServiceTypes.h:708-709).
37. Changing the set of bridged accessories requires stopping the server, mutating the array, and restarting with `configurationChanged = true` so the configuration number increments (HAP/HAP.h:4209-4219; HAP/HAPAccessoryServer.c:689-695). INFERRED: dynamic add/remove of a bridged accessory without a configuration-number bump will leave controllers reading a stale attribute database.
38. Do not attempt bridging over BLE: the ADK builds the BLE GATT database from the primary accessory alone (HAP/HAPBLEPeripheralManager.c:1461-1462, 1485-1486).
39. Do not expect a user to remove one bridged accessory: "You can only remove standalone or bridge accessories" (/documentation/homekit/hmerror/code/cannotremovenonbridgeaccessory). INFERRED: a device that disappears downstream should be kept in the published set (reporting an unreachable/fault state) rather than being dropped from the bridge mid-pairing, since silently removing it leaves an orphaned tile the user cannot clear without removing the whole bridge.
40. When a downstream device is unreachable, answer reads and writes for it with a failure status rather than a stale value. `-70402` (unable to perform operation) and `-70403` (resource is busy) are the applicable codes, reached from `kHAPError_Unknown` / `kHAPError_InvalidState` and `kHAPError_Busy` respectively (HAP/HAPIPAccessoryServer.c:32-62, 824-846). The controller surfaces the distinct `bridgedAccessoryNotReachable` to apps (/documentation/homekit/hmerror/code/bridgedaccessorynotreachable). INFERRED: returning a fabricated last-known value instead of an error makes the Home app show a confidently wrong state; returning an error lets it show the device as unresponsive.
41. INFERRED: do not let one unreachable device block the whole bridge — HAP reads are batched across accessories and a per-characteristic status exists precisely so one failure does not fail the batch (`readWritePartialSuccess` on the controller side, /documentation/homekit/hmerror). Time out downstream operations well inside the controller's own patience and return a status.
42. Keep the bridge's own Accessory Information honest: its name, model and category are broadcast in the Bonjour TXT record before any pairing (HAP/HAPIPServiceDiscovery.c:110-190). INFERRED: avoid putting user-identifying information in the bridge's name or model, since it is readable by anything on the LAN.

**Permissions and metadata generally**

43. Declare `ev` on every characteristic whose value can change without a controller write, and actually raise events when it does; a controller cannot subscribe otherwise (`notificationNotSupported`, /documentation/homekit/hmerror), and validation requires a read handler wherever `supportsEventNotification` is set (HAP/HAPAccessoryValidation.c:321-519).
44. Publish accurate min/max/step/validValues: the controller enforces them client-side and reports `valueHigherThanMaximum` / `valueLowerThanMinimum` rather than clamping (/documentation/homekit/hmerror). Valid-value lists must be strictly ascending, and valid-value ranges non-overlapping and ascending (HAP/HAPAccessoryValidation.c:548-611).
45. Restrict an enumerated UInt8 through `validValues`, and expect controllers to see it over IP. `GET /accessories` carries `"valid-values"` and `"valid-values-range"` for every Apple-defined UInt8 characteristic that declares them, and the controller reads them back as `HMCharacteristicMetadata.validValues` (HAP/HAPIPAccessory.c:1513-1530, 1573, 1643; /documentation/homekit/hmcharacteristicmetadata/validvalues); only the `GET /characteristics?meta=1` read response omits them (HAP/HAPIPAccessoryProtocol.c:797-1042). INFERRED: declare one list rather than both — nothing rejects a characteristic that sets both and the serializer emits `valid-values` followed by `valid-values-range` (HAP/HAPIPAccessory.c:1604-1615), which is at best redundant to a controller; and prefer `validValues` to `validValuesRanges`, since `HMCharacteristicMetadata` has no range property.
46. Do not attach `validValues` or `validValuesRanges` to a custom (non-Apple-defined) characteristic type — validation rejects it (HAP/HAPAccessoryValidation.c:551-560).
47. Every readable characteristic needs a read handler and every writable one a write handler, or the accessory fails validation before the server starts (HAP/HAPAccessoryValidation.c:321-360).

---

## Discrepancies and gaps

- **Readers vs. primary source — none material.** Every extracted fact checked against the ADK sources above matched: the 149-accessory bridge limit, `aid == 1` for the primary accessory, `BridgedAccessory` for bridged ones, the 64-byte string limits, the ADKVersion characteristic being the one hidden member of Accessory Information, and the absence of ProductData/ConfiguredName. One reader note stated that "ProductData and ConfiguredName do not appear anywhere in `HAPServiceTypes.h`"; the stronger and correct statement, confirmed here, is that neither appears anywhere in the ADK's characteristic type table either (HAP/HAPCharacteristicTypes.c:9-278), the sole exception being an unused IID `#define` in one sample database (Applications/Lightbulb/DB.c:27).
- **Internal to the ADK:** `Accessory Flags` is documented with "Format: UInt32" while its value enumeration is declared as `HAP_OPTIONS_BEGIN(uint8_t, …)` (HAP/HAPCharacteristicTypes.h:1898-1907). Only bit 0 is defined, so the width mismatch has no practical effect, but the declared enum type cannot express flags above bit 7.
- **Documented-but-unenforced:** iid uniqueness, iid ≠ 0, iid == 1 for Accessory Information, the 16-bit iid ceiling on BLE, single-primary-service, and "a Name characteristic must be attached if `service->name` is set" are all stated as requirements in HAP/HAP.h but are not checked by `HAPAccessoryValidation.c`. A bridge generator must enforce them itself. The documented 64-byte maximum on `firmwareVersion` and `hardwareVersion` (HAP/HAP.h:3511-3526) is likewise never checked; `firmwareVersion`'s `x[.y[.z]]` grammar is the one documented rule here that *is* enforced, though at server start rather than in validation ([§8](#8-firmware-version-gate-at-server-start)).

### Contradictions within this document set

`protocol.md` §7 carries the wire-level resolution of the first two of these; they are restated here because this document is where the validation rules and the Accessory Information string limits live.

- **Whether `valid-values` reaches controllers over IP — `fans.md` is wrong.** `fans.md:122` states that "The IP transport does **not** serialize valid-values into the characteristic object — only `format`, `unit`, `minValue`, `maxValue`, `minStep`, `perms` and `ev` appear there", and `fans.md:183` draws plugin advice from it ("the IP transport does not transmit valid-values at all … so min/max are the constraint controllers actually see over IP"). **The primary source agrees instead with `protocol.md` §1.3 and `heating.md:104,146`:** `GET /accessories` emits `"valid-values"` and `"valid-values-range"` for Apple-defined UInt8 characteristics (HAP/HAPIPAccessory.c:1513-1530, 1573, 1643). `fans.md`'s own citation (HAP/HAPIPAccessoryProtocol.c:729-1010) covers only the `GET /characteristics` read-response serializer, which indeed has no valid-values branch (HAP/HAPIPAccessoryProtocol.c:797-1042) — the narrow claim is true, the blanket one is not. This is the one contradiction in the set that produces actively wrong implementation advice, since `heating.md:144-146` and `purifier-filter-occupancy-covering.md:191-192` both instruct plugins to restrict `TargetHeaterCoolerState` / `TargetAirPurifierState` through valid-values, and that advice is sound.
- **Whether declaring both `validValues` and `validValuesRanges` fails accessory validation — it does not.** `fans.md:121` ("a characteristic must not declare both lists at once; violations fail accessory validation") and `heating.md:105,145` ("An accessory must not declare both …") assert an enforced rule; `protocol.md` formerly implied the converse rule by emitting `valid-values-range` only when `validValues` was unset, and has since been corrected. **The source wins, and rule 13 in [§7](#7-accessory-validation-rules-hapaccessoryvalidation) is the accurate statement:** `HAPAccessoryValidation.c:548-611` verifies only that the characteristic type is Apple-defined, that `validValues` is strictly ascending, and that each `validValuesRanges` entry satisfies `start <= end` with entries ascending and non-overlapping. Both lists together are legal and both are serialized, `valid-values` first (HAP/HAPIPAccessory.c:1604-1615, 1643). "Declare only one" is house style, not an enforced rule.
- **The status of the 64-byte string maximum.** `fans.md:230` calls "the 64-character limit seen in sample databases … an application choice, not a spec constraint stated in the header", and `lights-switches.md:26,41,53,65` calls it "maxLength 64 in the ADK example … not a spec range"; earlier revisions of *this* document presented 64 flatly as a validated hard limit everywhere. **The default reading wins**, and [The 64-byte string limit](#1-accessory-information-service) in §1 now separates the three senses: 64 is the HAP format default for string characteristics, cited to R14 Table 6-3 (HAP/HAPIPAccessory.c:11-17; HAP/HAPBLEPDU+TLV.c:427-435), *and* a validated hard limit — but only on the four accessory-level strings, each carrying its own R14 section reference (HAP/HAPAccessoryValidation.c:13-58). `fans.md`'s "application choice" framing is the outlier; it also leaves the Fan service's `Name` row ("max length not stated in the header", `fans.md:18`) as the only `Name` row in the set with no length stated.

## Open questions

- The UUID, format, permissions, length limit and semantics of **ProductData** — present in neither the ADK characteristic table nor the crawled Apple documentation (only an unused IID slot at Applications/Lightbulb/DB.c:27).
- The UUID, format, permissions and maximum length of **ConfiguredName** — Apple documents the constant and its empty-string rules but no wire details, and the ADK has no definition at all.
- The full bit layout of **AccessoryFlags** beyond bit 0 (`RequiresAdditionalSetup`), and what "requires additional setup" makes a controller display.
- Whether **`HMService.isUserInteractive`** maps to the HAP `hidden` service property, to the presence of writable characteristics, or to something else — the documentation page carries no discussion text.
- The **maximum value of Service Label Index** (only a minimum of 1 and a step of 1 are stated) and whether indices must be contiguous from 1 or merely unique.
- Whether a bridge may legally expose the **Pairing service** on bridged accessories — the ADK simply filters that service out over IP (HAP/HAPAccessoryServer.c:1514-1516) without stating a rule.
- Any **per-accessory limit on services or characteristics**, or a total attribute-database size limit over IP; the ADK defines only the 149 bridged-accessory cap and BLE's 16-bit iid ceiling.
- Whether **AccessoryFlags / Identify events** are expected to be re-raised after a bridge restart, and more generally whether a controller re-reads the whole attribute database on a configuration-number bump or only diffs it.
- The ADK-era **`HAPAccessoryCategory` gaps** (values 18, 24-27) — presumably assigned in later HAP revisions, but neither source names them.
- How the controller resolves a conflict when a bridged accessory's **Name characteristic changes** while the user has already renamed that accessory locally; the sources establish only that accessory-side names do not sync and controller-side names do not propagate.
