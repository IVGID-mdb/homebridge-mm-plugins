# HAP over IP: reads, writes, notifications, errors, validation

**Scope.** This document is the authoritative reference for how a HomeKit accessory (or bridge) exchanges characteristic values with a controller over HAP-over-IP: the shape and semantics of `GET /accessories`, `GET /characteristics`, `PUT /characteristics` and `PUT /prepare`; per-characteristic read and write request/response handling; event-notification (`ev`) subscription, coalescing and delivery on the `EVENT/1.0` channel; write-response (`wr` / `"r":true`), timed writes (prepare/execute with `ttl` and `pid`) and additional authorization data (`aa` / `authData`); the HAP status codes returned per characteristic and the internal error codes that map onto them; value validation and coercion against `format`, `minValue`/`maxValue`/`minStep`, `validValues`/`validValuesRange`, `maxLen`/`maxDataLen`; the wire encoding of `bool` and non-finite `float` values and the 64000-byte ceiling on a characteristic value; and the controller-side view of all of this — `HMCharacteristicMetadata`, `HMCharacteristicProperties`, the `HMError` codes a controller surfaces, and what happens when an accessory is unreachable. Bluetooth LE transport specifics are out of scope except where an IP-visible property (for example `requiresTimedWrite`) is shared.

**Sources.** HomeKitADK commit `fb201f98` (snapshot at `scratchpad/HomeKitADK`; the project brief dates this 2021-10-23, while `git log` on the snapshot reports the commit date as 2021-09-05 — see *Discrepancies*), citing HAP Specification R14 throughout; Apple developer documentation for the HomeKit framework, crawled 2026-09-12. Where the readers' extracted facts and the primary sources differ, the primary source wins and the difference is recorded under *Discrepancies*.

**A note on the "per service" table requirement.** This topic is transport- and framework-level: it has no services of its own and therefore no per-service characteristic tables. The equivalent normative tables — the characteristic-object JSON keys, the permission tokens, the formats, the units, the status codes, and the controller-side metadata keys — are given below in the same spirit. Per-service characteristic tables (UUID, format, units, min/max/step, valid values, perms, required/optional) belong to the per-service topic documents and are not duplicated here.

---

## 1. Transport surface

### 1.1 Endpoints

| Endpoint | Method | Success response | Notes | Source |
| --- | --- | --- | --- | --- |
| `/accessories` | GET | `200 OK`, `Transfer-Encoding: chunked`, `Content-Type: application/hap+json` | Whole attribute database, streamed incrementally | HAP/HAPIPAccessoryServer.c:2085-2094 |
| `/characteristics?id=…` | GET | `200 OK` if every read succeeded, `207 Multi-Status` if any did not; `204 No Content` if zero contexts parsed | `Content-Type: application/hap+json` | HAP/HAPIPAccessoryServer.c:1861-1874 |
| `/characteristics` | PUT | `204 No Content` if every write succeeded and none requested a response; otherwise `207 Multi-Status` | Body `{"characteristics":[…],"pid":…}` | HAP/HAPIPAccessoryServer.c:1429-1435; HAP/HAPIPAccessoryServer.c:633-668 |
| `/prepare` | PUT | `200 OK` with body `{"status":0}` | Opens a timed-write transaction | HAP/HAPIPAccessoryServer.c:596-628 |

Transport-level failures are HTTP-level, not per-characteristic: a malformed body is `400 Bad Request` with `Content-Length: 0` (HAP/HAPIPAccessoryServer.c:70-73); an unknown URI is `404 Not Found` (HAP/HAPIPAccessoryServer.c:88-91); a wrong method on a known URI is `405 Method Not Allowed` (HAP/HAPIPAccessoryServer.c:94-97); a request on a session that has not completed Pair-Verify is `470 Connection Authorization Required`, carrying `{"status":-70411}` for the characteristic endpoints (HAP/HAPIPAccessoryServer.c:110-117); an accessory that cannot allocate the response buffer answers `500 Internal Server Error` with `{"status":-70407}` (HAP/HAPIPAccessoryServer.c:126-134).

### 1.2 `GET /characteristics` query parameters

| Parameter | Values | Default | Effect | Source |
| --- | --- | --- | --- | --- |
| `id` | comma-separated `aid.iid` pairs (both uint64) | required | Selects the characteristics to read | HAP/HAPIPAccessoryProtocol.c:177-217 |
| `meta` | exactly one digit, `0` or `1` | `0` | Adds `format`, `unit`, `minValue`, `maxValue`, `minStep`, `maxLen`, `maxDataLen` | HAP/HAPIPAccessoryProtocol.c:169-172, 217-228 |
| `perms` | `0` / `1` | `0` | Adds the `perms` array | HAP/HAPIPAccessoryProtocol.c:229-240 |
| `type` | `0` / `1` | `0` | Adds `type` (characteristic UUID string) | HAP/HAPIPAccessoryProtocol.c:241-252 |
| `ev` | `0` / `1` | `0` | Adds the current per-session subscription state as `"ev":true/false` | HAP/HAPIPAccessoryProtocol.c:253-263 |

Any other parameter name, a `meta`/`perms`/`type`/`ev` value longer than one character, or a malformed `id` list, fails the whole request with `kHAPError_InvalidData` → `400 Bad Request` (HAP/HAPIPAccessoryProtocol.c:203-212, 219-260).

### 1.3 Characteristic object keys

Keys the accessory emits for a characteristic. "Where" distinguishes the full database from the read response, because they are produced by different serializers.

| Key | Type | Where | Emitted when | Source |
| --- | --- | --- | --- | --- |
| `aid` | uint64 | read/write responses | always | HAP/HAPIPAccessoryProtocol.c:580-596 |
| `iid` | uint64 | `/accessories`, read/write responses | always | HAP/HAPIPAccessory.c:745; HAP/HAPIPAccessoryProtocol.c:592-598 |
| `type` | string (UUID) | `/accessories` always; read response only with `type=1` | always / on request | HAP/HAPIPAccessory.c:767; HAP/HAPIPAccessoryProtocol.c:599-606 |
| `format` | `bool`,`uint8`,`uint16`,`uint32`,`uint64`,`int`,`float`,`string`,`tlv8`,`data` | `/accessories` always; read response with `meta=1` | always / on request | HAP/HAPIPAccessory.c:789-830; HAP/HAPIPAccessoryProtocol.c:607-640 |
| `value` | per format | `/accessories` only if `readable`; read response on success | see §3 | HAP/HAPIPAccessory.c:836-844, 848; HAP/HAPIPAccessoryProtocol.c:652-716 |
| `status` | int32 | read/write responses | omitted on a read when *every* context in the batch succeeded; otherwise always | HAP/HAPIPAccessoryProtocol.c:641-651, 724-727 |
| `perms` | array of tokens | `/accessories` always; read response with `perms=1` | always / on request | HAP/HAPIPAccessory.c:966-1058; HAP/HAPIPAccessoryProtocol.c:729-796 |
| `ev` | bool | `/accessories` always; read response with `ev=1` | per-session subscription state | HAP/HAPIPAccessory.c:1073-1092; HAP/HAPIPAccessoryProtocol.c:797-800 |
| `description` | string | `/accessories` only | only if `manufacturerDescription` is non-NULL | HAP/HAPIPAccessory.c:1099-1111 |
| `unit` | `celsius`,`arcdegrees`,`percentage`,`lux`,`seconds` | `/accessories`; read response with `meta=1` | omitted when the unit is `None` | HAP/HAPIPAccessory.c:1167-1199; HAP/HAPIPAccessoryProtocol.c:801-860 |
| `minValue`,`maxValue`,`minStep` | numeric | `/accessories`; read response with `meta=1` | only when the range is narrower than the format's full range | HAP/HAPIPAccessory.c:1327, 1391, 1455; HAP/HAPIPAccessoryProtocol.c:860-1015 |
| `maxLen` | uint | string characteristics | only when `maxLength != 64` | HAP/HAPIPAccessory.c:17, 1301-1307, 1533-1551; HAP/HAPIPAccessoryProtocol.c:1018-1024 |
| `maxDataLen` | uint | data characteristics | only when `maxLength != 2097152` | HAP/HAPIPAccessory.c:25, 1312-1321, 1553-1570; HAP/HAPIPAccessoryProtocol.c:1033-1039 |
| `valid-values` | array of uint8 | `/accessories` only | UInt8, Apple-defined type, `validValues` set | HAP/HAPIPAccessory.c:1516-1521, 1573-1601 |
| `valid-values-range` | array of `[start,end]` pairs | `/accessories` only | UInt8, Apple-defined type, `validValuesRanges` set — **including when `validValues` is also set**, in which case it follows `valid-values` in the same object | HAP/HAPIPAccessory.c:1522-1525, 1604-1612, 1643 |

`valid-values` and `valid-values-range` **are** emitted in the attribute database, and are **not** emitted in a `GET /characteristics?meta=1` response at all: the read-response serializer has no branch for them (HAP/HAPIPAccessoryProtocol.c:860-1042), while the database serializer emits both (HAP/HAPIPAccessory.c:1516-1525, 1573, 1643). Two details of the database emission are easy to get wrong:

