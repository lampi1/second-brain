// Every MCP tool the app exposes, by who gets it, with one plain line each (ADR 0208). The Orchestrator's app_guide
// lists the tools of its own mount from their live definitions, but not the ones only the work chats, the browser or the
// brain's hooks get (agent_delegate, navigate, recall…): this table is how app_guide answers about those too, so the
// Orchestrator always knows the whole app. Kept in step with the code by test/unit/tool-catalog.test.ts, which builds
// the real app-control tool list, scans src/main for every other tool definition and fails on a tool missing here, a
// row for a tool that is gone, a wrong mount, or a tool not listed in docs/agents/commands.md («MCP tools»). Used by
// appctl/guide.ts (entries, index) and the test.

/** Where a tool is mounted: `app` = /mcp/app and the Orchestrator's own endpoint; `orchestrator` = only the
 *  Orchestrator's own endpoint (/mcp/app/o/<id>/<token>); `chat` = every work chat's own endpoint
 *  (/mcp/chat/<id>/<token>); `browser` = the browser tools (/mcp for external clients and every chat that may browse);
 *  `hook` = the brain hooks' endpoint (/mcp/recall/<token>); `script` = the brain scripts' endpoint (/mcp/text/<token>). */
export type ToolMount = 'app' | 'orchestrator' | 'chat' | 'browser' | 'hook' | 'script';
export interface ToolInfo { readonly where: readonly ToolMount[]; readonly line: string }

const t = (where: ToolMount | ToolMount[], line: string): ToolInfo => ({ where: Array.isArray(where) ? where : [where], line });

