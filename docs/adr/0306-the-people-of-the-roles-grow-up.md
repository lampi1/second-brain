# ADR 0306 · The people of the roles grow up: adult bodies, faces and characters

Date: 2026-11-14 · Status: accepted (owner, 2026-11-14: «vorrei anche che cambiassi i personaggi dei miei agenti,
sempre gli stessi ruoli ma li voglio più da adulto, adesso sembrano robe per bambino, voglio l'artigiano che
assomigli proprio a un fabbro muscoloso con il sigaro, la sentinella più cattiva, cioè voglio personalità più adulte,
meno bambinesco ma stile grafico simile, anche le frasi devono essere calzanti con il carattere … anche icone
diverse»; shown the animated proposal: «mi piace molto … per il resto approvo tutto, mergia pure su main», asking
only for the Orchestrator to be an old wise wizard instead of the conductor) · Amends: ADR 0295 (who the little
people are and how they are built), ADR 0303 (each role's character and its lines), ADR 0304 (the lines at the chess
board)

## Context

The people of ADR 0295 were built like toys: a head as large as the body, round cheeks with a blush, two dots for
eyes, short limbs. The owner found them childish and asked for the same roles as adults, with adult characters, in
the same smooth vector style; he named two of them (the Artisan a muscular blacksmith with a cigar, the Sentinel
meaner) and, after the proposal, a third (the Orchestrator an old wise wizard).

## Decision

1. An adult rig (`lib/sprite-rig.ts`). A person is a little over three heads tall: the badge's head at 0.56 of its
   size on a neck, shoulders, a torso that narrows to the waist, hips, legs that bend at the knee, arms at the elbow.
   Each role has its own `Build` (shoulders, waist, hips, the width of arms and legs, the neck, a belly) and may add
   a shape on each shoulder (`pad` turns with the arm: a deltoid; `cap` stays on the shoulder: a pauldron) and
   something behind the body (a cape, a coat's tails).
   The `Pose` a scene writes is the same as before, so states, activities (ADR 0305) and reactions (ADR 0297) keep
   their names, their timing and their rules; the picture stays 80 × 64 and a person is as tall on a strip as before.
2. Adult faces and new badges (`lib/character-art.ts`). A head has a jaw of its own, small eyes under real brows
   (level, stern, one raised, heavy), heavy lids where it fits, a nose, a beard or a moustache, and no blush. A face
   in the dark of a closed helm is two slits of light (`glow`) and no mouth. The round badge (`AgentAvatar`) is drawn
   from the same data, so the icons of the roles change with the people; the small variant keeps the badge's colour,
   the silhouette and the eyes.
3. The cast. Orchestrator: an old wizard with long white hair and a beard down to the chest, small round glasses, a
   midnight robe with a gold hem; he leads the work with a wand whose tip glows and sheds stars. An original figure
   of the «wise old wizard» kind, not a character of an existing work. Strategist: cropped greying hair, gold
   glasses, a boxed beard, rolled sleeves and a waistcoat; he slams a chess knight on his table and the espresso
   shivers. Scout: a tracker in a worn leather hat and a long coat with a ginger beard; he strides and raises a
   spyglass. Artisan: a bare-chested smith with a black beard, a red rag on the skull, a leather apron and a cigar
   that smokes; he hammers hot iron on an anvil. Sentinel: dark plate, spiked pauldrons, a cape, a closed helm with
   red eye slits; it watches and slams a halberd on the ground. Herald: a stout town crier in a tricorn with a waxed
   moustache; he blows a long trumpet with its banner. A chat without a role: a tired senior developer in a hoodie at
   a standing desk.
4. The shared states are an adult's: waiting is arms folded and a foot tapping, done a fist pump and then fists on
   the hips, an error a facepalm, idle asleep on its feet with the arms folded; a pat makes it lean into the hand.
   What moves by itself all the time (the cigar's smoke, the cape) is left out of the scenes that play once.
5. The characters and their lines (`shared/agent-quips.ts`, `lib/chess-lines.*.ts`). `QUIP_CHARACTER` says who each
   one is: a serene, cryptic old wizard; a cold strategist who talks like a chess master; a weathered tracker of few
   words; a huge gruff blacksmith; a merciless guard; a pompous wine-loving town crier; a burned-out senior developer.
   Every fixed line is rewritten in these characters in Italian, English and German, under the rules of ADR 0303
   (24 characters, five words, `{x}` only where a thing can be named); the lines of the day (ADR 0305) are written
   from the same characters, and the ones kept from before are dropped (the store of `quips/daily.ts` is at `v` 2). At the chess board the Orchestrator and the Scout have new lines and the Artisan's are a
   smith's; the other three already spoke as they are now.

## Consequences

- The role icons everywhere in the app (cards, lists, the rail, chess) change with the people: one source of data.
- A role's look is more code than before (a build, clothes, pads); a new role needs a head in `character-art.ts` and
  a body in `agent-sprites.ts`.
- The faces are smaller on a 60 px strip than the toy heads were; the owner chose to keep the size.

## Rejected

- Keeping the toy bodies with adult heads: the proportions are what read as childish.
- An open face with a scar for the Sentinel: offered, the owner kept the closed helm.
- Copying a known character for the Orchestrator: the figure keeps only what is common to the kind (white beard,
  robe, wand), and no line of his quotes or names an existing work.
