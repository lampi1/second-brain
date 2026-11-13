# ADR 0298 · The weekly limit on the top bar, the 5-hour window from 70%

Date: 2026-11-13 · Status: accepted (owner, 2026-11-13: «non vedo più la percentuale nella barra in alto non mi
interessa il limite delle 5 ore ma quello settimanale io ho l'ultra») · Amends: ADR 0287 (the usage figure)

## Context

ADR 0287 put today's spend and the Claude 5-hour window on the top bar, the week only from 70%. On the owner's plan
the bar showed «5h —»: no percentage. Claude Code's `get_usage` and `rate_limit_event` types allow `five_hour` to be
null or absent while `seven_day` is there (checked in the installed CLI's schema; not checked on the owner's PC), and
the app then had a week below 70% (hidden) and no 5-hour figure: nothing to show.

## Decision

The bar shows «7g» (the weekly limit) always; «5h» appears beside it only from 70%, as the week did before. The tooltip
and the popup list the week first. Data and sources are unchanged (`brain/usage.ts`).

## Consequences

The owner sees the limit he cares about. A plan with a 5-hour window still gets it on the bar when it matters. If the
week too is unknown the bar shows «7g —» and the popup says why (limitsNote), as before.
