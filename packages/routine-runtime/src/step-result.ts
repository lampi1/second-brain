// step-result.json: how a plain Claude Code session tells the routine runtime it finished a step (ADR 0175). The session
// writes it in its step folder; the runtime validates it here. A missing or invalid file is a failed attempt. The DevOps
// writes it lists are executed by the runtime (devops.ts, devops-ops.ts), never by the session: work item comment,
// state, fields and tags; test plans, suites, cases and outcomes; the run's PR, its links and comments; the run
// branch push; the PR validation build and the test deployment; and the downgrade that hands the item to a person.
import type { RoutineDevOpsOp } from './format';

export const STEP_RESULT_FILE = 'step-result.json';

export const TEST_OUTCOMES = ['passed', 'failed', 'blocked', 'notApplicable'] as const;
export type TestOutcome = typeof TEST_OUTCOMES[number];

export type StepWrite =
  // images: PNG/JPEG files of this step's own evidence/ or screenshots/ folder, uploaded and shown in the comment
  | { op: 'comment'; text: string; mentions?: string[]; images?: string[] }
  | { op: 'state'; state: string }
  | { op: 'fields'; fields: Record<string, string | number | boolean> }
  | { op: 'tags'; add?: string[]; remove?: string[] }
  // test plans: `ref` is a name the run gives the created resource; later writes (any step) point at it by that ref
  | { op: 'create-test-plan'; ref: string; name: string; project?: string; areaPath?: string; iteration?: string }
  | { op: 'rename-test-plan'; plan: string; name: string }
  | { op: 'create-test-suite'; ref: string; plan: string; parent?: string; name: string }
  | { op: 'create-test-case'; ref: string; suite: string; title: string; steps: { action: string; expected?: string }[]; description?: string; priority?: number; tags?: string[] }
  | { op: 'set-test-outcome'; testCase: string; outcome: TestOutcome }
  | { op: 'tag-test-case'; testCase: string; add: string[] }
  // the run's PR and links
  | { op: 'create-pr'; project: string; repositoryId: string; sourceRef: string; targetRef: string; title: string; text: string }
  | { op: 'link-pr'; projectId: string; repositoryId: string; pullRequestId: number }
  | { op: 'relate-pr'; projectId: string; repositoryId: string; pullRequestId: number }
  | { op: 'relate-work-item'; relatedWorkItemId: number }
  | { op: 'pr-comment'; text: string; mentions?: string[]; images?: string[] }
  | { op: 'publish-pr' }
  | { op: 'abandon-pr' }
  // git and the test environment
  | { op: 'push-branch'; project: string; repositoryId: string; commit?: string }
  | { op: 'queue-pr-validation'; targetId: string }
  | { op: 'deploy-test'; targetId: string; waitMinutes?: number }
  | { op: 'cancel-test-deploy'; targetId: string }
  // stops the run: cleanup, tags and state from the package's devops.downgrade, a comment for a person
  // resumeFrom (a parking package, escalation.park): the step an answered run restarts from (default: this step)
  | { op: 'downgrade'; reason: string; resumeFrom?: string };
export type StepWriteOp = StepWrite['op'];

/** The package grant category each write needs (format.ts DEVOPS_OPS). */
export const WRITE_CATEGORY: Record<StepWriteOp, RoutineDevOpsOp> = {
  comment: 'comment', state: 'state', fields: 'fields', tags: 'tags',
  'create-test-plan': 'test-plans', 'rename-test-plan': 'test-plans', 'create-test-suite': 'test-plans', 'create-test-case': 'test-plans', 'set-test-outcome': 'test-results', 'tag-test-case': 'test-plans',
  'create-pr': 'pr-create', 'link-pr': 'pr-links', 'relate-pr': 'related-links', 'relate-work-item': 'related-links', 'pr-comment': 'pr-comment', 'publish-pr': 'pr-publish', 'abandon-pr': 'pr-abandon',
  'push-branch': 'git-push', 'queue-pr-validation': 'pr-validation', 'deploy-test': 'test-deploy', 'cancel-test-deploy': 'test-deploy',
  downgrade: 'downgrade',
};

