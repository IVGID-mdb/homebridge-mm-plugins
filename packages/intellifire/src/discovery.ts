/**
 * IntelliFire LAN discovery: broadcast "IFT-search" to UDP 3785, modules answer (to the
 * sender's port) with JSON like {"ip":"192.168.0.55","mac":"...","serial"?:...,"version":...}.
 * We then GET /poll on each answer to learn the serial for certain.
 */
import dgram from 'node:dgram';
import { requestJson } from '@mm/hb-core';
import type { Log } from '@mm/hb-core';

export interface DiscoveredFireplace {
  ip: string;
  serial: string;
}

export interface DiscoveryOptions {
  port?: number;
  listenPort?: number;
  timeoutMs?: number;
  broadcast?: string;
  log?: Log;
}

export async function discoverFireplaces(opts: DiscoveryOptions = {}): Promise<DiscoveredFireplace[]> {
  const port = opts.port ?? 3785;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const broadcast = opts.broadcast ?? '255.255.255.255';
  const ips = new Set<string>();
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.on('message', (msg) => {
      try {
        const j = JSON.parse(msg.toString('utf8')) as { ip?: string };
        if (typeof j.ip === 'string') ips.add(j.ip);
      } catch {
        /* not ours */
      }
    });
    socket.bind(opts.listenPort ?? 0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* some platforms disallow; unicast still works */
      }
      socket.send('IFT-search', port, broadcast, (err) => {
        if (err) opts.log?.debug(`discovery send failed: ${err.message}`);
      });
      setTimeout(resolve, timeoutMs).unref?.();
    });
  }).finally(() => socket.close());

  const found: DiscoveredFireplace[] = [];
  await Promise.all(
    [...ips].map(async (ip) => {
      try {
        const poll = await requestJson<{ serial?: string }>(`http://${ip}/poll`, { timeoutMs: 3000 });
        if (typeof poll.serial === 'string' && poll.serial) found.push({ ip, serial: poll.serial });
      } catch (err) {
        opts.log?.debug(`discovery: ${ip} answered but /poll failed: ${(err as Error).message}`);
      }
    }),
  );
  return found;
}
