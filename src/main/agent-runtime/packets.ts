// Internal utility-process packets. No renderer can create launches or choose a broker capability.
import type { RuntimeIdentity } from '../../shared/agent-runtime';
import type { RuntimeFrame } from './channel';
import type { AdapterCommand, AdapterResult, HostUpdateFrame } from './host-session';
import type { BrokerReply, BrokerRequest, WireAdapter } from './broker';

export type RuntimePacket =
  | { kind: 'launch'; identity: RuntimeIdentity; launch: WireAdapter }
  | { kind: 'command'; frame: RuntimeFrame<AdapterCommand, AdapterResult> }
  | { kind: 'update'; frame: RuntimeFrame<HostUpdateFrame, void> }
  | { kind: 'broker'; frame: RuntimeFrame<BrokerRequest, BrokerReply> }
  | { kind: 'release' | 'failed'; identity: RuntimeIdentity }
  | { kind: 'shutdown' };
