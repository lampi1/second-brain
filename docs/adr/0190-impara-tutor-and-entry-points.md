# 0190 — Impara: a tutor that answers at once, and learning from where you are

Status: accepted. Builds on ADR 0185, ADR 0188 and ADR 0189.

2026-10-29.

## Context

The owner, 2026-10-29, on Impara: «devo poter capire concetti informatici cose di lavoro ecc ecc», «voglio proprio che
sia EFFICACE e utile a spiegare qualsiasi cosa», also «parti interne del brain dell'utente e dell'app». Until now, a
question during a lesson became a new piece: one hidden run of up to three minutes, with nothing on screen until the
whole piece was there. A learner who is stuck needs an answer in seconds. To learn about a PR, a work item, a rule of
the brain or a concept of the app, the user had to go to Impara and type it again.

Bastani et al. 2024 ("Generative AI Can Harm Learning", about 1000 high-school students) found that students with
plain GPT-4 did better during practice (+48%) but worse on the exam without it (−17%). A version that gave hints and
did not hand out the answer did better during practice (+127%), and on the exam it did as well as the control group.

## Decision

**The tutor.** «Domanda» (or T) opens the tutor as a column beside the board (a sheet at the bottom on a narrow
window). A question can be typed, spoken (with «Rispondo a voce», any sentence that is not a command goes to the tutor
and is sent at once), or asked by clicking a part of the diagram, which puts «<part>: cos'è e a cosa serve qui?» in the
box.

**Fast.** The answer is one hidden read-only run on the lesson's teacher at low effort. It does no new research: its
prompt holds the lesson's diagram, the piece the learner is on, the verified facts (ADR 0188) and the last four
exchanges, and it may read the lesson's files only when a line is missing. The text streams word by word
('impara:tutor'; `HeadlessRequest.onText` from the engine's partial messages). The engine's start, most of the wait,
happens ahead of time. When the tutor opens or the learner types, `tutorWarm` starts the session with a prompt still to
come (`HeadlessRequest.prompt` as a promise). The question goes in as soon as it is sent. A session that is not used
for 3 minutes closes without having sent anything. If the warm session died before answering, the question runs once
more from cold.

**Let the learner try.** «Prima provo io» is on by default. For a why or a how the learner has not tried yet, the
tutor gives a hint pointing at the right part of the diagram or the right fact, and asks one question back. The
learner's attempt gets said what is right and what is missing, then the explanation. A plain question of fact just
gets the answer. «Dimmelo e basta» on the hint, or the switch off, asks for the answer at once.

**Grounded and remembered.** The answer cites the facts it uses as [f1]. Each cite shows as a numbered chip with the
claim and source on hover, and a click opens the web page or the file at its line. When the tutor gave a full
explanation that verified facts support, it ends with a card line. The app checks it like every card: it must cite a
verified fact (`parseCards`). It then becomes a recall review card (origin `tutor`, ADR 0189), and the answer says «Aggiunta
al ripasso». The exchange is saved in the lesson (`Lesson.tutor`, the last 40). With the app's voice on, the answer is
read aloud.

**Learning from where you are.** Each of these opens Impara's start filled in (`learnAbout`). Who explains and how
deep stay the user's choice, and the user starts the lesson with one click, so nothing is spent without them:
- **Task:** «Capiscila» beside «Discuti» on a PR (the PR's lesson) and on a work item (a topic about it).
- **Memoria → Approvate:** «Spiegamelo» on a skill, a rule, a fact or a script. The subject is «Il mio brain», and the
  files research reads the brain.
- **Guida:** «Imparalo» on each concept. The subject is «second-brain», and the files research reads the app's guide
  and code.
- **Orchestrator:** `app_learn`, only on its own endpoint. When the user asks to understand something, it starts the
  lesson and opens it in Impara. Without an ask, it lists the lessons and the cards due today. Its description lets
  the Orchestrator offer «Vuoi capirla in 5 minuti?» after delivering a PR, and start the lesson only on a yes. A start
  from another page can name its subject (`LessonStart.subject`), which the plan then keeps.

## Consequences

Each tutor answer is one more short run, and its cost adds to the lesson's. A warm session keeps the engine's process
running for up to 3 minutes, at no token cost. The app's own start of the Orchestrator does not know the teacher the
user picked in Impara (a renderer preference), so the app's choice explains those lessons. The coach behaviour is
asked of the model in the prompt and not enforced, so a model can still answer at once. The tutor's speed and answers
were tried on the demo, not yet on a real model.