- **Neither key depends on `minValue`/`maxValue`/`minStep` being emitted.** A UInt8 characteristic sitting at the format's full default range skips the min/max/step states and jumps straight to the state that decides the valid-values keys, so an enumeration is advertised even when no range keys are (HAP/HAPIPAccessory.c:1216-1221, 1513-1530).
- **The two keys are not mutually exclusive.** When a characteristic declares both lists, `valid-values` is written first and `valid-values-range` follows it in the same characteristic object (HAP/HAPIPAccessory.c:1604-1612). Declaring both is legal — see §4.3 and *Discrepancies*.

The defaults that suppress `maxLen`/`maxDataLen` are named constants — 64 bytes for strings, 2097152 bytes for data — and the ADK documents both as the HAP defaults, citing R14 Table 6-3 "Properties of Characteristic Objects in JSON" (HAP/HAPIPAccessory.c:11-25). 64 is therefore a *format default*, not an arbitrary sample-database choice; see *Discrepancies*.

### 1.4 `PUT /characteristics` write-object keys

| Key | Type | Meaning | Source |
| --- | --- | --- | --- |
| `aid`, `iid` | uint64 | Target characteristic | HAP/HAPIPAccessoryProtocol.c:1102-1160 |
| `value` | number / string / bool-as-number | New value; absent for a pure subscription change | HAP/HAPIPAccessoryProtocol.c:1160-1324 |
| `ev` | bool | `true` subscribe, `false` unsubscribe, absent = leave unchanged | HAP/HAPIPAccessoryProtocol.h:77-82 |
| `authData` | string (base64) | Additional authorization data, for `aa` characteristics | HAP/HAPIPAccessoryProtocol.c:1325-1353 |
| `remote` | bool or `0`/`1` | The write originated remotely (via a home hub) | HAP/HAPIPAccessoryProtocol.c:1354-1403; HAP/HAPIPAccessoryProtocol.h:102 |
| `r` | bool or `0`/`1` | Controller requests the post-write value in the response | HAP/HAPIPAccessoryProtocol.c:1404-1453; HAP/HAPIPAccessoryProtocol.h:104 |
| `pid` (top level) | uint64 | Timed-write transaction id, matching a prior `PUT /prepare` | HAP/HAPIPAccessoryProtocol.c:1622-1644 |

`PUT /prepare` takes exactly `ttl` (milliseconds) and `pid`, both uint64 JSON numbers; unknown keys are skipped (HAP/HAPIPAccessoryProtocol.c:1996-2105).

---

## 2. Permissions, formats and units

### 2.1 Permission tokens

Order in the emitted `perms` array is fixed: `pr`, `pw`, `ev`, `aa`, `tw`, `wr`, `hd` (HAP/HAPIPAccessoryProtocol.c:729-796; HAP/HAPIPAccessory.c:1017-1053).

| Token | ADK property | Meaning | Server-side requirement | Source |
| --- | --- | --- | --- | --- |
| `pr` | `properties.readable` | Paired read | Requires a `handleRead` callback | HAP/HAP.h:305-311; HAP/HAPAccessoryValidation.c:324-333 |
| `pw` | `properties.writable` | Paired write | Requires a `handleWrite` callback | HAP/HAP.h:312-318; HAP/HAPAccessoryValidation.c:335-344 |
| `ev` | `properties.supportsEventNotification` | Notify | Requires a `handleRead` callback; only secured controllers may subscribe | HAP/HAP.h:320-330; HAP/HAPAccessoryValidation.c:346-355 |
| `aa` | `properties.supportsAuthorizationData` | Additional authorization data | Requires `writable`; the write handler validates the data and returns `kHAPError_NotAuthorized` if insufficient | HAP/HAP.h:383-403; HAP/HAPAccessoryValidation.c:403-412 |
| `tw` | `properties.requiresTimedWrite` | Timed write required | Requires `writable` | HAP/HAP.h:370-379; HAP/HAPAccessoryValidation.c:392-401 |
| `wr` | `properties.ip.supportsWriteResponse` | Write always yields a read response | Requires `writable` plus both `handleRead` and `handleWrite` | HAP/HAP.h:426-436; HAP/HAPAccessoryValidation.c:414-441 |
| `hd` | `properties.hidden` | Hidden from generic UIs | If every characteristic in a service is hidden, the service must be hidden too | HAP/HAP.h:332-339 |

Two further ADK properties are *not* permission tokens and never appear on the wire: `readRequiresAdminPermissions` / `writeRequiresAdminPermissions` (which gate reads, writes and event delivery to admin controllers, HAP/HAP.h:341-368) and `ip.controlPoint` (which suppresses the value during discovery, HAP/HAP.h:405-423). The count of emitted tokens is computed from exactly the seven properties above (HAP/HAPIPCharacteristic.c:17-29).

### 2.2 Formats and their constraint fields

| `format` | ADK enum | C type | Constraint fields | Default range suppression | Source |
| --- | --- | --- | --- | --- | --- |
| `bool` | `kHAPCharacteristicFormat_Bool` | bool | none | n/a | HAP/HAP.h:249; HAP/HAP.h:944-946 |
| `uint8` | `…_UInt8` | uint8_t | `minimumValue`, `maximumValue`, `stepValue`, `validValues`, `validValuesRanges` | omitted when min = 0 and max = `UINT8_MAX` | HAP/HAP.h:1242-1268; HAP/HAPIPAccessoryProtocol.c:860-877 |
| `uint16` | `…_UInt16` | uint16_t | min/max/step only | omitted when min = 0 and max = `UINT16_MAX` | HAP/HAP.h:1523-1529; HAP/HAPIPAccessoryProtocol.c:878-904 |
| `uint32` | `…_UInt32` | uint32_t | min/max/step only | omitted when min = 0 and max = `UINT32_MAX` | HAP/HAP.h:1784-1790 |
| `uint64` | `…_UInt64` | uint64_t | min/max/step only | omitted when min = 0 and max = `UINT64_MAX` | HAP/HAP.h:2045-2051 |
| `int` | `…_Int` | int32_t | min/max/step only; step must be ≥ 0 | omitted when min = `INT32_MIN` and max = `INT32_MAX` | HAP/HAP.h:2306-2312; HAP/HAPIPAccessoryProtocol.c:961-981 |
| `float` | `…_Float` | float | min/max/step only | omitted when min = −inf and max = +inf | HAP/HAP.h:2567-2573; HAP/HAPIPAccessoryProtocol.c:982-1015 |
| `string` | `…_String` | UTF-8 string | `maxLength` (uint16) | `maxLen` omitted when 64 | HAP/HAP.h:2823-2827 |
| `tlv8` | `…_TLV8` | TLV8 blob | none | n/a | HAP/HAP.h:3044-3046 |
| `data` | `…_Data` | raw bytes | `maxLength` (uint32) | `maxDataLen` omitted when 2097152 | HAP/HAP.h:719-723 |

Only `uint8` carries `validValues` / `validValuesRanges`; every other numeric format has min/max/step alone (HAP/HAP.h:1244-1268 vs 1525-1529, 1786-1790, 2047-2051, 2308-2312, 2569-2573).

### 2.3 Units

| Wire value | ADK enum | Source |
| --- | --- | --- |
| *(key omitted)* | `kHAPCharacteristicUnits_None` | HAP/HAPIPAccessoryProtocol.c:821-823 |
| `celsius` | `…_Celsius` | HAP/HAPIPAccessoryProtocol.c:824-826 |
| `arcdegrees` | `…_ArcDegrees` | HAP/HAPIPAccessoryProtocol.c:827-829 |
| `percentage` | `…_Percentage` | HAP/HAPIPAccessoryProtocol.c:830-832 |
| `lux` | `…_Lux` | HAP/HAPIPAccessoryProtocol.c:833-835 |
| `seconds` | `…_Seconds` | HAP/HAPIPAccessoryProtocol.c:836-838 |

The ADK defines exactly these six units; a unit outside the set is a fatal error. Apple's controller-side unit list is larger — see §5.3.

---

## 3. HAP status codes

### 3.1 The codes

| Code | ADK constant | Documented meaning | Where the ADK emits it | Source |
| --- | --- | --- | --- | --- |
| `0` | `…StatusCode_Success` | "This specifies a success for the request." | — | HAP/HAPIPAccessoryServer.c:31-32 |
| `-70401` | `…_InsufficientPrivileges` | "Request denied due to insufficient privileges." | Non-admin controller reading/writing/subscribing an admin-only characteristic | HAP/HAPIPAccessoryServer.c:34-35, 886, 937, 943, 1798 |
| `-70402` | `…_UnableToPerformOperation` | "Unable to perform operation with requested service or characteristic." | Handler returned `kHAPError_Unknown` or `kHAPError_InvalidState`; also a control-point characteristic read during `GET /accessories` | HAP/HAPIPAccessoryServer.c:37-38, 829-834, 1466-1471, 1787-1790 |
| `-70403` | `…_ResourceIsBusy` | "Resource is busy, try again." | Handler returned `kHAPError_Busy` | HAP/HAPIPAccessoryServer.c:40-41, 844-846, 1483-1485 |
| `-70404` | `…_WriteToReadOnlyCharacteristic` | "Cannot write to read only characteristic." | `properties.writable` is false | HAP/HAPIPAccessoryServer.c:43-44, 1278-1280 |
| `-70405` | `…_ReadFromWriteOnlyCharacteristic` | "Cannot read from a write only characteristic." | `properties.readable` is false; also `"r":true` on a characteristic without `wr` | HAP/HAPIPAccessoryServer.c:46-47, 1273-1275, 1794-1796 |
| `-70406` | `…_NotificationNotSupported` | "Notification is not supported for characteristic." | `ev` written to a characteristic without `supportsEventNotification` | HAP/HAPIPAccessoryServer.c:49-50, 887-889 |
| `-70407` | `…_OutOfResources` | "Out of resources to process request." | Handler returned `kHAPError_OutOfResources`; per-session subscription table full; value does not fit the data buffer | HAP/HAPIPAccessoryServer.c:52-53, 905-906, 838-840, 1477, 1555 |
| `-70409` | `…_ResourceDoesNotExist` | "Resource does not exist." | No characteristic with that `aid.iid` | HAP/HAPIPAccessoryServer.c:55-56, 1360, 1801 |
| `-70410` | `…_InvalidValueInWrite` | "Accessory received an invalid value in a write request." | Wrong JSON type or out-of-format-range value; write object with neither `value` nor `ev`; undecodable `authData`; a plain write to a `tw` characteristic; an expired/mismatched/unprepared `pid`; handler returned `kHAPError_InvalidData` | HAP/HAPIPAccessoryServer.c:58-59, 879, 961-1223, 1339-1350, 1404-1416, 835-837 |
| `-70411` | `…_InsufficientAuthorization` | "Insufficient Authorization." | Handler returned `kHAPError_NotAuthorized`; also the body of the `470` response on an unsecured session | HAP/HAPIPAccessoryServer.c:61-62, 841-843, 110-117, 1480-1482 |

