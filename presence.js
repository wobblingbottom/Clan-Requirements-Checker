import { ActivityType } from 'discord.js';
import { isFormerMember, isClanLeader } from './configuration.js';

export function updatePatientPresence(user, members, settings) {
  const count = [...members.values()].filter(member => !member.user.bot
    && member.roles.cache.has(settings.memberRoleId)
    && !isFormerMember(member, settings) && !isClanLeader(member, settings)).length;
  const state = 'Watching over ' + count + ' patients';
  if (!user.presence.activities.some(activity => activity.type === ActivityType.Custom && activity.state === state)) {
    user.setActivity('Patient count', { type: ActivityType.Custom, state });
  }
}
