// English counterpart of the owner's profile texts.
import type { profileIt } from './profile.it';
export const profileEn: typeof profileIt = {
 'profile.group':'My profile',
 'profile.lead':'How your agents know you: the me.md file of your memory, read at the start of every chat.',
 'profile.name':'Name','profile.role':'Role','profile.language':'Chat language','profile.mainWork':'Work areas','profile.replyStyle':'Reply style',
 'profile.mainWorkHint':'One line per area: projects, clients or topics you follow.','profile.empty':'Not set yet',
 'profile.edit':'Edit','profile.save':'Save profile','profile.saved':'Profile saved to me.md.','profile.open':'Open me.md',
 'profile.rules':p=>p.n===1?'1 rule on how to work with you':`${p.n} rules on how to work with you`,
 'profile.growth':'Your profile grows with use: when you say "from now on…" in a chat, the brain-edit skill writes the rule here; the journal records each day’s work.',
 'profile.updated':p=>`Profile last changed: ${p.date}`,
 'profile.journal':p=>p.n===1?`Journal: 1 day, latest ${p.date}`:`Journal: ${p.n} days, latest ${p.date}`,
 'profile.journalNone':'Journal: no day written yet',
 'profile.locked':'This field has a custom layout in me.md: change it by asking in a chat (brain-edit skill).',
 'profile.noBrain':'Connect a working memory to see and edit your profile.',
 'profile.missing':'The connected memory has no me.md file.',
 'profile.unreadable':'me.md cannot be read safely (link, size or permissions).',
 'profile.changed':'me.md changed meanwhile: the new version is loaded and your edits are still here. Check and save again.',
 'profile.tooMany':p=>`At most ${p.n} work areas: merge the close ones.`,
 'profile.invalid':'Some fields are not valid: a name without symbols, each field on one line.',
 'profile.error':'Save failed. The file was not changed.',
};