**`-70408` (operation timed out) does not exist in this ADK.** The IP server defines exactly the ten non-zero codes above (HAP/HAPIPAccessoryServer.c:31-62), and a repository-wide grep for `70408` finds nothing. Nor do the crawled Apple pages give any numeric value for a HAP status code. Do not emit `-70408`; a timeout inside the accessory is expressed as `kHAPError_Busy` → `-70403` or `kHAPError_Unknown` → `-70402`. Conversely, `-70403` is a real code that a bridge will need and that is easy to overlook.

### 3.2 Internal error → status mapping

Accessory handlers return `HAPError`, not status codes. The enum is `kHAPError_None`, `_Unknown`, `_InvalidState`, `_InvalidData`, `_OutOfResources`, `_NotAuthorized`, `_Busy` (PAL/HAPBase.h:71-79).

| `HAPError` | On write | On read | Source |
| --- | --- | --- | --- |
| `kHAPError_None` | `0` | `0` | HAP/HAPIPAccessoryServer.c:826-828, 1463-1465 |
| `kHAPError_Unknown` | `-70402` | `-70402` | HAP/HAPIPAccessoryServer.c:829-831, 1466-1468 |
| `kHAPError_InvalidState` | `-70402` | `-70402` | HAP/HAPIPAccessoryServer.c:832-834, 1469-1471 |
| `kHAPError_InvalidData` | `-70410` | **fatal error** — a read handler may not return it | HAP/HAPIPAccessoryServer.c:835-837, 1472-1474 |
| `kHAPError_OutOfResources` | `-70407` | `-70407` | HAP/HAPIPAccessoryServer.c:838-840, 1475-1477 |
| `kHAPError_NotAuthorized` | `-70411` | `-70411` | HAP/HAPIPAccessoryServer.c:841-843, 1478-1482 |
| `kHAPError_Busy` | `-70403` | `-70403` | HAP/HAPIPAccessoryServer.c:844-846, 1483-1485 |

A read handler may return only `Unknown`, `InvalidState`, `OutOfResources` or `Busy`; a write handler may additionally return `InvalidData` and `NotAuthorized` (HAP/HAP.h:744-748 vs 772-778, asserted at HAP/HAPCharacteristic.c:112-124 and 172-184).

---

## 4. Semantics and rules

### 4.1 Reads

- A read of a characteristic whose `properties.readable` is false returns `-70405`; a read of a characteristic whose read requires admin permission from a non-admin controller returns `-70401`, and this check runs *before* the readable check (HAP/HAPIPAccessoryServer.c:1777-1799).
- A `GET /characteristics` batch is answered `200 OK` only if every context succeeded; a single non-zero status makes the whole response `207 Multi-Status` (HAP/HAPIPAccessoryServer.c:1861-1866).
- In a response where every read succeeded, `"status":0` is omitted from the individual objects; it is emitted on every object as soon as any one of them failed (HAP/HAPIPAccessoryProtocol.c:641-651).
- **`bool` values are serialized as the JSON numbers `1` and `0`, never as `true`/`false`.** Every IP serializer writes `unsignedIntValue ? "1" : "0"` — the attribute database, the read response, the write response and the event body alike (HAP/HAPIPAccessory.c:921-923; HAP/HAPIPAccessoryProtocol.c:666-668, 1767-1769, 1933-1935). The write path is *not* symmetric: it also accepts the literals `true`/`false` (§4.3).
- **A non-finite float is serialized as JSON `null`** — not as a number, and not as an error status. `HAPJSONUtilsGetFloatDescription` emits the four-byte literal `null` for any value failing `HAPFloatIsFinite`, so NaN, `+Inf` and `-Inf` all go out as `null` (HAP/HAPJSONUtils.c:202-241). Every float on the wire passes through it: the database (HAP/HAPIPAccessory.c:367-379, 934), the read response (HAP/HAPIPAccessoryProtocol.c:692-695), the write response (HAP/HAPIPAccessoryProtocol.c:1789) and events (HAP/HAPIPAccessoryProtocol.c:1951). The ADK's own test asserts exactly this for `-Inf`, `+Inf` and NaN on a `CurrentTemperature` characteristic (Tests/HAPIPAccessoryProtocolSerializeCharacteristicReadResponseTest.c:9-13, 149-195). The read is still reported as a **success**: the object carries `"status":0` with `"value":null`, so a plugin whose sensor arithmetic yields NaN for `CurrentTemperature`, `RotationSpeed` or `FilterLifeLevel` silently publishes `null` rather than an error. Inside `GET /accessories` that `null` is also indistinguishable from the `null` written when a read *fails* (HAP/HAPIPAccessory.c:903-919). Filter non-finite values in the plugin and return a real status instead (§6, item 36).
- Programmable Switch Event always reads as `null` over IP; the read handler is invoked only for event notifications (HAP/HAPIPAccessoryProtocol.c:652-664; HAP/HAPIPAccessory.c:890-902).
- A characteristic marked `ip.controlPoint` is not read during discovery: during `GET /accessories` it yields `-70402` rather than invoking the handler, so that stateful control points are not disturbed by discovery (HAP/HAPIPAccessoryServer.c:1787-1790; HAP/HAP.h:405-423). In the serialized database a control-point TLV8 characteristic emits `""`, and any characteristic whose read failed emits `null` (or `""` for TLV8) rather than a status (HAP/HAPIPAccessory.c:903-919).
- Only readable characteristics get a `value` key in the attribute database at all (HAP/HAPIPAccessory.c:836-844).
- Read handlers must not block; values that would take too long should be prefetched (HAP/HAP.h:733-734).
- The value a read handler returns must satisfy the characteristic's constraints; the ADK asserts this rather than clamping, so an out-of-range read is an accessory bug, not a recoverable error (HAP/HAP.h:735; HAP/HAPCharacteristic.c:494-497).

### 4.2 Writes

- A write object containing neither `value` nor `ev` is rejected with `-70410` (HAP/HAPIPAccessoryServer.c:877-881).
- Write permission is checked in this order: admin-write permission (`-70401`), admin-read permission when the write will produce a response (`-70401`), then `properties.writable` (`-70404`) (HAP/HAPIPAccessoryServer.c:935-946, 1278-1280).
- `authData` is base64-decoded before the handler runs; a decode failure is `-70410`. The decoded bytes are handed to the write handler, which is solely responsible for validating them and returning `kHAPError_NotAuthorized` (→ `-70411`) if they are insufficient (HAP/HAPIPAccessoryServer.c:948-961; HAP/HAP.h:396-403).
- `remote` is passed through to the write request structure so the handler can distinguish a local write from one relayed by a home hub (HAP/HAPIPAccessoryServer.c:985-986; HAP/HAPIPAccessoryProtocol.h:102).
- Write handlers must not block; long operations should queue the value (HAP/HAP.h:761-762).
- `PUT /characteristics` answers `204 No Content` only when every write succeeded *and* no write requested a response; a single failure or a single `"r":true` forces `207 Multi-Status` (HAP/HAPIPAccessoryServer.c:1362-1368, 1429-1435).
- A `PUT /characteristics` that parses to zero write contexts is `204 No Content` (HAP/HAPIPAccessoryServer.c:1419-1420).

### 4.3 Value validation and coercion

Validation happens in three layers, and a bridge must satisfy all three: the IP server's JSON type check, the characteristic layer's declared constraints, and a transport-level ceiling on the size of the value itself.

**Layer 1 — JSON type and format width (IP server).** The received JSON value type must match the characteristic format, or the write is `-70410` before any handler runs:

