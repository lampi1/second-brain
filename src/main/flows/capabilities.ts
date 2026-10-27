// What a routine package can do (ADR 0175, 0176), read on demand by the Orchestrator through app_flow_capabilities and
// app_flow_connectors before it writes a package from the user's plain-language need. One source: the app_guide topic
// "routine" and docs/routines/authoring.md say the same. A step is a plain Claude Code session: no app roles, no app
// tools, no approvals; the runtime (packages/routine-runtime) reads step-result.json and does every DevOps write itself.
import { DEVOPS_OPS, SECRET_PLACEHOLDER } from '../../../packages/routine-runtime/src/index';

export const ROUTINE_CAPABILITY_SECTIONS = ['overview', 'steps', 'devops', 'browser', 'test-db', 'secrets', 'examples'] as const;

/** The authoring recipe in one paragraph: the guide topic and the role text point here. */
export const ROUTINE_AUTHORING_SUMMARY = 'Routine packages (ADR 0175): from the user\'s need write ONE routine.json object ' +
  '{format:"second-brain-routine",schemaVersion:1,routine:{id,title,description,inputs,steps,trigger?,devops?,escalation?,mcpServers?,testDbs?,browser?,loginSuccess?},credentials?,secrets?,files?} ' +
  'and save it with app_flow_propose: it runs the package preflight and returns each problem with its field and fix. Each step is a plain Claude Code session ' +
  '(prompt, optional model/effort/allowedTools/mcpServers/testDbs/browser): never an app role, chat, agent_* or app_* tool. The runtime appends the step-result.json ' +
  'contract to every prompt and does the DevOps writes a step lists there. Never write a password or PAT: leave it out, the user types it on the Routine page. ' +
  'app_flow_capabilities (sections) and app_flow_connectors say the rest; docs/routines/authoring.md has two worked examples.';

const ROUTINE_SHAPE = {
  format: 'second-brain-routine', schemaVersion: 1,
  routine: {
    id: 'letters, digits, - and _ (the folder name)', title: 'short, Italian for the user', description: 'what it does and when',
    inputs: '[{name, label?, required?, default?}]: a step reads {{name}}; name workItem = the DevOps work item a run is about',
    steps: '[{id, title, prompt, model?, effort?: low|medium|high|xhigh|max, allowedTools?, mcpServers?, testDbs?, browser?: true, timeoutMs? (default 30 min), maxAttempts? (default 2)}]',
    trigger: 'optional DevOps trigger (section devops)', devops: 'optional DevOps write grant (section devops)', escalation: 'optional: who is asked on DevOps when a step needs a person (section devops)',
    mcpServers: '{name: {command, args?, env?}}: stdio MCP servers a step lists in its mcpServers (never the app)',
    testDbs: 'optional read-only SQL Server TEST databases (section test-db)', browser: 'optional {origins} for the runtime browser (section browser)', loginSuccess: 'optional per-site login success rule (section browser)',
  },
  credentials: '[{loginUrl, user}]: site logins; the password is the user\'s (section secrets)',
  secrets: '{devopsPat?, testDbs?: {id: {user}}}: the values are the user\'s (section secrets)',
  files: '[{kind: script|query|asset, ref, content}]: carried with the package (section steps); a run never reads the brain',
};

