---
when: {"prompt":["non funziona","errore","error","problema","runbook"],"tools":[],"paths":["**/ops/runbook/**"]}
---
# Runbook index

One file per topic. Format of each entry: **symptom / request → where to look → command or query → expected outcome
→ notes**. Read when: a problem is described (search here first). Write when: a procedure is learned (its topic file,
plus a line here).

| File | Topic |
|------|-------|
| `brain.md` | Il cervello stesso: pagine dell'app in errore, memoria che non si scrive, commit che non arrivano, posta tra chat, agenti in Cursor |

The first file is about the brain itself and doubles as the format example. Your own topics (a service, a customer
procedure, a deploy) get one file each the first time you solve them: say "salvalo nel runbook" to the chat.
