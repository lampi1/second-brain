// Last non-spending CLI checks, shared by launch gates and default selection. No credentials are retained.
import type { CliStatus, Harness } from '../../shared/contract';
const statuses: Record<Harness, CliStatus> = {};
export const engineReadiness = (): Record<Harness, CliStatus> => ({ ...statuses });
export const recordReadiness = (id: Harness, status: CliStatus): CliStatus => { statuses[id] = status; return status; };
