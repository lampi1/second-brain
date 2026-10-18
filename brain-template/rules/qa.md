---
when: {"prompt":["qa","test case","caso di test","verifica il fix","collaudo"],"tools":[],"paths":["**/rules/qa.md"]}
---
# QA rules

{{OWNER}}'s rules for testing (manual or with an agent in a browser). Read when: a QA chat, a test case, verifying a
fix. Write when: {{OWNER}} states or corrects a QA rule.

- **The scenario is exact**: never changed to get around a bug; a blocked step stays Blocked and is reported.
- **Evidence**: every Passed/Failed has a screenshot or a log line; results are published only after {{OWNER}}'s ok.
- **Test data**: never created in shared environments without asking.
