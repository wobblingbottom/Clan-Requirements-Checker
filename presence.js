import { ActivityType } from 'discord.js';
import { isFormerMember, isClanLeader } from './configuration.js';

export function updatePatientPresence(user, members, settings) {
  const count = [...members.values()].filter(member => !member.user.bot
    && member.roles.cache.has(settings.memberRoleId)
    && !isFormerMember(member, settings) && !isClanLeader(member, settings)).length;
  const name = 'over ' + count + ' patients';
  if (!user.presence.activities.some(activity => activity.type === ActivityType.Watching && activity.name === name)) {
    user.setActivity(name, { type: ActivityType.Watching });
  }
}
