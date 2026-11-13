// A card opened in the Orchestrator's column has no free-answer box of its own (the owner 2026-11-12: «voglio vedere
// sempre l'input dell'orchestrator scrivibile, è quello il campo libero, non serve metterlo anche nel pannello delle
// domande»): QuestionsWindow.tsx AskCard provides it, DecisionCard.tsx reads it, hides its box and says to write in the
// Orchestrator's input. What the user writes there goes to the Orchestrator, which passes it on as his answer only when
// it answers an open question (ADR 0274, app_resolve_question `words`).
import { createContext } from 'react';

export const WriteViaOrchestrator = createContext(false);
