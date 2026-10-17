# Publish an isolated application proposal

The user prepares a separate worktree in Migliora, asks for a change and authorizes local commits. Run the repository checks on the final commit. `sb-checks.json` must contain the full SHA with a green light/full check; abbreviated entries do not count.

Obtain fresh independent reviews of correctness, security and usability on that exact commit. After reading each report, record its actual verdict from the clean proposal worktree:

```text
node scripts/record-proposal-review.mjs --head <full SHA> --dimension correctness --reviewer <reviewer identity> --report <local report file> --verdict passed
```

Repeat for `security` and `usability`; use `failed` for a blocking report. The script records time, verdict, reviewer and report digest in the Git common directory's `sb-proposal-reviews.json`. Reports stay outside product history. All three passed attestations must be at most seven days old and match the full SHA. A changed commit needs new checks and reviews. These local attestations rely on the same trusted local workflow as the check ledger; they do not authenticate a reviewer's identity or prove that a review happened independently.

In Migliora, reread the differences and checks, explicitly select the sharing confirmation, then click Apri PR su GitHub. Only renderer IPC exposes publication; there is no publication MCP tool. Main repeats all gates, checks gh authentication and uses the user's existing Git/gh login. Missing gh or login leaves the change local with a GitHub connection message. The push targets an immutable SHA on the dedicated branch with hooks enabled, without force. No merge, update or restart occurs.
