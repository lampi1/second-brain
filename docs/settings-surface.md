# Settings presentation inventory

The renderer exposes four essential groups. This is a presentation change, not a policy migration. Existing values, protected flags, engine trust and agent-use denials stay in main unchanged. Technical controls were removed from the basic renderer, rather than hidden in an advanced list. Agent model choices belong to profiles; preserved legacy routing remains an internal compatibility fallback.

Appearance/theme/density and panel expansion use the existing sb.prefs.v1 namespace. Both IT and EN essential surfaces and packaged appearance controls use dictionaries. Account actions call existing typed secure-storage/login/trust handlers only on explicit clicks. No paid API admin credit panel is loaded by opening Settings.

| Setting | Presentation | Destination | Protected |
|---|---|---|---|
| brainRoot | essential | settings | yes |
| mcpPort | technical | diagnostics-or-feature-context | yes |
| view | retired | legacy-migration | no |
| theme | technical | diagnostics-or-feature-context | no |
| language | essential | settings | no |
| compactWindowTokens | technical | diagnostics-or-feature-context | no |
| orchestratorDayCompact | technical | diagnostics-or-feature-context | no |
| launchRulesClaude | derived | agent-capability-or-existing-policy | yes |
| launchRulesCodex | derived | agent-capability-or-existing-policy | yes |
| codexAutonomyRoots | technical | development-context | yes |
| contextWarnTokens | technical | diagnostics-or-feature-context | no |
| contextHandoff | technical | diagnostics-or-feature-context | no |
| coldHandoffMin | technical | diagnostics-or-feature-context | no |
| autoCloseMin | essential | settings | no |
| engineIdleMin | technical | diagnostics-or-feature-context | no |
| loadQueue | technical | diagnostics-or-feature-context | yes |
| loadQueueCpu | technical | diagnostics-or-feature-context | yes |
| loadQueueRam | technical | diagnostics-or-feature-context | yes |
| osToasts | essential | settings | yes |
| dndUntil | technical | diagnostics-or-feature-context | yes |
| dnd | technical | diagnostics-or-feature-context | yes |
| mute.* | technical | diagnostics-or-feature-context | yes |
| tasks.enabled | technical | diagnostics-or-feature-context | yes |
| tasks.everyMin | technical | diagnostics-or-feature-context | no |
| tasks.sound | technical | diagnostics-or-feature-context | yes |
| budget.enabled | technical | diagnostics-or-feature-context | yes |
| budget.claude.mode | technical | diagnostics-or-feature-context | yes |
| budget.claude.dailyUsd | technical | diagnostics-or-feature-context | yes |
| budget.claude.perChatUsd | technical | diagnostics-or-feature-context | yes |
| budget.cursor.mode | technical | diagnostics-or-feature-context | yes |
| budget.cursor.dailyUsd | technical | diagnostics-or-feature-context | yes |
| budget.cursor.perChatUsd | technical | diagnostics-or-feature-context | yes |
| orchestratorChats.claudeModel | derived | agent-capability-or-existing-policy | yes |
| orchestratorChats.claudeEffort | derived | agent-capability-or-existing-policy | yes |
| orchestratorChats.cursorModel | derived | agent-capability-or-existing-policy | yes |
| orchestratorChats.cursorReasoning | derived | agent-capability-or-existing-policy | yes |
| orchestratorChats.cursorFast | derived | agent-capability-or-existing-policy | yes |
| orchestratorOpacity | technical | diagnostics-or-feature-context | no |
| orchestratorEvents | technical | diagnostics-or-feature-context | yes |
| runResults | technical | diagnostics-or-feature-context | yes |
| questionsModal | technical | diagnostics-or-feature-context | yes |
| appRepo | technical | diagnostics-or-feature-context | yes |
| orchestratorChats.harness | derived | agent-capability-or-existing-policy | yes |
| engineOn.claude | essential | tool-connection | yes |
| engines.claude | derived | agent-capability-or-existing-policy | yes |
| engineOn.cursor | essential | tool-connection | yes |
| engines.cursor | derived | agent-capability-or-existing-policy | yes |
| engineOn.codex | essential | tool-connection | yes |
| engines.codex | derived | agent-capability-or-existing-policy | yes |
| engineOn.kimi | essential | tool-connection | yes |
| engines.kimi | derived | agent-capability-or-existing-policy | yes |
| engineOn.anthropic | essential | tool-connection | yes |
| engines.anthropic | derived | agent-capability-or-existing-policy | yes |

Dynamic engineOn.<id> and engines.<id> keys follow the same inventory rule for later registered engines; no ID is automatically enabled. Private persisted settings are neither read into this document nor deleted. Technical development roots remain protected and are not promoted to a basic colleague-facing choice. Contextual technical editors are separate from the essential surface and must retain their action boundary.