- `bool` accepts the JSON literals `true` and `false` **as well as** an unsigned integer ≤ 1. The parser **coerces** the literals before the format check ever runs: `true` becomes `unsignedIntValue = 1` and `false` becomes `0`, both tagged `kHAPIPWriteValueType_UInt` (HAP/HAPIPAccessoryProtocol.c:1250-1269), so by the time the server tests the value it sees only an unsigned integer and the check it applies is `type == kHAPIPWriteValueType_UInt && unsignedIntValue <= 1` (HAP/HAPIPAccessoryServer.c:999-1001). There is no boolean write-value type at all — the enum is `None`/`Int`/`UInt`/`Float`/`String` (HAP/HAPIPAccessoryProtocol.h:72-76). **A bridge implementing its own HAP server must accept `true`/`false` here**, or it will reject legitimate controller traffic; the rule stated in isolation ("an unsigned integer ≤ 1") is only the post-coercion half of it. The read/event direction is the mirror image and is *not* symmetric: values go out as `1`/`0`, never `true`/`false` (§4.1).
- `uint8`/`uint16`/`uint32` accept an unsigned integer within the type's width; `uint64` accepts any unsigned integer (HAP/HAPIPAccessoryServer.c:1020-1022, 1043-1045, 1062-1064, 1083-1084).
- `int` accepts a signed integer, and **coerces** an unsigned integer ≤ `INT32_MAX` into one (HAP/HAPIPAccessoryServer.c:1103-1107).
- `float` **coerces** both signed and unsigned integers into a float when they fit (HAP/HAPIPAccessoryServer.c:1128-1136). This is why a controller may legitimately send `50` to a float RotationSpeed.
- `string` accepts a JSON string of at most 256 bytes at this layer, independent of the characteristic's own `maxLength` (HAP/HAPIPAccessoryServer.c:1159-1161).
- `data` and `tlv8` accept a JSON string which is then base64-decoded; a decode failure is `-70410` (HAP/HAPIPAccessoryServer.c:961-996, 1196-1226).

**Layer 2 — declared constraints (characteristic layer).** Before the accessory's handler is called, the value is checked against the declared constraints, and a violation returns `kHAPError_InvalidData` → `-70410` (HAP/HAP.h:764; HAP/HAPCharacteristic.c:163-166 and per-format equivalents):

- Integer range rule: `value >= minimumValue && value <= maximumValue && (stepValue == 0 || (value - minimumValue) % stepValue == 0)`. Step alignment is measured **from `minimumValue`, not from zero**, and `stepValue == 0` disables the step check entirely (HAP/HAPCharacteristic.c:47-49).
- Float range rule uses a tolerance: the value must lie in range and, unless the step is zero, `(value - minimumValue) / stepValue` must be within 0.1 of an integer (HAP/HAPCharacteristic.c:51-56, 1269).
- Float values are **rounded to the step** — both after a read, before the value goes to the controller, and before a write reaches the handler — so a handler never sees an off-step float and a controller never sees one either (HAP/HAPCharacteristic.c:60-62, 1287-1294, 1330-1338, 1358-1365).
- String and data length rule: `length <= maxLength` (HAP/HAPCharacteristic.c:58, 1442). A read handler returning an over-long string, a non-UTF-8 string, or one that overruns the buffer is a fatal error, not a status code (HAP/HAPCharacteristic.c:1507-1528).
- `validValues` / `validValuesRanges` are enforced only for Apple-defined characteristic types. If both are NULL, any in-range value is accepted. Otherwise the value is accepted if it appears in `validValues` **or** falls inside any entry of `validValuesRanges`; otherwise the write fails with `kHAPError_InvalidData` and never reaches the handler (HAP/HAPCharacteristic.c:414-457). `validValues` is a NULL-terminated array of pointers to `uint8_t`; `validValuesRanges` is a NULL-terminated array of `{start, end}` with inclusive bounds (HAP/HAPCharacteristic.c:385-411).
- **Declaring both lists on the same characteristic is legal.** Nothing rejects it: the two are tested independently and the value is accepted if it satisfies *either*, which makes them a union rather than alternatives (HAP/HAPCharacteristic.c:432-443). Accessory validation contains no both-lists check (HAP/HAPAccessoryValidation.c:548-611), and the IP serializer emits both keys (§1.3). Several sibling documents in this set assert the opposite rule; see *Discrepancies*.
- Custom (non-Apple-defined) UInt8 characteristics must not declare `validValues` or `validValuesRanges` at all; the ADK asserts they are NULL (HAP/HAPCharacteristic.c:452-455) and refuses such a database at startup (HAP/HAPAccessoryValidation.c:551-561).

**Layer 3 — the 64000-byte ceiling on a value.** HAP caps any characteristic value at 64000 bytes: "The maximum length of an HAP characteristic value shall be 64000 bytes", citing HAP Specification R14 §7.4.1.7 *Maximum Payload Size*. In this ADK the ceiling is enforced in the BLE transport, which is the only code that checks it explicitly:

- **Writes.** A value longer than 64000 bytes is rejected with `kHAPError_InvalidData` — the error that maps to `-70410` (§3.2) — before the format switch runs, so the accessory's write handler never sees it (HAP/HAPBLECharacteristicParseAndWriteValue.c:271-277).
- **Reads.** The read handler is never offered more than 64000 bytes of buffer: `data`, `string` and `tlv8` reads are handed `maxBytes <= 64000 ? maxBytes : 64000`, so anything longer is truncated to the ceiling or fails with `kHAPError_OutOfResources`, and the serializer asserts the result is within it (HAP/HAPBLECharacteristicReadAndSerializeValue.c:29-32, 74-85, 280-291, 303-307).

The IP code path contains no explicit 64000 check — a repository-wide grep for `64000` matches only those two BLE files — so over IP the practical limit is the session buffer, which surfaces as `-70407` when the value does not fit (§3.1). The spec rule is nonetheless protocol-wide, and it is the ceiling a bridge should hold itself to on both transports. It binds any `data`, `string` or `tlv8` characteristic a plugin adds, and note the gap it leaves: a `data` characteristic may legally declare `maxLength` up to the 2097152-byte format default (§1.3), more than thirty times the value ceiling, so `maxDataLen` is no guarantee the value will survive the transport. INFERRED: that an IP-only bridge should enforce the ceiling anyway; the sources give the spec rule and the BLE enforcement, not an IP-side obligation.

**Database validation at startup** rejects: `minimumValue > maximumValue` for every numeric format; a negative `stepValue` on `int`; a NaN bound or negative step on `float`; a `validValues` list not in strictly ascending order; a `validValuesRanges` entry with `start > end`; and overlapping or unsorted `validValuesRanges` (HAP/HAPAccessoryValidation.c:530-710). It does **not** reject a characteristic declaring both `validValues` and `validValuesRanges`, and it does not police a NaN characteristic *value* — only NaN `minimumValue`/`maximumValue` bounds.

### 4.4 Event notifications (`ev`)

- Subscription is **per (session, characteristic)** and is changed by writing `"ev":true/false` in a `PUT /characteristics` object; the three states are undefined (key absent), disabled and enabled (HAP/HAPIPAccessoryProtocol.h:77-82; HAP/HAPIPAccessoryServer.c:883-929).
- A single write object may carry both `value` and `ev`; the subscription change is processed first, then the value write (HAP/HAPIPAccessoryServer.c:877-946).
- Subscribing to a characteristic without `supportsEventNotification` is `-70406`; subscribing when the per-session table is full is `-70407` (HAP/HAPIPAccessoryServer.c:887-889, 905-906).
- Subscribing to a characteristic whose read requires admin permission from a non-admin controller is `-70401`, and event values for such characteristics are delivered only to admin controllers (HAP/HAPIPAccessoryServer.c:884-886; HAP/HAP.h:344-366).
- Subscribe and unsubscribe are reported to the application through `handleSubscribe` / `handleUnsubscribe` callbacks, which cannot fail (HAP/HAPIPAccessoryServer.c:912, 929; HAP/HAP.h:788-812).
- Closing a session unsubscribes everything registered on it (HAP/HAPIPAccessoryServer.c:479-492).
- **The accessory must call `HAPAccessoryServerRaiseEvent` (or `…OnSession`) whenever the characteristic's value changes** — nothing is raised automatically by a successful write (HAP/HAP.h:322-330, 4291-4304).
- `RaiseEvent` does not send anything itself: it sets a pending flag on every subscribed session and arms a timer (HAP/HAPIPAccessoryServer.c:3937-4010).
- **Events are suppressed on the session that caused them.** While a write is being handled, an event raised for that same (session, characteristic, service, accessory) is not flagged for that session — the controller that wrote the value does not get an echo, though every other subscribed session does (HAP/HAPIPAccessoryServer.c:3977-3981).
- Events raised on a non-HAP session or a transient (software-authentication) session are skipped (HAP/HAPIPAccessoryServer.c:3963-3975).
- **Coalescing:** notifications are coalesced with a delay of no less than one second per session, per HAP R14 §6.8. The accessory keeps a per-session timestamp of the last notification burst; pending events are only flushed once at least `kHAPIPAccessoryServer_MaxEventNotificationDelay` (1 s) has elapsed since that stamp (HAP/HAPIPAccessoryServer.c:146, 3266-3300, 3416).
- **The single exception** whitelisted in this ADK is Programmable Switch Event, which bypasses coalescing and is delivered immediately (HAP/HAPIPAccessoryServer.c:3275-3300).
- Events are delivered on the controller's existing connection as an `EVENT/1.0 200 OK` message with `Content-Type: application/hap+json` and the same `{"characteristics":[…]}` body shape as a read response; the values are obtained by performing real reads at flush time, not by capturing the value at raise time (HAP/HAPIPAccessoryServer.c:3324-3356).
- Events are only written to a session that is idle in the reading state with an empty inbound buffer, so an in-flight request is never interleaved with an event (HAP/HAPIPAccessoryServer.c:3249-3256, 713-716).
- The event connection is unidirectional, accessory → controller, and is established by the controller; only secured controllers can subscribe (HAP/HAP.h:320-327).