export interface StepResult {
  outcome: 'done' | 'failed' | 'needs-human';
  summary: string;
  /** file names under evidence/ or screenshots/, or short facts */
  evidence?: string[];
  /** with needs-human: the exact question for the person */
  question?: string;
  devopsWrites?: StepWrite[];
  /** with done, on a step whose package sets `loop`: the run goes back to the loop's earlier step with this reason
   *  (e.g. review findings to fix); past the package's limit the step needs a person */
  sendBack?: { reason: string };
}

export class StepResultError extends Error {}
const bad = (m: string): never => { throw new StepResultError(m); };
const text = (v: unknown, what: string, max: number): string => typeof v === 'string' && v.trim() && v.length <= max && !/\u0000/.test(v) ? v : bad(`${what}: text up to ${max} characters`);
const optText = (w: Record<string, unknown>, key: string, what: string, max: number): Record<string, string> => w[key] === undefined ? {} : { [key]: text(w[key], `${what}.${key}`, max) };
const keysOnly = (o: Record<string, unknown>, allowed: string[], what: string) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${what}: unknown field "${k}"`); };
const rec = (v: unknown, what: string): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad(`${what}: expected an object`);
const ref = (v: unknown, what: string): string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(v) ? v : bad(`${what}: a ref (letters, digits, . - _)`);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guid = (v: unknown, what: string): string => typeof v === 'string' && GUID.test(v) ? v.toLowerCase() : bad(`${what}: a GUID`);
const posInt = (v: unknown, what: string): number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 2_147_483_647 ? v as number : bad(`${what}: a positive id`);
const tagList = (x: unknown, what: string) => x === undefined ? undefined : Array.isArray(x) && x.length <= 20 ? x.map((t, j) => { const s = text(t, `${what}[${j}]`, 100); return s.includes(';') ? bad(`${what}[${j}]: ";" is not allowed`) : s; }) : bad(`${what}: a list of at most 20 tags`);
const guidList = (x: unknown, what: string): string[] | undefined => x === undefined ? undefined : Array.isArray(x) && x.length <= 10 ? x.map((m, j) => guid(m, `${what}[${j}]`)) : bad(`${what}: at most 10 identity ids`);
/** An image of the step's own folder: evidence/<file> or screenshots/<file>, PNG or JPEG, no other path. */
export const IMAGE_PATH = /^(evidence|screenshots)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g)$/i;
const imageList = (x: unknown, what: string): string[] | undefined => x === undefined ? undefined : Array.isArray(x) && x.length <= 10
  ? x.map((f, j) => typeof f === 'string' && IMAGE_PATH.test(f) && !f.includes('..') ? f : bad(`${what}[${j}]: evidence/<file>.png|jpg or screenshots/<file>.png|jpg of this step`))
  : bad(`${what}: at most 10 images`);
const branchRef = (v: unknown, what: string): string => { const s = text(v, what, 250); return /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(s) && !s.includes('//') && !s.includes('..') ? s : bad(`${what}: a full refs/heads/... branch`); };

function write(v: unknown, i: number): StepWrite {
  const what = `devopsWrites[${i}]`, w = rec(v, what);
  switch (w.op) {
    case 'comment': {
      keysOnly(w, ['op', 'text', 'mentions', 'images'], what);
      const mentions = guidList(w.mentions, `${what}.mentions`), images = imageList(w.images, `${what}.images`);
      return { op: 'comment', text: text(w.text, `${what}.text`, 30_000), ...(mentions?.length ? { mentions } : {}), ...(images?.length ? { images } : {}) };
    }
    case 'state': keysOnly(w, ['op', 'state'], what); return { op: 'state', state: text(w.state, `${what}.state`, 128) };
    case 'fields': {
      keysOnly(w, ['op', 'fields'], what);
      const fields = rec(w.fields, `${what}.fields`);
      if (!Object.keys(fields).length || Object.keys(fields).length > 32) bad(`${what}.fields: 1-32 fields`);
      for (const [k, x] of Object.entries(fields)) {
        if (!/^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(k)) bad(`${what}.fields: invalid field name "${k}"`);
        if (!['string', 'number', 'boolean'].includes(typeof x) || (typeof x === 'string' && x.length > 30_000)) bad(`${what}.fields.${k}: text, number or boolean`);
      }
      return { op: 'fields', fields: fields as Record<string, string | number | boolean> };
    }
    case 'tags': {
      keysOnly(w, ['op', 'add', 'remove'], what);
      const add = tagList(w.add, `${what}.add`), remove = tagList(w.remove, `${what}.remove`);
      if (!add?.length && !remove?.length) bad(`${what}: add or remove at least one tag`);
      return { op: 'tags', ...(add ? { add } : {}), ...(remove ? { remove } : {}) };
    }
    case 'create-test-plan':
      keysOnly(w, ['op', 'ref', 'name', 'project', 'areaPath', 'iteration'], what);
      return { op: 'create-test-plan', ref: ref(w.ref, `${what}.ref`), name: text(w.name, `${what}.name`, 256), ...optText(w, 'project', what, 128), ...optText(w, 'areaPath', what, 1000), ...optText(w, 'iteration', what, 1000) };
    case 'rename-test-plan':
      keysOnly(w, ['op', 'plan', 'name'], what);
      return { op: 'rename-test-plan', plan: ref(w.plan, `${what}.plan`), name: text(w.name, `${what}.name`, 256) };
    case 'create-test-suite':
      keysOnly(w, ['op', 'ref', 'plan', 'parent', 'name'], what);
      return { op: 'create-test-suite', ref: ref(w.ref, `${what}.ref`), plan: ref(w.plan, `${what}.plan`), ...(w.parent !== undefined ? { parent: ref(w.parent, `${what}.parent`) } : {}), name: text(w.name, `${what}.name`, 256) };
    case 'create-test-case': {
      keysOnly(w, ['op', 'ref', 'suite', 'title', 'steps', 'description', 'priority', 'tags'], what);
      const steps = Array.isArray(w.steps) && w.steps.length <= 50 ? w.steps.map((x, j) => {
        const s = rec(x, `${what}.steps[${j}]`); keysOnly(s, ['action', 'expected'], `${what}.steps[${j}]`);
        return { action: text(s.action, `${what}.steps[${j}].action`, 4000), ...(s.expected !== undefined && s.expected !== '' ? { expected: text(s.expected, `${what}.steps[${j}].expected`, 4000) } : {}) };
      }) : bad(`${what}.steps: a list of at most 50 steps`);
      if (w.priority !== undefined && !(Number.isInteger(w.priority) && (w.priority as number) >= 1 && (w.priority as number) <= 4)) bad(`${what}.priority: an integer 1-4`);
      const tags = tagList(w.tags, `${what}.tags`);
      return { op: 'create-test-case', ref: ref(w.ref, `${what}.ref`), suite: ref(w.suite, `${what}.suite`), title: text(w.title, `${what}.title`, 256), steps,
        ...optText(w, 'description', what, 10_000), ...(w.priority !== undefined ? { priority: w.priority as number } : {}), ...(tags?.length ? { tags } : {}) };
    }
    case 'set-test-outcome':
      keysOnly(w, ['op', 'testCase', 'outcome'], what);
      if (!(TEST_OUTCOMES as readonly string[]).includes(w.outcome as string)) bad(`${what}.outcome: one of ${TEST_OUTCOMES.join(', ')}`);
      return { op: 'set-test-outcome', testCase: ref(w.testCase, `${what}.testCase`), outcome: w.outcome as TestOutcome };
    case 'tag-test-case': {
      keysOnly(w, ['op', 'testCase', 'add'], what);
      const add = tagList(w.add, `${what}.add`);
      if (!add?.length) bad(`${what}.add: at least one tag`);
      return { op: 'tag-test-case', testCase: ref(w.testCase, `${what}.testCase`), add: add! };
    }
    case 'create-pr':
      keysOnly(w, ['op', 'project', 'repositoryId', 'sourceRef', 'targetRef', 'title', 'text'], what);
      return { op: 'create-pr', project: text(w.project, `${what}.project`, 128), repositoryId: guid(w.repositoryId, `${what}.repositoryId`), sourceRef: branchRef(w.sourceRef, `${what}.sourceRef`), targetRef: branchRef(w.targetRef, `${what}.targetRef`), title: text(w.title, `${what}.title`, 300), text: text(w.text, `${what}.text`, 10_000) };
    case 'link-pr': case 'relate-pr':
      keysOnly(w, ['op', 'projectId', 'repositoryId', 'pullRequestId'], what);
      return { op: w.op, projectId: guid(w.projectId, `${what}.projectId`), repositoryId: guid(w.repositoryId, `${what}.repositoryId`), pullRequestId: posInt(w.pullRequestId, `${what}.pullRequestId`) };
    case 'relate-work-item':
      keysOnly(w, ['op', 'relatedWorkItemId'], what);
      return { op: 'relate-work-item', relatedWorkItemId: posInt(w.relatedWorkItemId, `${what}.relatedWorkItemId`) };
    case 'pr-comment': {
      keysOnly(w, ['op', 'text', 'mentions', 'images'], what);
      const mentions = guidList(w.mentions, `${what}.mentions`), images = imageList(w.images, `${what}.images`);
      return { op: 'pr-comment', text: text(w.text, `${what}.text`, 10_000), ...(mentions?.length ? { mentions } : {}), ...(images?.length ? { images } : {}) };
    }
    case 'publish-pr': case 'abandon-pr': keysOnly(w, ['op'], what); return { op: w.op };
    case 'push-branch': {
      keysOnly(w, ['op', 'project', 'repositoryId', 'commit'], what);
      const commit = w.commit === undefined ? undefined : typeof w.commit === 'string' && /^[a-f0-9]{40,64}$/i.test(w.commit) ? w.commit.toLowerCase() : bad(`${what}.commit: a full commit sha`);
      return { op: 'push-branch', project: text(w.project, `${what}.project`, 128), repositoryId: guid(w.repositoryId, `${what}.repositoryId`), ...(commit ? { commit } : {}) };
    }
    case 'queue-pr-validation': case 'cancel-test-deploy':
      keysOnly(w, ['op', 'targetId'], what);
      return { op: w.op, targetId: text(w.targetId, `${what}.targetId`, 80) };
    case 'deploy-test':
      keysOnly(w, ['op', 'targetId', 'waitMinutes'], what);
      if (w.waitMinutes !== undefined && !(Number.isInteger(w.waitMinutes) && (w.waitMinutes as number) >= 1 && (w.waitMinutes as number) <= 240)) bad(`${what}.waitMinutes: 1-240`);
      return { op: 'deploy-test', targetId: text(w.targetId, `${what}.targetId`, 80), ...(w.waitMinutes !== undefined ? { waitMinutes: w.waitMinutes as number } : {}) };
    case 'downgrade':
      keysOnly(w, ['op', 'reason', 'resumeFrom'], what);
      return { op: 'downgrade', reason: text(w.reason, `${what}.reason`, 2000), ...(w.resumeFrom !== undefined ? { resumeFrom: ref(w.resumeFrom, `${what}.resumeFrom`) } : {}) };
    default: return bad(`${what}.op: one of ${Object.keys(WRITE_CATEGORY).join(', ')}`);
  }
}

/** Validates the parsed step-result.json. */
export function validateStepResult(value: unknown): StepResult {
  const r = rec(value, STEP_RESULT_FILE);
  keysOnly(r, ['outcome', 'summary', 'evidence', 'question', 'devopsWrites', 'sendBack'], STEP_RESULT_FILE);
  if (!['done', 'failed', 'needs-human'].includes(r.outcome as string)) bad('outcome: done, failed or needs-human');
  const evidence = r.evidence === undefined ? undefined : Array.isArray(r.evidence) && r.evidence.length <= 100 ? r.evidence.map((e, i) => text(e, `evidence[${i}]`, 2000)) : bad('evidence: a list');
  const writes = r.devopsWrites === undefined ? undefined : Array.isArray(r.devopsWrites) && r.devopsWrites.length <= 60 ? r.devopsWrites.map(write) : bad('devopsWrites: a list of at most 60');
  if (writes && writes.filter(w => w.op === 'downgrade').length > 1) bad('devopsWrites: at most one downgrade');
  if (writes?.some(w => w.op === 'downgrade') && writes.at(-1)!.op !== 'downgrade') bad('devopsWrites: the downgrade must be the last write');
  const sendBack = r.sendBack === undefined ? undefined : (() => { const b = rec(r.sendBack, 'sendBack'); keysOnly(b, ['reason'], 'sendBack'); return { reason: text(b.reason, 'sendBack.reason', 4000) }; })();
  if (sendBack && r.outcome !== 'done') bad('sendBack: only with outcome "done"');
  if (r.outcome === 'needs-human' && (typeof r.question !== 'string' || !r.question.trim())) bad('question: needed with needs-human');
  return {
    outcome: r.outcome as StepResult['outcome'], summary: text(r.summary, 'summary', 4000),
    ...(evidence ? { evidence } : {}),
    ...(typeof r.question === 'string' && r.question.trim() ? { question: text(r.question, 'question', 2000) } : {}),
    ...(writes ? { devopsWrites: writes } : {}),
    ...(sendBack ? { sendBack } : {}),
  };
}

/** One line per write op the package grants (the shapes a session may put in devopsWrites). */
const SHAPES: Record<StepWriteOp, string> = {
  comment: '{"op":"comment","text":"...","mentions?":["<identity GUID>"],"images?":["screenshots/<file>.png"]} (images: needs the attachments grant)',
  state: '{"op":"state","state":"..."}',
  fields: '{"op":"fields","fields":{"Field.Name":"value"}}',
  tags: '{"op":"tags","add":["x"],"remove":["y"]}',
  'create-test-plan': '{"op":"create-test-plan","ref":"plan","name":"...","areaPath?":"...","iteration?":"..."} (project: the work item\'s unless "project" is given)',
  'rename-test-plan': '{"op":"rename-test-plan","plan":"<plan ref>","name":"..."}',
  'create-test-suite': '{"op":"create-test-suite","ref":"suite","plan":"<plan ref>","parent?":"<suite ref>","name":"..."} (the runtime links the suite Related to this run\'s work item)',
  'create-test-case': '{"op":"create-test-case","ref":"tc01","suite":"<suite ref>","title":"...","steps":[{"action":"...","expected":"..."}],"description?":"...","priority?":1-4,"tags?":["..."]}',
  'set-test-outcome': '{"op":"set-test-outcome","testCase":"<test case ref>","outcome":"passed|failed|blocked|notApplicable"}',
  'tag-test-case': '{"op":"tag-test-case","testCase":"<test case ref>","add":["#pr123"]} (adds tags to a test case of this run)',
  'create-pr': '{"op":"create-pr","project":"...","repositoryId":"<GUID>","sourceRef":"refs/heads/...","targetRef":"refs/heads/...","title":"...","text":"..."} (a draft PR, linked to the work item; one per run)',
  'link-pr': '{"op":"link-pr","projectId":"<GUID>","repositoryId":"<GUID>","pullRequestId":123}',
  'relate-pr': '{"op":"relate-pr","projectId":"<GUID>","repositoryId":"<GUID>","pullRequestId":123} (the PR that introduced the bug)',
  'relate-work-item': '{"op":"relate-work-item","relatedWorkItemId":123}',
  'pr-comment': '{"op":"pr-comment","text":"...","mentions?":["<identity GUID>"],"images?":["evidence/<file>.png"]} (on this run\'s own PR; images: needs the attachments grant)',
  'publish-pr': '{"op":"publish-pr"} (this run\'s draft PR leaves draft)',
  'abandon-pr': '{"op":"abandon-pr"} (this run\'s draft PR)',
  'push-branch': '{"op":"push-branch","project":"...","repositoryId":"<GUID>","commit?":"<sha>"} (publishes the run branch from the checkout)',
  'queue-pr-validation': '{"op":"queue-pr-validation","targetId":"..."} (re-queues the PR\'s existing build validation)',
  'deploy-test': '{"op":"deploy-test","targetId":"...","waitMinutes?":60} (waits for the PR merge build, deploys it, waits for the deployment)',
  'cancel-test-deploy': '{"op":"cancel-test-deploy","targetId":"..."}',
  downgrade: '{"op":"downgrade","reason":"..."} (last write; the run stops and the work item goes back to a person)',
};

/** The protocol paragraph appended to every step prompt: where and what to write. `ops`: the write ops the package
 *  grants (none = no devopsWrites). */
export function stepResultInstructions(stepDir: string, ops: readonly StepWriteOp[] | boolean, loop?: { to: string; max: number }, park?: { steps: readonly string[] }): string {
  const allowed = ops === true ? (['comment', 'state', 'fields', 'tags'] as StepWriteOp[]) : ops === false ? [] : [...ops];
  const file = `${stepDir.replace(/\\/g, '/')}/${STEP_RESULT_FILE}`;
  return [
    '## How to finish this step',
    `When you are done, write the file ${file} (JSON, UTF-8) and stop. Without a valid file the step counts as failed.`,
    'Shape: {"outcome": "done" | "failed" | "needs-human", "summary": "what you did and found", "evidence": ["file names or short facts"],',
    '"question": "only with needs-human: the exact question for a person"' + (allowed.length ? ', "devopsWrites": [ ... ]}' : '}'),
    `Save evidence files under ${stepDir.replace(/\\/g, '/')}/evidence/ and screenshots under ${stepDir.replace(/\\/g, '/')}/screenshots/.`,
    ...(allowed.length ? [
      'devopsWrites are done by the runtime after you stop, in order, only with outcome "done", on this run\'s work item and its own resources; never do them yourself. Allowed:',
      ...allowed.map(op => op === 'downgrade' && park
        ? `- {"op":"downgrade","reason":"...","resumeFrom?":"<step id>"} (last write; the run parks: one comment for the contact with the reason and the step number, the run branch pushed when it is checked out, the package's tag; when somebody answers with a comment starting with @AI, the same run restarts from resumeFrom, one of ${park.steps.join(', ')}, default this step)`
        : `- ${SHAPES[op]}`),
      'A write never blocks the run: what was done, not verified or refused is listed for the next steps.',
      'Images in a comment are files of this step folder only ("evidence/<file>" or "screenshots/<file>", PNG or JPEG).',
    ] : []),
    ...(loop ? [`To send the run back to step ${loop.to} (for example findings it must fix), use outcome "done" with "sendBack": {"reason": "what must be fixed"}; at most ${loop.max} times per run, then a person decides.`] : []),
    park
      ? 'Use needs-human only when a person must decide or provide something: the runtime parks the run (as a downgrade from this step) and runs this step again with the answer.'
      : 'Use needs-human only when a person must decide or provide something; the runtime asks them on DevOps and runs this step again with the answer.',
  ].join('\n');
}

/** The write ops a package grant allows (the grant's categories expanded). */
export function grantedWriteOps(categories: readonly RoutineDevOpsOp[]): StepWriteOp[] {
  return (Object.keys(WRITE_CATEGORY) as StepWriteOp[]).filter(op => categories.includes(WRITE_CATEGORY[op]));
}
