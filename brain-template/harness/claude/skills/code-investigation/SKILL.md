---
name: code-investigation
description: Read-only root-cause investigation in {{OWNER}}'s code repos - why a bug happens, which commit/author introduced a regression and since which version, whether it is reachable, why a PR pipeline fails - and, on request, a ready fix package (exact edits + red-to-green test + Italian evidence) written to a given folder. Use for "perché succede", "da quando", "chi l'ha rotto", a fix to prepare while another chat owns the worktree. Not for reviewing a diff (code-review skill). Never edits the repo.
---
<!-- Shipped skill: the investigation method (the Scout role loads it). -->

# Code investigation: why code misbehaves, proven

You find why code misbehaves and prove it with file:line and commits; when asked, you also prepare the fix as a
package another chat applies. Report in Italian, code terms in English.

Read first: the target repo's `AGENTS.md` (and `docs/GLOSSARY.md` for domain terms). Other repos in `{{REPOS}}/`.

Input: the symptom (bug text, work item, failing PR), the repo or worktree path, and for a regression a baseline commit
(last good version). Fix package wanted → also the output folder and the work item. Missing baseline → use the commit of
the last release on that line and say so.

## Steps
1. Locate the code path that produces the symptom (entry point → data) and read it.
2. Regression: `git -C <repo> log -p <baseline>..<head> -- <paths>` and `blame` on the suspect lines; name the commit,
   author, date and first release that contains it. Pipeline: build/test logs via `az rest --resource
   499b84ac-1321-427f-aa17-267ca6975798 --url "https://dev.azure.com/{{DEVOPS_ORG}}/<project>/_apis/..."` (GET only);
   decide PR-caused vs pre-existing by comparing with the target branch's last run.
3. Try to disprove your cause (code workflow hunt stance): a control case, the same path on the base branch. Check
   reachability (callers, UI path) and real usage when evidence is given.
4. Fix package (only when asked), in the output folder: `fix.md` (each edit = path + old_string verbatim from the base
   commit + new_string; minimal, like the surrounding code; English conventional commit message with `#<id>` footer),
   the test file(s) following the repo's test standard (e.g. `docs/standards/backend-unit-tests.md`) and how to see it
   red, `evidence.md` in Italian (effect in 2 lines, commit that introduced it, before/after code, repro steps for the
   screenshot), `status.txt` = `READY` / `NOT-SURE (why)` / `NOT-A-REGRESSION`.

## Rules
- The repo belongs to other chats: git read-only (`log|show|diff|grep|blame`, `fetch` ok) and `git show
  <commit>:<file>` to read; never checkout, stash, commit, build or run tests there. Write only in the output folder.
- Call it a bug only when proven; say what is code-only.
- DevOps: read tools only; never comment, vote, rerun or change states.
- Safety: `{{BRAIN}}/me.md` "Safety" (no DB queries: write them for the caller). Never search `{{HOME_WIN}}`
  recursively.

## Report (max 8 lines, most important first)
Verdict · evidence file:line + commit/author/date · cause · confirmed vs hypothesis · fix in one line (or the package
folder + status) · what could not be checked.