### 4.5 Write response (`wr` / `"r":true`)

- If `properties.ip.supportsWriteResponse` is set, then after **every** successful write the server immediately performs a read of the same characteristic, with no other request in between (HAP/HAPIPAccessoryServer.c:1229-1247; HAP/HAP.h:426-436).
- The read's status replaces the write's status. If the controller asked for the value with `"r":true`, the read value is copied into the write context and emitted as `"value"` alongside `"status":0` in the `207 Multi-Status` body; if it did not, the value is discarded and the data buffer rolled back (HAP/HAPIPAccessoryServer.c:1248-1272; HAP/HAPIPAccessoryProtocol.c:1763-1815).
- `"r":true` on a characteristic that does **not** declare `wr` is `-70405` (read from a write-only characteristic) (HAP/HAPIPAccessoryServer.c:1273-1275).
- A characteristic declaring `wr` must also be writable and must supply both a read and a write handler, or the accessory database is rejected at startup (HAP/HAPAccessoryValidation.c:414-441).

### 4.6 Timed writes (`tw`, `/prepare`, `pid`)

- `PUT /prepare` with `{"ttl":…,"pid":…}` starts a timed-write transaction on that session: the expiry is `now + ttl` and the PID is stored. Consecutive prepare requests on the same session **reset** the transaction to the latest TTL and PID (HAP/HAPIPAccessoryServer.c:590-612, citing R14 §6.7.2.4).
- The accessory answers `200 OK` with `{"status":0}`; the ADK notes the specification does not document when this should fail (HAP/HAPIPAccessoryServer.c:614-628).
- The following `PUT /characteristics` must carry a top-level `pid`. The write is rejected — every context set to `-70410` — if the TTL has expired, if the PID does not match, or if a `pid` is present when no transaction was prepared (HAP/HAPIPAccessoryServer.c:1404-1416).
- A plain (non-timed) write to a characteristic declaring `requiresTimedWrite` is `-70410` (HAP/HAPIPAccessoryServer.c:1339-1350).
- The transaction is single-use: after a write carrying a valid `pid`, the expiry and PID are cleared (HAP/HAPIPAccessoryServer.c:1438-1440).
- Timed writes exist so that security-class characteristics (Lock Target State, Target Door State) only execute when the accessory can be reached within a short window (HAP/HAP.h:370-379).
- The transaction is bound to the session, so a bridge must keep per-connection state; it is not global to the accessory (HAP/HAPIPAccessoryServer.c:605-612).

### 4.7 Prepare vs. batching

The `/prepare` endpoint is *only* the timed-write preamble. There is no separate "prepared write" batching mechanism in HAP over IP: a `PUT /characteristics` body already carries an array of write objects, which are applied in order, each with its own status, and a parse failure rejects the whole request while a per-characteristic failure is reported individually (HAP/HAPIPAccessoryProtocol.c:1550-1675; HAP/HAPIPAccessoryServer.c:1314-1368). The batch is **not** atomic — earlier writes in the array have already taken effect when a later one fails.

### 4.8 Session and visibility rules

- Requests on a session that has not completed Pair-Verify get `470 Connection Authorization Required`, with `{"status":-70411}` on the characteristic endpoints (HAP/HAPIPAccessoryServer.c:110-117).
- The Service Signature characteristic is not exposed over IP at all (HAP/HAPIPCharacteristic.c:9-15).
- Sessions idle longer than 60 s may be closed, but only during shutdown or at maximum session capacity (HAP/HAPIPAccessoryServer.c:136-143).

---

## 5. HomeKit framework / Home app view

### 5.1 Reading and writing from a controller

| API | Availability | Behaviour | Source |
| --- | --- | --- | --- |
| `HMCharacteristic.value` | iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0, tvOS 10.0, visionOS 1.0, watchOS 2.0 | "the last value that the system saw"; may change without your app changing it; call `readValue` to be sure | /documentation/homekit/hmcharacteristic/value |
| `readValue(completionHandler:)` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 | Value lands in `value` after completion | /documentation/homekit/hmcharacteristic/readvalue(completionhandler:) |
| `writeValue(_:completionHandler:)` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 | Completion carries `nil` or an error; "involves network access" | /documentation/homekit/hmcharacteristic/writevalue(_:completionhandler:); /documentation/homekit/configuring-a-home-automation-device |
| `enableNotification(_:completionHandler:)` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 | The controller-side counterpart of the HAP `ev` subscription | /documentation/homekit/hmcharacteristic/enablenotification(_:completionhandler:) |
| `isNotificationEnabled` | iOS 8.0 / tvOS 10.0 / watchOS 2.0 | Whether the characteristic is set to send notifications | /documentation/homekit/hmcharacteristic/isnotificationenabled |
| `updateAuthorizationData(_:completionHandler:)` | iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0, visionOS 1.0 — **not listed for tvOS or watchOS** | Sets or clears the `authData` used when writing | /documentation/homekit/hmcharacteristic/updateauthorizationdata(_:completionhandler:) |

Apple's own sample guidance is to subscribe only where the accessory advertises support: apps filter on `properties.contains(HMCharacteristicPropertySupportsEventNotification)` before calling `enableNotification(true)` (/documentation/homekit/configuring-a-home-automation-device).

Event delivery reaches the app as `accessory(_:service:didUpdateValueFor:)`, and Apple is explicit that "this method is called as a result of a change in value initiated by the accessory. Programmatic changes initiated by the app do not result in this method being called" (/documentation/homekit/hmaccessorydelegate/accessory(_:service:didupdatevaluefor:)). The `value` page states the same rule from the other side: "You only receive updates for changes made outside your app, for example by Apple's Home app, or by the accessory itself" (/documentation/homekit/hmcharacteristic/value). This matches the ADK's suppression of the echo to the writing session (§4.4).

### 5.2 `HMCharacteristicProperties`

The published "Characteristic Properties" collection lists only three constants — `HMCharacteristicPropertyReadable`, `HMCharacteristicPropertyWritable`, `HMCharacteristicPropertyHidden` (/documentation/homekit/characteristic-properties). Two further property constants exist as their own symbols:

| Constant | Availability | Meaning | Source |
| --- | --- | --- | --- |
| `HMCharacteristicPropertyReadable` | iOS 8.0 | The characteristic is readable | /documentation/homekit/characteristic-properties |
| `HMCharacteristicPropertyWritable` | iOS 8.0 | The characteristic is writable | /documentation/homekit/characteristic-properties |
| `HMCharacteristicPropertyHidden` | iOS 9.3, iPadOS 9.3, Mac Catalyst 9.3, tvOS 10.0, visionOS 1.0, watchOS 2.2 | Should be hidden from the user | /documentation/homekit/hmcharacteristicpropertyhidden |
| `HMCharacteristicPropertySupportsEventNotification` | iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0 (Swift) / Mac Catalyst 14.0 (Obj-C), tvOS 10.0, visionOS 1.0, watchOS 2.0 | Supports event notifications | /documentation/homekit/hmcharacteristicpropertysupportseventnotification-2f0ml; …-19wy1 |
| `HMCharacteristicPropertyRequiresAuthorizationData` | **iOS 18.0**, iPadOS 18.0, Mac Catalyst 18.0, tvOS 18.0, visionOS 2.0, watchOS 11.0 | Requires authorization data to write | /documentation/homekit/hmcharacteristicpropertyrequiresauthorizationdata |

There is **no** published `HMCharacteristicProperty` constant corresponding to the HAP `tw` (timed write) or `wr` (write response) tokens in the crawled documentation. `properties` is a plain `[String]` that the app tests with `contains` (/documentation/homekit/hmcharacteristic/properties).

### 5.3 `HMCharacteristicMetadata`

`HMCharacteristicMetadata` (class, iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0, tvOS 10.0, visionOS 1.0, watchOS 2.0) is how a controller learns "the underlying units, minima, and maxima, and other aspects of the characteristic value" for presentation (/documentation/homekit/hmcharacteristicmetadata).

| Property | Type | Availability | Corresponds to | Source |
| --- | --- | --- | --- | --- |
| `format` | `String?` | iOS 8.0 | wire `format` | /documentation/homekit/hmcharacteristicmetadata/format |
| `units` | `String?` | iOS 8.0 | wire `unit` | /documentation/homekit/hmcharacteristicmetadata/units |
| `minimumValue` | `NSNumber?` | iOS 8.0 | `minValue`; "only applies to characteristics with a number type" | /documentation/homekit/hmcharacteristicmetadata/minimumvalue |
| `maximumValue` | `NSNumber?` | iOS 8.0 | `maxValue`; number types only | /documentation/homekit/hmcharacteristicmetadata/maximumvalue |
| `stepValue` | `NSNumber?` | iOS 8.0 | `minStep`; "the minimum interval between values"; number types only | /documentation/homekit/hmcharacteristicmetadata/stepvalue |
| `validValues` | `[NSNumber]?` | **iOS 10.0**, iPadOS 10.0, Mac Catalyst 13.1, tvOS 10.0, visionOS 1.0, watchOS 3.0 | `valid-values`; "when the format is of type unsigned integer" | /documentation/homekit/hmcharacteristicmetadata/validvalues |
| `maxLength` | `NSNumber?` | iOS 8.0 | `maxLen`; "maximum number of UTF-8 characters … string format" | /documentation/homekit/hmcharacteristicmetadata/maxlength |
| `manufacturerDescription` | `String?` | iOS 8.0 | wire `description` | /documentation/homekit/hmcharacteristicmetadata/manufacturerdescription |