export const TOOL_CATALOG: Readonly<Record<string, ToolInfo>> = {
  // the app's control (appctl/tools.ts and the modules it mounts)
  app_guide: t('app', 'How the app works and where everything is, read live (pages, settings, actions, concepts, every tool).'),
  app_state: t('app', 'Overview: version, brain folder, chats by state, open requests, browser tabs, today usage.'),
  app_chats: t('app', 'The chats with their state, open questions, model, cost and last line; closed ones to reopen.'),
  app_digest: t('app', 'The status in one call, zero tokens: what every open chat waits for, errors, news since last time.'),
  app_chat_items: t('app', 'The last items of one chat (messages, tool rows, results), truncated; never a delegated chat.'),
  app_agent_context: t('app', 'The frozen launch context of one work chat: memories chosen, omissions, skill hashes.'),
  app_command_runs: t('app', 'The commands the user ran from a chat code block with «Esegui», read only.'),
  app_pending: t('app', 'Open questions, permissions and commands waiting for the user, read only.'),
  app_resolve_question: t('app', 'Close a work chat\'s open question with the answer the user gave the Orchestrator.'),
  app_feed: t('app', 'Recent live feed events (ideas, errors, chats done or waiting).'),
  app_logs: t('app', 'Recent structured log entries (redacted), filtered by level, scope, chat or text.'),
  app_screenshot: t('app', 'A screenshot of the app window and of each browser tab on screen.'),
  app_ui: t('app', 'Steer the UI without taking focus: open a page, maximize a chat, or read the screen outline.'),
  app_create_chat: t('app', 'Open a work chat that runs one role, started with a self-contained prompt.'),
  app_assign_task: t('app', 'Give a finished work chat a new measured task in the same role and project.'),
  app_task_events: t('app', 'The ordered user decisions of a root task, read before assigning it again.'),
  app_send_to_chat: t('app', 'Send a message to an active app chat, labelled as not the user\'s approval.'),
  app_close_chat: t('app', 'Close a chat for the user, like ✕: its engine and the tools it started end.'),
  app_reopen_chat: t('app', 'Reopen a closed chat with its whole history.'),
  app_handoff_chat: t('app', 'Have a chat write its hand-off note now.'),
  app_continue_chat: t('app', '«Riprendi»: a new chat on the same engine and folder from the old chat\'s hand-off.'),
  app_set_chat_effort: t('app', 'Pick the reasoning effort of one running chat for this conversation only.'),
  app_set_chat_work: t('app', 'Declare, wait on or complete a chat\'s explicit assignment (holds the auto-close).'),
  agent_catalog: t(['app', 'chat'], 'The roles with purpose, tools and skills, and the skills that fit a request.'),
  agent_learn_propose: t(['app', 'chat'], 'Propose a lesson for a role (its text or a skill), queued for the user.'),
  app_unblock: t('orchestrator', 'Open the questions window with everything waiting for the user, after a recap he asked for.'),
  app_update_code: t('orchestrator', 'Update the app\'s code from GitHub, only when the user asked in his own words.'),
  app_voice_diagnostics: t('orchestrator', 'Content-free voice timing diagnostics (recognition, synthesis, failures).'),
  app_config: t('orchestrator', 'Read and change any configuration as the user\'s own click would, with Undo: settings, view, role cards, MCP connectors (add, edit, test, remove, per role; never a token), profile.'),
  app_routine_export: t('orchestrator', 'Export a routine package for the terminal `routine` CLI, secrets filled in the zip.'),
  app_routine_status: t('orchestrator', 'Routine packages and run history, read only, when the user asks.'),
  app_routine_capabilities: t('orchestrator', 'What a routine package is and can do: read before writing one.'),
  app_routine_connectors: t('orchestrator', 'The MCP servers a routine step can use and how to declare one.'),
  app_routine_save: t('orchestrator', 'Validate and save a routine package written from the user\'s need; never runs it.'),
  app_routine_packages: t('orchestrator', 'The saved routine packages, secrets masked.'),
  app_work_list: t('orchestrator', 'The persistent feature threads with stage, proposals and evidence.'),
  app_work_create: t('orchestrator', 'Create one persistent thread for a feature, bugfix or investigation.'),
  app_work_report: t('orchestrator', 'Update a thread\'s stage with concrete evidence.'),
  agent_lessons_waiting: t('orchestrator', 'The lessons waiting for review and the ones the user rejected.'),
  brain_script_save: t('orchestrator', 'Add, edit or fix a tested script in the brain\'s scripts/ folder.'),
  brain_script_delete: t('orchestrator', 'Move a brain script to scripts/.deleted/ (restorable).'),
  brain_changelog_add: t('orchestrator', 'Log a brain change made outside the script tools in the brain\'s changelog.'),
  app_recordings: t('orchestrator', 'The call recordings and their local transcripts, or the audio files found on the PC.'),
  app_recording_import: t('orchestrator', 'Import an audio or video file from the PC to be transcribed locally.'),
  app_learn: t('orchestrator', 'Start an Impara lesson the user asked for, or list the lessons.'),
  agent_metrics: t('orchestrator', 'Success rate, cost, time and corrections per role and version (numbers only).'),
  task_estimate: t('orchestrator', 'Estimate a request: kind of work, size, role, time and cost.'),

  // every work chat's own endpoint (wiring.ts addChatTools)
  agent_delegate: t('chat', 'Delegate independent parts of the task to other roles as visible child chats.'),
  agent_children: t('chat', 'The chats you delegated: role, state, goal, result, open requests, cost.'),
  agent_ask_parent: t('chat', 'Ask the chat that delegated you, before the user.'),
  agent_answer_child: t('chat', 'Answer a question one of your delegated chats asked you.'),
  agent_report: t('chat', 'Your one final result for the chat that started you.'),
  agent_assign_task: t('chat', 'Continue your direct child with a separate task run.'),
  agent_task_events: t('chat', 'The ordered user instructions for your direct child, read before reassigning it.'),
  agent_integrate_child: t('chat', 'Stage one finished child\'s commits in a fresh detached worktree.'),
  agent_integrate_children: t('chat', 'Combine several finished children\'s commits in one staging worktree.'),
  agent_child_feedback: t('chat', 'Your verdict on a delegated child\'s run, with evidence.'),
  agent_work_decisions: t('chat', 'The user\'s recorded decisions for your current assignment.'),
  plan_propose: t('chat', 'Show the user your short plan for approval (Strategist).'),
  plan_update: t('chat', 'Move a step of your approved plan: now, done, blocked or todo.'),
  list_chats: t('chat', 'The user\'s chats you can write to with send_to_chat.'),
  send_to_chat: t('chat', 'Send a message to another chat of the user, never as his approval.'),
  show_ui: t('chat', 'Show the user a visual from the app\'s component catalog instead of a wall of text.'),
  memory_recall: t('chat', 'Read the scoped memory of your role and project as quoted data.'),
  memory_propose: t('chat', 'Propose a scoped memory record for the user to review.'),
  brain_search: t('chat', 'Search the user\'s brain by meaning and words.'),
  brain_scripts: t('chat', 'The brain\'s tested reusable scripts with usage.'),
  brain_script_add: t('chat', 'Save a new script in the brain right after it ran and worked.'),
  brain_queries: t('chat', 'The brain\'s saved queries (SQL, KQL, GraphQL…).'),
  brain_query_add: t('chat', 'Save a new query in the brain right after it gave the right answer.'),
  maintenance_pack: t('chat', 'The data pack of a «Manutenzione» research, one section at a time.'),
  maintenance_propose: t('chat', 'Turn one maintenance finding into a card for the user.'),
  maintenance_role_trial: t('chat', 'Propose one revised role text as a trial for the user to approve.'),

  // the browser tools (browser/tools.ts): /mcp and every chat allowed to browse
  environments: t('browser', 'The browser environments with their sign-in status.'),
  tabs_list: t('browser', 'Your tabs with url, environment and the active one.'),
  tabs_create: t('browser', 'Open a new tab, optionally loading a url.'),
  tabs_select: t('browser', 'Make one of your tabs the active one.'),
  tabs_close: t('browser', 'Close one of your tabs.'),
  navigate: t('browser', 'Load a url in the active tab, or back, forward, reload.'),
  read_page: t('browser', 'The page as an accessibility tree with refs.'),
  find: t('browser', 'Elements whose role, name, text or test id contains a query.'),
  get_page_text: t('browser', 'The visible text of the page and its iframes.'),
  screenshot: t('browser', 'See the tab as an image when text is not enough.'),
  click: t('browser', 'A trusted mouse click on a ref or a coordinate.'),
  hover: t('browser', 'Move the mouse over a ref or coordinate.'),
  drag: t('browser', 'Drag from one ref or coordinate to another.'),
  type: t('browser', 'Type text as real key presses.'),
  key: t('browser', 'Press keys or key combinations.'),
  scroll: t('browser', 'Mouse-wheel scroll at a ref, coordinate or the page center.'),
  fill_form: t('browser', 'Fill several fields in one call.'),
  select_option: t('browser', 'Choose options of a native select.'),
  wait_for: t('browser', 'Wait for text, a selector, a url or the network to settle.'),
  handle_dialog: t('browser', 'Answer a JavaScript dialog that blocks the page.'),
  console_messages: t('browser', 'The console messages and uncaught errors of the tab.'),
  network_requests: t('browser', 'The network requests of the tab, filtered.'),
  javascript: t('browser', 'Run JavaScript only in a verified local stack\'s top page.'),
  handoff_to_user: t('browser', 'Ask the user to act in your tab (login, MFA, CAPTCHA).'),

  // the brain's own endpoints
  recall: t('hook', 'The past errors (ai-errors.md) most similar to a prompt, from the local search model.'),
  detect_correction: t('hook', 'Tell by meaning whether a message corrects the agent.'),
  text_complete: t('script', 'One prompt, one text answer on the user\'s Anthropic API key, for brain scripts.'),
};

/** Who a mount is, in words (app_guide). */
export const MOUNT_LABEL: Readonly<Record<ToolMount, string>> = {
  app: 'the Orchestrator and /mcp/app',
  orchestrator: 'the Orchestrator only',
  chat: 'every work chat (its own endpoint)',
  browser: 'chats that may browse, and external MCP clients',
  hook: 'the brain hooks',
  script: 'the brain scripts',
};
