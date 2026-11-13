<!-- Review and integration notes for the agent catalogue overview, prepared for the human release integrator. -->
# feat(agents): add a dedicated catalogue overview

Agents were hidden behind the profile editor and could disappear from role-specific navigation. The main menu now always exposes Agents, with role and engine filters, sorting and clickable profile cards. Cards show the configured identity and model, probation status, version, completed/open runs, verified success and median reported cost with sample sizes. Last observed start comes from available chat run snapshots; missing values stay unavailable.

Create agent collects a short task, area and engine brief and opens an Orchestrator chat through the existing routed creation API. This branch has read-only agent discovery but no Orchestrator catalogue write tool, so the guide explicitly directs the user to save the agreed definition in the existing Studio. Catalogue change events populate the overview after saving. Import/export and .sbagent are untouched.

The existing Studio remains reachable and cards open the selected profile while preserving its unsaved draft. New UI copy is available in Italian and English. Metrics refresh on entry, catalogue change, manual refresh and every 30 seconds while mounted, with overlapping and obsolete requests guarded.

Validation: focused unit coverage for filtering, sorting, unknown metrics, verified sample coverage, translations, text escaping and the authoring brief; hidden isolated Electron demo inspected for overview, creation form and selected-profile detail. No e2e run. Fresh-context review completed; its stale-metrics finding was fixed and re-reviewed. See the local handoff for final check results and commit SHA.

Limits: last start covers available chats, not an all-time ledger; no learned-rule count is exposed by the existing agent metrics contract. No synthetic experience score is invented. Archived profiles retain their existing management behavior outside this active catalogue.