Every metadata property is optional; a controller must cope with all of them being `nil`, which is exactly what happens when the accessory omits the key because it matches the format default (§1.3).

Notable asymmetries with the ADK:

- **There is no `validValuesRange` property on `HMCharacteristicMetadata`** in the crawled documentation — only the flattened `validValues` list. An accessory that advertises `valid-values-range` instead of `valid-values` gives the controller no metadata-level enumeration.
- The published format constants include `HMCharacteristicMetadataFormatArray` and `HMCharacteristicMetadataFormatDictionary`, which have **no HAP wire format** in the ADK's ten-value enum (/documentation/homekit/characteristic-data-formats).
- The published unit constants include `HMCharacteristicMetadataUnitsFahrenheit`, `…UnitsPartsPerMillion` and `…UnitsMicrogramsPerCubicMeter`, none of which exist in the ADK's six-unit enum (/documentation/homekit/characteristic-units vs HAP/HAPIPAccessoryProtocol.c:821-838).
- `maxLength` is documented in *UTF-8 characters* while the ADK enforces `maxLength` in *bytes* (/documentation/homekit/hmcharacteristicmetadata/maxlength vs HAP/HAPCharacteristic.c:58, 1442).

### 5.4 `HMError` codes a controller surfaces

HomeKit errors arrive in the `HMErrorDomain` with cases from `HMError.Code` (/documentation/homekit/hmerror; /documentation/homekit/hmerrordomain). The crawled pages give **no raw integer values** for any case — `HMError.Code` is documented only as an `enum Code` with an `init?(rawValue: Int)` (/documentation/homekit/hmerror/code; /documentation/homekit/hmerror/code/init(rawvalue:)), so no HAP-status-to-HMError mapping table can be stated from these sources.

| `HMError.Code` case | Availability | Apple's description | Plausible HAP origin |
| --- | --- | --- | --- |
| `readOnlyCharacteristic` | iOS 8.0 | "An attempt to modify a read-only value." | `-70404` (INFERRED) |
| `writeOnlyCharacteristic` | iOS 8.0 | "An attempt to read from a write-only characteristic." | `-70405` (INFERRED) |
| `notificationNotSupported` | iOS 8.0 | "An attempt to register for notifications from an accessory that does not support notifications." | `-70406` (INFERRED) |
| `notificationAlreadyEnabled` | iOS 8.0 | "An error indicating the notification is already enabled." | controller-side |
| `insufficientPrivileges` | iOS 8.0 | "An error indicating insufficient privileges for the operation." | `-70401` (INFERRED) |
| `accessDenied` | iOS 8.0 | "the current user doesn't have privileges to perform the operation" | controller-side |
| `invalidOrMissingAuthorizationData` | iOS 10.0, iPadOS 10.0, Mac Catalyst 13.1, tvOS 10.0, visionOS 1.0, watchOS 3.0 | "the authorization data is invalid or missing" | `-70411` (INFERRED) |
| `accessoryNotReachable` | iOS 8.0 | "the accessory is not reachable over the network" | no HAP response at all |
| `bridgedAccessoryNotReachable` | iOS 10.0, iPadOS 10.0, Mac Catalyst 13.1, tvOS 10.0, visionOS 1.0, watchOS 3.0 | "the bridged accessory cannot be reached" | bridge reachable, bridged accessory not |
| `timedOutWaitingForAccessory` | **iOS 14.0**, iPadOS 14.0, Mac Catalyst 14.0, tvOS 14.0, visionOS 1.0, watchOS 7.0 | "An accessory did not respond timely." | no response in time |
| `operationTimedOut` | iOS 8.0 | "the operation timed out" | controller-side timeout |
| `accessoryIsBusy` | iOS 8.0 | "the accessory is busy" | `-70403` (INFERRED) |
| `accessoryOutOfResources` | iOS 8.0 | "the accessory is out of resources" | `-70407` (INFERRED) |
| `accessoryPoweredOff` | iOS 8.0 | "the accessory is off" | — |
| `accessoryIsSuspended` | **iOS 15.0**, iPadOS 15.0, Mac Catalyst 15.0, tvOS 15.0, visionOS 1.0, watchOS 8.0 | "The accessory is suspended." | — |
| `accessoryIsBlocked` | iOS 8.0 | "An error indicating a blocked accessory." | — |
| `accessoryResponseError` | iOS 8.0 | "An error with the accessory's response." | non-zero `status` (INFERRED) |
| `accessorySentInvalidResponse` | iOS 8.0 | "the accessory sent an invalid response" | malformed JSON from the accessory |
| `accessoryCommunicationFailure` | **iOS 14.0**, iPadOS 14.0, Mac Catalyst 14.0, tvOS 14.0, visionOS 1.0, watchOS 7.0 | "The accessory failed to communicate." | — |
| `communicationFailure` | iOS 8.0 | "A communication failure." | — |
| `partialCommunicationFailure` | **iOS 17.4**, iPadOS 17.4, Mac Catalyst 17.4, tvOS 17.4, visionOS 1.1, watchOS 10.4 | *(no description published)* | a `207 Multi-Status` with mixed results (INFERRED) |
| `readWriteFailure` | iOS 8.0 | "a failed read/write operation" | — |
| `readWritePartialSuccess` | iOS 8.0 | "a partially successful read/write operation" | `207 Multi-Status` (INFERRED) |
| `valueHigherThanMaximum` | iOS 8.0 | "a numeric value higher than the specified maximum value" | rejected client-side against metadata (INFERRED) |
| `valueLowerThanMinimum` | iOS 8.0 | "a numeric value lower than the specified minimum value" | rejected client-side against metadata (INFERRED) |
| `stringLongerThanMaximum` | iOS 8.0 | "a string longer than the maximum allowed" | rejected client-side against `maxLength` (INFERRED) |
| `invalidValueType` | iOS 8.0 | "An attempt to use an invalid value type." | rejected client-side against `format` (INFERRED) |
| `invalidDataFormatSpecified` | iOS 8.0 | "an invalid data format was specified" | — |
| `notFound` | iOS 8.0 | "the object was not found in the container" | `-70409` (INFERRED) |
| `operationNotSupported` | iOS 8.0 | "An attempt to use an unsupported operation." | `-70402` (INFERRED) |
| `objectNotAssociatedToAnyHome` | iOS 8.0 | "an operation on an object that is not associated to any home" | controller-side |
| `referToUserManual` | iOS 8.0 | "An error described in the device's user manual." | device-specific condition |

Every "plausible HAP origin" entry above marked INFERRED is my mapping, not documented by Apple: the crawled pages never connect an `HMError.Code` case to a HAP status code.

### 5.5 Reachability

- `HMAccessory.isReachable` (iOS 8.0, iPadOS 8.0, Mac Catalyst 8.0, tvOS 10.0, visionOS 1.0, watchOS 2.0) is "A Boolean value indicating whether the accessory can be communicated with in the current network environment" (/documentation/homekit/hmaccessory/isreachable).
- Changes are announced through `accessoryDidUpdateReachability(_:)` (/documentation/homekit/hmaccessorydelegate/accessorydidupdatereachability(_:)).
- Reachability is tracked **per `HMAccessory`**, and a bridge's bridged accessories are separate `HMAccessory` instances, which is why a distinct `bridgedAccessoryNotReachable` code exists (/documentation/homekit/hmerror/code/bridgedaccessorynotreachable).
- Neither source states a timeout after which a controller declares an accessory unreachable, nor the mDNS/TCP conditions that flip `isReachable`. The ADK contains no notion of accessory-side unreachability at all: an accessory that cannot talk to its backend must answer the request with a status code, because from the controller's point of view a reachable-but-failing accessory and an unreachable one are different errors (§6).

### 5.6 How the Home app presents this

Each item the user names is an `HMService`, not an `HMAccessory`: "Each item that the user names in step 4 appears in the Home app as an 'accessory'. However, in HomeKit, these are `hmservice` instances. They are owned by an `hmaccessory` instance that represents the physical device" (/documentation/homekit/configuring-a-home-automation-device). A bridge exposing several services per device therefore produces several Home app tiles, each separately named and roomed, but a single reachability state shared by the whole bridged accessory.

---

## 6. Implications for a bridge plugin

### Advertising the attribute database