export function flowCapabilities(section: unknown = 'overview'): object {
  switch (section) {
    case 'overview': return {
      sections: [...ROUTINE_CAPABILITY_SECTIONS],
      model: 'A routine is a package (routine.json + its files) the app and a terminal (`routine run`) run with the same runtime. Each step is one plain Claude Code session in auto mode; it ends by writing step-result.json {outcome: done|failed|needs-human, summary, evidence, question?, devopsWrites?}. The runtime appends that contract to the prompt: the prompt says only the job and what "done" means.',
      shape: ROUTINE_SHAPE,
      workflow: [
        'Ask the user (native questions) only what the need leaves open: inputs, the site and test account, DevOps project/area/states/tags, who is asked when a person is needed.',
        'Write every know-how the steps need into their prompts (read the brain now; a run never reads the brain).',
        'app_flow_propose {package} (or packagePath: a JSON file in the brain). invalid = fix each error (field + fix) and propose again; needs-human secrets = saved, tell the user which secrets to type on the Routine page; ready = saved.',
        'Saving never runs anything and never switches a trigger on: the user starts it or enables its trigger on the Routine page.',
      ],
      placeholders: '{{input}} for each declared input; {{workItem}}, {{work-item-id}}, {{work-item-url}} need a trigger or a workItem input.',
      never: ['app roles (Orchestrator, Strategist, Scout, Artisan, Sentinel, Herald) or role/roleId/tier/engine fields', 'app tools (agent_*, app_*, flow_*, browser_login, handoff_to_user, mcp__second-brain__*)', 'approval or manual steps (a person is asked through outcome needs-human)', 'passwords, PATs, production databases or production commands'],
    };
    case 'steps': return {
      prompt: 'The whole session prompt, in English: the goal, the inputs as {{placeholders}}, the know-how, what "done" means and when to answer needs-human with a question. Not: login steps, roles, app tools, the step-result shape (appended by the runtime).',
      session: 'Each step is a fresh session in the run workspace. The runtime adds to the prompt: the inputs, the work item (title, description, repro steps), the earlier steps\' summaries, test DB notes, a person\'s answer after needs-human, the previous failure on a retry.',
      model: 'Optional model id (e.g. claude-opus-5-5, claude-sonnet-5) and effort; absent = the user\'s Claude default.',
      allowedTools: 'Claude Code --allowedTools entries for the session, e.g. Read, Edit, Bash(git *), mcp__<server>__<tool>; an mcp__ tool needs its server in the step\'s mcpServers (or is a runtime server).',
      retries: 'maxAttempts 1-10 (default 2): a failed attempt is retried with the previous result as feedback; needs-human stops and asks (escalation).',
      files: 'files[] {kind: script|query|asset, ref, content} travel with the package, but a session does not read them yet: put the know-how a step needs in its prompt.',
    };
    case 'devops': return {
      trigger: '{kind:"devops", everyMinutes, organization, project, areaPath, workItemType, states:["New"], includeExisting:false, includeTags?:["ai-fixable"], excludeTags?, workItemIds?, iterationPath?, maxPerHour?}: one run per matching work item; the item is {{workItem}}. Always narrow with includeTags or workItemIds.',
      grant: `devops {organization, projects, ops: subset of ${DEVOPS_OPS.join('|')}, fields: [reference names, needed with op fields]}: the ONLY writes a run may do, on its own work item, made by the runtime from devopsWrites in step-result.json. A step never calls DevOps itself.`,
      reading: 'The runtime puts the work item (title, description, repro steps) in every prompt; for comments and attachments a step uses the runtime server routine-devops (allowedTools mcp__routine-devops__*), see app_flow_connectors.',
      escalation: '{contact: DevOps identity GUID (lowercase), contactName?, pollMinutes?, reminderMinutes?}: on needs-human the runtime comments on the work item mentioning the contact, then polls for their reply and resumes. Ask the user whose identity; never guess a GUID.',
      pat: 'secrets.devopsPat: the user types it (section secrets); without it the app uses its own DevOps sign-in, a terminal fails.',
    };
    case 'browser': return {
      model: 'The runtime owns one browser per run and signs in itself, host side, with the package credentials (the stored loginUrl, query included, e.g. https://host/Account/Login?mode=local); it signs in again when a page lands on the login path. The session gets it through the runtime MCP server routine-browser.',
      declare: 'routine.browser {origins: ["https://exact.origin"], hide?: ["#overlay"]} (the origins it may open; each credential\'s loginUrl origin must be one of them; hide = CSS selectors of overlays hidden on every page, e.g. Air\'s Maia chat "#draggable", "ai-chat") and browser: true on each step that uses it; allowedTools mcp__routine-browser__*.',
      tools: 'navigate {url}, snapshot {} (page text + elements with refs e1..), click {ref}, type {ref, text} (refuses password fields), select_option {ref, value}, screenshot {name?} (saved as step evidence).',
      prompt: 'Say "the browser is already logged into <site>"; never write login steps, credentials or selectors into a prompt.',
      loginSuccess: '[{loginUrl, success: {urlNotContaining:"/Account/Login"} | {selector}}]: for AJAX login pages (e.g. Air: the button is type=button, success = the URL leaves /Account/Login); loginUrl equal to the credential\'s, query included.',
      credentials: `credentials [{loginUrl, user, password:"${SECRET_PLACEHOLDER}" or omitted}]: the user types the password on the Routine page.`,
    };
    case 'test-db': return {
      declare: 'routine.testDbs [{id, server, port?, database, confirmedTestDatabase?}] + secrets.testDbs {id: {user}} + the step\'s testDbs [ids]: the runtime checks the target and gives that step its server routine-testdb (tool test_db_query, read only; allowedTools mcp__routine-testdb__test_db_query).',
      rule: 'Only recognised TEST databases: a production-looking server or database is always refused; names must look like test/dev/qa unless the user lists the target.',
      never: 'Production databases, write queries, connection strings in prompts.',
    };
    case 'secrets': return {
      rule: `Agents never write or see secrets. Leave password/devopsPat out (or write "${SECRET_PLACEHOLDER}"): app_flow_propose refuses any other value, keeps the ones the user already stored for the same routine id and saves with status needs-secrets, listing the fields (secret: true) the user types on the Routine page.`,
      where: 'credentials[].password (site logins), secrets.devopsPat, secrets.testDbs.<id>.password.',
      tell: 'Tell the user which secrets to type and where (Routine page → the routine → Credenziali); never ask for a value in chat.',
    };
    case 'examples': return {
      doc: 'docs/routines/authoring.md',
      airBugfix: 'docs/routines/examples/air-bugfix/routine.json: DevOps trigger (Bug, New, ai-fixable), reproduce in Air with the browser, fix, comment + state through devopsWrites, escalation.',
      simple: 'docs/routines/examples/release-notes/routine.json: one input, no DevOps, no browser, no secrets.',
    };
    default: throw new Error(`Unknown section; use one of ${ROUTINE_CAPABILITY_SECTIONS.join(', ')}`);
  }
}
