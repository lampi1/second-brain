# 0206 — Impara: web research driven by the user's files, through a deterministic filter

Status: accepted. Amends ADR 0188 (research before teaching).

2026-10-30.

## Context

ADR 0188 split Impara's research in two so that no run ever holds both the user's files and untrusted web pages (the
"lethal trifecta": private data, untrusted content, a way out): the web run sees only the user's ask, the files run reads
the material, the brain and the app and never the web. The cost: the web research cannot know what the files use. A PR
that adds an OAuth login gets general background on "the PR", not RFC 6749 or OWASP's session guidance; a PR's lesson
gets no web research at all. The owner (report «Impara v3», I2, approved 2026-10-30) asked for web research driven by the
files too, e.g. the standards that apply to the request, keeping the separation.

## Decision

**The files run names public topics.** When the web can run (Claude on), the files run also returns up to 8 topics worth
searching: standards, specifications, protocols and public libraries with their major version («OAuth 2.0 RFC 6749»,
«OWASP Session Management», «Express 5 error handling»), each with a short reason and the file it comes from. The reason
and the file stay in the app: they are shown to the user, never sent to a web run. This holds for a PR's lesson too
(it still has no ask-only web run: its ask says nothing a search could use).

**The app filters every query, deterministically** (`src/shared/web-topics.ts`, pure, unit-tested; zero tokens). A query
passes only when every word of it is plainly public, else it is dropped whole:

- at most 8 words and 80 characters, from an allow-list of characters (letters, digits, space, `. - + # / : ( ) ' · ,`);
- no path or drive, no file name (`name.ext`, dotfiles), no URL except https on a short list of public documentation hosts
  (IETF, RFC Editor, W3C, WHATWG, OWASP, ISO, NIST, MDN, Microsoft Learn, the official docs of major runtimes and
  libraries) and never with userinfo, port, query or fragment; no e-mail;
- no number of 6 or more digits, no hex string of 8 or more with digits, no token longer than 24 characters, no word
  mixing letters and digits unless it is a version (`v18`, `3.11`) or a standard's id with a known prefix (`ES2022`,
  `SHA-256`, `CWE-79`), so `PROJ-1234` or a commit hash never pass;
- a name-like word (Capitalised, camelCase, ALLCAPS, with `-` or `'`) passes only when it is a known public term (a
  built-in vocabulary of bodies, protocols, formats, languages and libraries), a common technical word, a standard's
  number, or a word of the user's own ask (the web run sees the ask anyway). In doubt, dropped: an unknown brand or a
  colleague's surname never passes, even when it is not in the material;
- a plain word that is a name of the user's files or folders, or that is met in the private material (the material,
  the files run's own answer without the queries, the file names, the PR link) and is neither common nor public, is
  dropped.

The conservative rule costs some good queries; that is the intended trade. The vocabulary and the common words are
reviewed like code.

**The user sees what goes out.** The Preparing screen shows the queries left as chips, «Dai tuoi file · cercherò sul
web», each with its reason and file name as a tooltip, ✕ to drop one, «Cerca ora», and a countdown: they start by
themselves after 5 seconds (each ✕ gives the rest 5 more; none left = no search). In «Modalità notte» (setting
`awayMode`) they start at once: nobody is there to look, and the filter alone guards. How many the filter dropped is
said in one line, never which words.

**A second web run, beside the rest, to keep latency low.** The ask-only web run still starts at once, beside the files
run. The topics' web run (`impara-refs`, Claude only, web tools only, in the lesson's empty `web` folder, like the first)
starts as soon as the files run ends and the user's 5 seconds pass, in parallel with the verification of the other facts
and the questions before the lesson. It sees only the ask and the approved queries (by id), prefers primary sources (RFC,
ISO, W3C, OWASP, the official documentation of that version) and tags each fact with the topic it was searched for. Its
facts go through the same web verification (`impara-verify-refs`, a run that did not write them re-reads each page);
they are numbered after every other fact and the plan waits for them. A fact that names none of the approved topics is
left out. Each such fact keeps `topic` = the query (never the file), and the UI says «trovato perché il tuo file usa X».

**Sources.** In «Fonti» (the drawer), on the Preparing screen's source chips and in a piece's sources, these facts are
grouped under «Standard e riferimenti», each saying why it was searched.

## Security

The flow from the files to the web is now one narrow, visible channel: up to 8 short queries, filtered by a pure
function, shown to the user before they leave (except in «Modalità notte»). The web runs still never read a file, the
topics' reasons or refs, the material or the files facts; nothing the files run wrote reaches a web run except the
queries that passed. A prompt injection in the material can at most make the files run propose a query; the filter
drops anything that is not public vocabulary, common words, versions or standard ids, so the channel cannot carry a
secret, a name or an identifier of the user's. Residual risk: a combination of public words chosen by an injected
instruction (it reveals only that the files talk about that public topic), and lowercase words absent from what the app
saw of the brain (the files run may read brain pages it does not quote). Prompts treat every query, page and file as
data.

## Consequences

- `LessonFact.topic`, `LessonPrep.topics` (`list`, `state` wait|go|done|skip, `at` on the real clock, `dropped`) and
  `refs`; the prep phase `refs` (shown only when there were topics); IPC `impara:topics` (`drop` one, `go`).
- `LearnDeps.away` (wired to `awayMode`); rounds `impara-refs`, `impara-verify-refs`.
- A lesson with topics waits up to 5 seconds more plus one web run and its check, while the other verification runs.
- The demo's PR #251 proposes three topics (one more is dropped by the filter) so the chips can be seen and screenshot.
- Tests: `test/unit/web-topics.test.ts` (filter, topics, topic facts), `test/unit/learn-service.test.ts` (the flow).