1. **Declare only the permissions you implement.** `pr` requires a read handler, `pw` a write handler, `ev` a read handler, `wr` both — the ADK refuses to start otherwise (HAP/HAPAccessoryValidation.c:324-441). A bridge that generates its database dynamically must enforce the same invariants itself, because a controller that subscribes to an `ev` characteristic you cannot read will simply never see updates.
2. **Do not emit metadata that equals the default.** Emitting `"maxLen":64` or a full-width `minValue`/`maxValue` is redundant; the reference server suppresses both (HAP/HAPIPAccessory.c:1301-1320; HAP/HAPIPAccessoryProtocol.c:860-1042). INFERRED: harmless but wasteful, and it inflates the chunked `GET /accessories` response, which is the single largest message a bridge sends.
3. **Never invent `validValues` on a custom characteristic type.** Valid-value constraints are legal only on Apple-defined types; the ADK asserts and refuses otherwise (HAP/HAPAccessoryValidation.c:551-561; HAP/HAPCharacteristic.c:452-455).
4. **Advertise `valid-values` rather than only `valid-values-range` when you want the Home app to know the enumeration**, because `HMCharacteristicMetadata` exposes `validValues` and has no range equivalent (/documentation/homekit/hmcharacteristicmetadata/validvalues). INFERRED from the absence of a range property in the crawled documentation.
5. **Sort `validValues` strictly ascending and keep `validValuesRanges` sorted and non-overlapping** (HAP/HAPAccessoryValidation.c:562-611). Declaring *both* lists is permitted — see §4.3.
6. **For a target-state characteristic, advertise only the states the device can actually reach.** If a heater-only device cannot cool, list only the reachable target states in `valid-values`; the HAP layer will then reject any other value with `-70410` before your handler sees it (HAP/HAPCharacteristic.c:432-451). INFERRED as guidance: the sources state the enforcement mechanism, not the modelling advice.

### Representing N discrete steps on a 0–100 percentage

7. **Use `minStep` to quantise, and remember step alignment is measured from `minValue`.** For a fan with N discrete speeds on a 0–100 percentage, set `minValue = 0`, `maxValue = 100`, `minStep = 100/N` only when that divides evenly; otherwise the integer rule `(value - minimumValue) % stepValue == 0` will reject legitimate controller values (HAP/HAPCharacteristic.c:47-49). For 4 speeds, `minStep = 25` works; for 3 speeds, no integer step divides 100, so the correct choice is `minStep = 1` (or a float characteristic) plus snapping in the plugin. INFERRED: the arithmetic rule is sourced; the modelling conclusion is mine.
8. **Prefer a float characteristic when you want forgiving quantisation.** Float validation uses a 0.1 tolerance on step alignment and the server *rounds* the value to the step on both read and write, so the handler never sees an off-step value and the controller never sees one (HAP/HAPCharacteristic.c:51-56, 1269, 1287-1294). Integer formats do not round — they reject.
9. **Do not rely on the controller sending a float for a float characteristic.** The IP server coerces integers to float (and unsigned to signed int), so `50` and `50.0` both arrive as `50.0f` (HAP/HAPIPAccessoryServer.c:1103-1136). A bridge implementing its own HAP server must perform the same coercion or it will reject valid controller traffic.
10. **Report back the quantised value, not the requested one.** After snapping a percentage to a discrete speed, the accessory's own state has changed to a different value than was written; raise an event so other controllers converge (§4.4), and note that the writing controller will not receive that event (HAP/HAPIPAccessoryServer.c:3977-3981) — it learns the real value on its next read. If you want it to learn immediately, declare `wr` so every write is followed by a read and the post-write value is returned (HAP/HAPIPAccessoryServer.c:1229-1272). INFERRED: the mechanisms are sourced; choosing `wr` for this purpose is my recommendation.

### Events

11. **Raise an event on every externally-originated state change.** Apple is explicit that a controller only learns of changes made outside its own app (/documentation/homekit/hmcharacteristic/value), and the ADK raises nothing automatically (HAP/HAP.h:322-330). A device changed by a physical switch, a vendor app, or a timer expiring must produce a `HAPAccessoryServerRaiseEvent`-equivalent, or Home app tiles will show stale state indefinitely.
12. **Do not raise an event when the value did not change.** Apple's own reference handlers compare first and raise only on a real change, avoiding redundant notifications (Applications/Lightbulb/App.c:169-175; Applications/Lock/App.c:222-226).
13. **Coalesce with a one-second floor per connection.** Batching pending events into a single `EVENT/1.0` message no more often than once per second per session is the specified behaviour, not an optimisation (HAP/HAPIPAccessoryServer.c:146, 3266-3300). A bridge that emits an event per sensor sample will be misbehaving even if every event is individually correct.
14. **Do not coalesce Programmable Switch Event.** It is the one whitelisted immediate-delivery characteristic, and it must also read as `null` over IP (HAP/HAPIPAccessoryServer.c:3275-3300; HAP/HAPIPAccessoryProtocol.c:652-664).
15. **Never send an event on a connection with a request in flight.** Flush only when the session is idle and its inbound buffer is empty (HAP/HAPIPAccessoryServer.c:3249-3256).
16. **Track subscriptions per connection and drop them when the connection closes** (HAP/HAPIPAccessoryServer.c:479-492); subscription state is per (session, characteristic), never global.
17. **Return `-70406`, not `0`, when a controller subscribes to something that cannot notify** (HAP/HAPIPAccessoryServer.c:887-889). Silently accepting the subscription produces a controller that waits forever.

### Errors, and what to do when the device is unreachable

18. **Answer every request.** The controller distinguishes "accessory not reachable" (no response at all) from "accessory responded with an error" (`accessoryResponseError`, `accessoryIsBusy`, …) (/documentation/homekit/hmerror/code/accessorynotreachable vs …/accessoryresponseerror). A bridge whose backend device is offline is itself still reachable, so it **must** reply.
19. **Use `-70402` for a device that is offline or unresponsive** — "unable to perform operation with requested service or characteristic" is the status the ADK produces from `kHAPError_Unknown` and `kHAPError_InvalidState` (HAP/HAPIPAccessoryServer.c:829-834). This is the correct answer for a bridged device that cannot be contacted right now.
20. **Use `-70403` for a transient failure worth retrying** — `kHAPError_Busy` means "the request failed temporarily" (HAP/HAP.h:747; HAP/HAPIPAccessoryServer.c:844-846). Prefer it over `-70402` when the condition is momentary, so the controller can surface `accessoryIsBusy` rather than a hard failure. INFERRED: the mapping is sourced; the preference between the two is my recommendation.
21. **Do not emit `-70408`.** It is not defined anywhere in this ADK; a timeout inside your bridge should surface as `-70403` (retryable) or `-70402` (HAP/HAPIPAccessoryServer.c:31-62).
22. **Never block a read or write handler waiting for a device.** Both handler contracts require non-blocking behaviour — prefetch on the read side, queue on the write side (HAP/HAP.h:733-734, 761-762). A blocking handler stalls the whole session, including its event flushes, and turns a slow device into an accessory the controller reports as unreachable. INFERRED for the consequence; the non-blocking requirement itself is sourced.
23. **Serve reads from a cache when the device is slow.** Because a read handler cannot block and the last-known value is what the controller shows anyway (/documentation/homekit/hmcharacteristic/value), a bridge should return its cached state immediately and raise an event when the real value arrives. INFERRED.
24. **Do not return `kHAPError_InvalidData` from a read handler** — it is a fatal error in the read path (HAP/HAPIPAccessoryServer.c:1472-1474) and is documented only for writes (HAP/HAP.h:744-748 vs 772-778).
25. **Return per-characteristic statuses, not a whole-request failure.** A batch with one bad characteristic should be `207 Multi-Status` with that one context carrying the error, not a `400` (HAP/HAPIPAccessoryProtocol.c:644-651, 1753-1763). Reserve `400` for genuinely unparseable bodies.
26. **Remember the batch is not atomic.** Writes before the failing one have already taken effect (§4.7); if a plugin needs all-or-nothing semantics across characteristics it must implement them itself. INFERRED.

### Timed writes, write response, authorization

27. **Declare `tw` on security-class characteristics only** (lock target state, door target state), and be prepared to keep the per-session `pid`/TTL state and reject plain writes with `-70410` (HAP/HAP.h:370-379; HAP/HAPIPAccessoryServer.c:1339-1350, 1404-1416).
28. **Reset, do not stack, a timed-write transaction** when a second `/prepare` arrives on the same session, and clear it after a single successful execute (HAP/HAPIPAccessoryServer.c:596-612, 1438-1440).
29. **`wr` means every write triggers a read, not just the ones asking for a value.** Declaring it on a characteristic whose read is expensive doubles the cost of every write (HAP/HAPIPAccessoryServer.c:1229-1247). INFERRED consequence.
30. **Reject `"r":true` with `-70405` if you do not implement `wr`** (HAP/HAPIPAccessoryServer.c:1273-1275).
31. **If you declare `aa`, actually validate `authData` and return `-70411` when it is wrong.** The transport only base64-decodes it; validation is entirely the handler's job (HAP/HAP.h:396-403; HAP/HAPIPAccessoryServer.c:948-961). Note that `HMCharacteristicPropertyRequiresAuthorizationData` only became visible to controller apps in iOS 18.0 (/documentation/homekit/hmcharacteristicpropertyrequiresauthorizationdata).

### Discovery

32. **Mark stateful control points `ip.controlPoint`** so they are not read during `GET /accessories`; the database will carry `-70402` (or `""` for TLV8) instead of invoking your handler (HAP/HAP.h:405-423; HAP/HAPIPAccessoryServer.c:1787-1790; HAP/HAPIPAccessory.c:903-906).
33. **Populate `manufacturerDescription`** if you want the Home app and third-party apps to have a human-readable label: it is the only source of `HMCharacteristicMetadata.manufacturerDescription`, and the key is omitted entirely when it is NULL (HAP/HAPIPAccessory.c:1099-1111; /documentation/homekit/hmcharacteristicmetadata/manufacturerdescription).
34. **Do not expose Service Signature over IP** (HAP/HAPIPCharacteristic.c:9-15).

