/**
 * HomeKit render probe.
 *
 * Every source we have is silent on what the Apple Home app actually DISPLAYS: the wording of a
 * sensor tile, whether a Filter Maintenance service appears on its own, whether its write-only
 * reset is reachable, and whether a sensor offers a notification toggle. Those unknowns are
 * load-bearing for how a Litter-Robot should be modelled, so rather than guess again, this plugin
 * publishes the candidate services with fixed, unmistakable values and lets one look at a phone
 * settle it.
 *
 * Three accessories, each answering a different question:
 *   "Probe Multi"       - every candidate service side by side on one accessory.
 *   "Probe Filter Only" - a Filter Maintenance service completely alone. If this produces no tile,
 *                         a waste-drawer gauge and its reset cannot live there unaccompanied.
 *   "Probe Valve Only"  - a Valve alone, to see how it is worded and where it is filed.
 *
 * Values are chosen so the interesting state word is the one on screen: occupancy DETECTED,
 * contact NOT detected, filter CHANGE, valve active and in use.
 *
 * This is disposable. Install it, look, report what you see, uninstall it.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

const PLUGIN_NAME = 'homebridge-mm-render-probe';
const PLATFORM_NAME = 'MMRenderProbe';

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, RenderProbePlatform);
};

class RenderProbePlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory>();

  constructor(
    private readonly log: Logging,
    _config: PlatformConfig,
    private readonly api: API,
  ) {
    api.on('didFinishLaunching', () => this.publish());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private accessoryFor(seed: string, displayName: string): { accessory: PlatformAccessory; isNew: boolean } {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${seed}`);
    const existing = this.cached.get(uuid);
    if (existing) return { accessory: existing, isNew: false };
    const accessory = new this.api.platformAccessory(displayName, uuid);
    this.cached.set(uuid, accessory);
    return { accessory, isNew: true };
  }

  private info(accessory: PlatformAccessory, model: string): void {
    const { Service: S, Characteristic: C } = this.api.hap;
    const svc = accessory.getService(S.AccessoryInformation) ?? accessory.addService(S.AccessoryInformation);
    svc
      .setCharacteristic(C.Manufacturer, 'Render Probe')
      .setCharacteristic(C.Model, model)
      .setCharacteristic(C.SerialNumber, `PROBE-${model.replace(/[^A-Za-z0-9]/g, '')}`)
      .setCharacteristic(C.FirmwareRevision, '1.0.0');
  }

  /** Get-or-add, so a restart does not stack duplicate services onto a cached accessory. */
  private svc(
    accessory: PlatformAccessory,
    ctor: Parameters<PlatformAccessory['addService']>[0],
    name: string,
    subtype: string,
  ): Service {
    const found = accessory.getServiceById(ctor as never, subtype);
    const add = accessory.addService.bind(accessory) as unknown as (c: unknown, n: string, s: string) => Service;
    const service = found ?? add(ctor, name, subtype);
    service.setCharacteristic(this.api.hap.Characteristic.Name, name);
    return service;
  }

  private publish(): void {
    const { Service: S, Characteristic: C } = this.api.hap;
    const toRegister: PlatformAccessory[] = [];

    // ---- 1. Everything side by side -------------------------------------------------------
    const multi = this.accessoryFor('multi', 'Probe Multi');
    this.info(multi.accessory, 'Multi');

    const occupancy = this.svc(multi.accessory, S.OccupancySensor, 'Probe Occupancy', 'occ');
    occupancy.updateCharacteristic(C.OccupancyDetected, C.OccupancyDetected.OCCUPANCY_DETECTED);
    occupancy.updateCharacteristic(C.StatusActive, true);

    const contact = this.svc(multi.accessory, S.ContactSensor, 'Probe Contact', 'contact');
    contact.updateCharacteristic(C.ContactSensorState, C.ContactSensorState.CONTACT_NOT_DETECTED);
    contact.updateCharacteristic(C.StatusActive, true);

    // Linked to the occupancy sensor, to compare against the unlinked one on accessory 2.
    const filterLinked = this.svc(multi.accessory, S.FilterMaintenance, 'Probe Filter Linked', 'filterlinked');
    filterLinked.updateCharacteristic(C.FilterChangeIndication, C.FilterChangeIndication.CHANGE_FILTER);
    filterLinked.updateCharacteristic(C.FilterLifeLevel, 42);
    filterLinked.getCharacteristic(C.ResetFilterIndication).onSet((v) => {
      this.log.warn(`*** RESET CONTROL WAS USED on "Probe Filter Linked" (wrote ${String(v)}). ` +
        'That means the Home app DOES expose Reset Filter Indication. Please report this. ***');
    });
    occupancy.addLinkedService(filterLinked);

    const valve = this.svc(multi.accessory, S.Valve, 'Probe Valve', 'valve');
    valve.updateCharacteristic(C.Active, C.Active.ACTIVE);
    valve.updateCharacteristic(C.InUse, C.InUse.IN_USE);
    valve.updateCharacteristic(C.ValveType, C.ValveType.GENERIC_VALVE);
    valve.getCharacteristic(C.Active).onSet((v) => {
      this.log.warn(`*** VALVE Active written: ${String(v)}. Reverting to ACTIVE in 2s to test springback. ***`);
      setTimeout(() => valve.updateCharacteristic(C.Active, C.Active.ACTIVE), 2000).unref?.();
    });

    const button = this.svc(multi.accessory, S.StatelessProgrammableSwitch, 'Probe Button', 'button');
    button.getCharacteristic(C.ProgrammableSwitchEvent).setProps({ validValues: [0] });

    // Controls that certainly render, as a baseline for comparison.
    const sw = this.svc(multi.accessory, S.Switch, 'Probe Switch', 'switch');
    sw.updateCharacteristic(C.On, true);
    sw.getCharacteristic(C.On).onSet(() => undefined);

    const light = this.svc(multi.accessory, S.Lightbulb, 'Probe Light', 'light');
    light.updateCharacteristic(C.On, true);
    light.updateCharacteristic(C.Brightness, 42);
    light.getCharacteristic(C.On).onSet(() => undefined);
    light.getCharacteristic(C.Brightness).onSet(() => undefined);

    if (multi.isNew) toRegister.push(multi.accessory);

    // ---- 2. A Filter Maintenance service entirely on its own ------------------------------
    const filterOnly = this.accessoryFor('filteronly', 'Probe Filter Only');
    this.info(filterOnly.accessory, 'FilterOnly');
    const lone = this.svc(filterOnly.accessory, S.FilterMaintenance, 'Probe Filter Alone', 'filteralone');
    lone.updateCharacteristic(C.FilterChangeIndication, C.FilterChangeIndication.CHANGE_FILTER);
    lone.updateCharacteristic(C.FilterLifeLevel, 7);
    lone.getCharacteristic(C.ResetFilterIndication).onSet((v) => {
      this.log.warn(`*** RESET CONTROL WAS USED on the standalone filter (wrote ${String(v)}). Please report this. ***`);
    });
    if (filterOnly.isNew) toRegister.push(filterOnly.accessory);

    // ---- 3. A Valve entirely on its own ---------------------------------------------------
    const valveOnly = this.accessoryFor('valveonly', 'Probe Valve Only');
    this.info(valveOnly.accessory, 'ValveOnly');
    const loneValve = this.svc(valveOnly.accessory, S.Valve, 'Probe Valve Alone', 'valvealone');
    loneValve.updateCharacteristic(C.Active, C.Active.INACTIVE);
    loneValve.updateCharacteristic(C.InUse, C.InUse.NOT_IN_USE);
    loneValve.updateCharacteristic(C.ValveType, C.ValveType.GENERIC_VALVE);
    loneValve.getCharacteristic(C.Active).onSet(() => undefined);
    if (valveOnly.isNew) toRegister.push(valveOnly.accessory);

    if (toRegister.length) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
    }

    for (const line of [
      '',
      '========================= HOMEKIT RENDER PROBE =========================',
      'Pair this child bridge, open the Home app, and answer these:',
      '',
      ' 1. "Probe Occupancy" is DETECTED. What word does its tile show?',
      '    ("Detected", "Occupied", something else?)',
      ' 2. "Probe Contact" is NOT detected. What word does its tile show?',
      '    ("Open", "Not Detected", something else?)',
      ' 3. Does "Probe Filter Alone" (its own accessory) appear as a tile at all?',
      '    If yes, what does it say, and can you tap it to reach a reset control?',
      ' 4. Does "Probe Filter Linked" appear as its own tile, or only inside',
      '    "Probe Occupancy" when you tap in?',
      ' 5. "Probe Valve" is active and in use. What does its tile say, and is it',
      '    grouped under Water or anything unusual?',
      ' 6. Long-press any sensor tile: is there a Notifications toggle?',
      ' 7. Does "Probe Button" show a tile, or only appear in automations?',
      '',
      'If you tap the valve off or use any reset, this log will say so.',
      'Uninstall this plugin when done; the tiles disappear with it.',
      '========================================================================',
      '',
    ]) {
      this.log.info(line);
    }
  }
}
