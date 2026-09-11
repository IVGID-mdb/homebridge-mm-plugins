import { describe, expect, it } from 'vitest';
import { parseBpup } from '../src/bpup.js';

describe('BPUP parsing', () => {
  it('parses a device state push', () => {
    const msg = '{"B":"ZZJG68416","t":"devices/8f5d3fc47e9c92cd/state","i":"0f3a","s":200,"m":0,"f":255,"b":{"power":1,"speed":2,"direction":1,"light":0}}\n';
    expect(parseBpup(msg)).toEqual({
      bondId: 'ZZJG68416',
      deviceId: '8f5d3fc47e9c92cd',
      state: { power: 1, speed: 2, direction: 1, light: 0 },
    });
  });

  it('treats the bare {"B": ...} ack as keep-alive, not state', () => {
    expect(parseBpup('{"B":"ZZJG68416"}\n')).toEqual({ bondId: 'ZZJG68416' });
  });

  it('ignores non-200, non-state topics and garbage', () => {
    expect(parseBpup('{"B":"Z","t":"devices/x/state","s":500,"b":{}}')).toBeUndefined();
    expect(parseBpup('{"B":"Z","t":"devices/x/properties","s":200,"b":{}}')).toBeUndefined();
    expect(parseBpup('{"B":"Z","t":"groups/x/state","s":200,"b":{}}')).toBeUndefined();
    expect(parseBpup('not json')).toBeUndefined();
    expect(parseBpup('')).toBeUndefined();
    expect(parseBpup('{"t":"devices/x/state","s":200,"b":{}}')).toBeUndefined();
  });
});