### Value encoding and size limits

35. **Accept `true`/`false` on a bool write; emit `1`/`0` on a bool read.** The two directions differ, and a bridge that implements only the read-side convention will reject legitimate controller writes. The reference server coerces the JSON literals to `1`/`0` before validating (HAP/HAPIPAccessoryProtocol.c:1250-1269) and serializes bools as bare numbers in every response and event (HAP/HAPIPAccessory.c:921-923; HAP/HAPIPAccessoryProtocol.c:666-668, 1767-1769, 1933-1935).
36. **Never let a non-finite float reach the serializer.** NaN, `+Inf` and `-Inf` are emitted as `"value":null` alongside `"status":0` — a successful read of nothing (HAP/HAPJSONUtils.c:202-241; Tests/HAPIPAccessoryProtocolSerializeCharacteristicReadResponseTest.c:149-195). Any sensor arithmetic that can divide by zero or average an empty window — temperature, `RotationSpeed`, `FilterLifeLevel` — must be guarded in the plugin, which should return `-70402` (device state unknown) or `-70403` (retry) instead of publishing `null`. INFERRED: the serialization behaviour is sourced; choosing a status over `null` is my recommendation.
37. **Keep every characteristic value under 64000 bytes.** It is a spec-level ceiling on the value itself, independent of the characteristic's declared `maxLength`: over 64000 bytes a write is rejected as invalid data and a read is capped at the ceiling (HAP/HAPBLECharacteristicParseAndWriteValue.c:271-277; HAP/HAPBLECharacteristicReadAndSerializeValue.c:29-32, 74-85). Relevant to every `data`, `string` and `tlv8` characteristic a plugin adds, and a reason not to declare a multi-megabyte `maxDataLen` you intend to fill (§4.3).
38. **Use `valid-values` freely over IP — it does reach the controller.** `GET /accessories` carries `valid-values` and `valid-values-range` for Apple-defined UInt8 characteristics (HAP/HAPIPAccessory.c:1516-1525, 1573, 1643); only the `GET /characteristics?meta=1` read response omits them (HAP/HAPIPAccessoryProtocol.c:860-1042). Restricting a target-state enumeration through `valid-values` is therefore effective over IP, not just BLE, and both lists may be declared together when an enumeration has both scattered members and a contiguous span (§4.3).

---

## 7. Discrepancies

- **ADK commit date.** The brief dates commit `fb201f98` to 2021-10-23; `git log` on the snapshot reports `fb201f98f5fdc7fef6a455054f08b59cca5d1ec8`, "Sun Sep 5 22:34:39 2021 +0800". The commit hash is the authoritative identifier; the date in the brief does not match the snapshot.
- **`-70408` (OPERATION_TIMED_OUT).** Named in the topic brief but absent from both primary sources: the ADK defines no such constant (HAP/HAPIPAccessoryServer.c:31-62) and Apple publishes no numeric HAP status codes. Documented above as non-existent rather than guessed.
- **`-70403` (RESOURCE_BUSY).** Present in the ADK but missing from the brief's list; included above because a bridge needs it.
- **Reader facts vs. primary source on `validValues` enforcement.** The reader note in `adk-11.md` states valid-values are enforced "ONLY for Apple-defined characteristic types", which the primary source confirms (HAP/HAPCharacteristic.c:432-455); no correction needed. The related reader claim that reads are "asserted to return only values in the set" is also confirmed (HAP/HAPCharacteristic.c:494-497) — note this is an assertion, so in a release build with assertions disabled an out-of-set read value would pass through unchecked.
- **`maxLength` units.** The ADK enforces bytes; Apple documents `maxLength` as "UTF-8 characters". For multi-byte characters these differ. Primary-source behaviour (bytes) governs the accessory side.
- **Format and unit sets.** Apple's published constants include formats (`Array`, `Dictionary`) and units (`Fahrenheit`, `PartsPerMillion`, `MicrogramsPerCubicMeter`) that have no HAP wire representation in this ADK. Both sources are "primary" for their own side; the divergence is real and recorded rather than resolved.

### Contradictions within this document set

- **Whether `valid-values` reaches controllers over IP — `fans.md` is wrong.** `fans.md:122` states that "The IP transport does **not** serialize valid-values into the characteristic object — only `format`, `unit`, `minValue`, `maxValue`, `minStep`, `perms` and `ev` appear there", and `fans.md:183` draws plugin advice from it ("the IP transport does not transmit valid-values at all … so min/max are the constraint controllers actually see over IP"). The primary source contradicts both: `GET /accessories` emits `"valid-values"` and `"valid-values-range"` for Apple-defined UInt8 characteristics (HAP/HAPIPAccessory.c:1516-1525, 1573, 1643), and the emission does not depend on any range key being present (HAP/HAPIPAccessory.c:1216-1221, 1513-1530). `fans.md`'s own citation (HAP/HAPIPAccessoryProtocol.c:729-1010) covers only the `GET /characteristics` read-response serializer, which indeed has no valid-values branch — the narrower claim this document makes in §1.3. That claim does not generalise to the attribute database. **§1.3 here and `heating.md:104,146` win; `fans.md:122,183` should be corrected.** This is the one contradiction in the set that produces actively wrong implementation advice: `heating.md` and `purifier-filter-occupancy-covering.md` both tell plugins to restrict `TargetHeaterCoolerState` / `TargetAirPurifierState` through `valid-values`, and that advice is sound.
- **Whether declaring both `validValues` and `validValuesRanges` fails validation — all three documents were wrong, this one included.** `fans.md:121` ("a characteristic must not declare both lists at once; violations fail accessory validation") and `heating.md:105,145` ("An accessory must not declare both …") assert an enforced rule; this document's §1.3 implied the converse rule by emitting `valid-values-range` only when `validValues` was unset. No such check exists. `HAPAccessoryValidation.c:548-611` verifies exactly three things: the characteristic type is Apple-defined (551-561), `validValues` is strictly ascending (562-579), and each `validValuesRanges` entry satisfies `start <= end` with the entries ascending and non-overlapping (580-611). Both lists together are legal, behave as a union at write time (HAP/HAPCharacteristic.c:432-443), and are both serialized, `valid-values` first (HAP/HAPIPAccessory.c:1604-1612). **The source wins; §1.3 and §4.3 above are corrected here, and the assertions in `fans.md` and `heating.md` should be struck.**
- **The status of the 64-byte string maximum.** Four documents describe it four ways: `fans.md:230` calls "the 64-character limit seen in sample databases … an application choice, not a spec constraint stated in the header"; `lights-switches.md:26,41,53,65` calls it "maxLength 64 in the ADK example … not a spec range"; `accessory-model.md:20-25,167` treats 64 bytes as a validated hard limit; this document treats 64 as the format default whose effect is to suppress the `maxLen` key. **The default reading wins.** `kHAPIPAccessorySerialization_DefaultMaxStringBytes = 64` is documented as the HAP default for string characteristics, citing R14 Table 6-3 (HAP/HAPIPAccessory.c:11-17), and `maxLen` is emitted only when a characteristic's `maxLength` differs from it (HAP/HAPIPAccessory.c:1301-1307). `accessory-model.md` is right within a narrower scope: 64 bytes *is* a validated hard limit, but only for the four accessory-level strings — name, manufacturer, model and serial number (HAP/HAPAccessoryValidation.c:13-58). `fans.md`'s "application choice" framing is the outlier, and it leaves the Fan service's `Name` row as the only `Name` row in the set with no length stated.

---

## 8. Open questions

Neither source answers these:

1. The numeric raw values of `HMError.Code`, and therefore any authoritative HAP-status-to-`HMError` mapping.
2. Which HAP status code produces which `HMError` case, and whether a controller distinguishes `-70402` from `-70403` in the error it surfaces.
3. The controller-side timeout after which a request fails with `timedOutWaitingForAccessory` or `accessoryNotReachable`, and the conditions that flip `HMAccessory.isReachable`.
4. Whether a controller retries a `-70403` automatically, and with what backoff.
5. How a controller behaves when an accessory advertises `valid-values-range` but not `valid-values`, given that `HMCharacteristicMetadata` exposes no range property.
6. Whether the Home app enforces `minStep` in its own UI before writing, or writes arbitrary values and relies on the accessory to reject or round them.
7. The maximum `ttl` a controller will send on `/prepare`, and whether an accessory may legitimately fail a `/prepare` — the ADK explicitly notes "It is not documented under what conditions this should fail" (HAP/HAPIPAccessoryServer.c:621-623).
8. Whether any characteristic other than Programmable Switch Event is exempt from the one-second notification coalescing floor in later HAP revisions; this ADK whitelists exactly one.
9. Whether controllers treat a `207 Multi-Status` with mixed results as `readWritePartialSuccess`, `partialCommunicationFailure`, or a per-characteristic error.
10. How the `remote` flag is set by a home hub in practice, and whether an accessory may legitimately refuse remote writes.
11. Which `HMCharacteristicProperty` constant, if any, corresponds to the HAP `tw` and `wr` permission tokens.
12. Whether an accessory may change a characteristic's declared constraints at runtime (for example narrowing `valid-values` as device capabilities change) without bumping the configuration number, and how controllers react.
