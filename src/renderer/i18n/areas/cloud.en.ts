// English counterparts of the cloud agents' dictionary (ADR 0080).
import type { cloudIt } from './cloud.it';
export const cloudEn: typeof cloudIt = {
  'cloud.badge': 'cloud',
  'cloud.badgeTip': 'Runs in the vendor’s cloud, not on this PC',
  'cloud.area': (p: { area: string }) => `${p.area} · cloud`,
  'cloud.status.queued': 'queued', 'cloud.status.running': 'working', 'cloud.status.waiting': 'waiting for you',
  'cloud.status.done': 'done', 'cloud.status.failed': 'error', 'cloud.status.stopped': 'stopped', 'cloud.status.unknown': 'status on claude.ai',
  'cloud.fromPlan': 'from your plan',
  'cloud.open': 'Open', 'cloud.openTip': 'Opens the vendor’s page in an internal browser tab',
  'cloud.stop': 'Stop', 'cloud.apply': 'Bring home', 'cloud.applyTip': 'Takes the result into a new worktree beside the repository (never the folder in use)',
  'cloud.dismiss': 'Remove from the list', 'cloud.expand': 'Expand', 'cloud.collapse': 'Collapse',
  'cloud.followUp': 'Write to the agent…', 'cloud.send': 'Send',
  'cloud.webOnly': (p: { engine: string }) => `Messages and stop for ${p.engine} happen on its page: “Open”.`,
  'cloud.noOutput': 'The vendor does not show its messages to the app: open them on its page.',
  'cloud.noMessages': 'No messages yet: they update while the strip is open.',
  'cloud.by.agent': 'opened by the coordinator', 'cloud.by.user': 'opened by you', 'cloud.by.vendor': 'opened outside the app',
  'cloud.failed': (p: { why: string }) => `Cloud agent: ${p.why}`,
  'cloud.applied': (p: { path: string }) => `Result brought home: ${p.path}`,
  
  
  
  
  'cloud.key': 'Cursor Cloud Agents key',
  'cloud.keyHint': 'From the Cursor Dashboard → Integrations. Only for cloud agents (API prices, counted in the Cursor spending limit); encrypted on this PC, never shown.',
};
