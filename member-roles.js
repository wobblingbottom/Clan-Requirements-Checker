import { PermissionFlagsBits } from 'discord.js';
import { fetchMembers } from './members.js';
import { isFormerMember, isClanLeader } from './configuration.js';

export { isAsylumStaff } from './configuration.js';
const excludesMemberRole = (member, settings) => isFormerMember(member, settings) || isClanLeader(member, settings);

const transitioning = new Set();

export async function cycleRemovedRole(previous, member, settings) {
  if (member.user.bot || isClanLeader(member, settings)) return;
  const cycle = [settings.memberRoleId, settings.formerMemberRoleId, settings.visitorRoleId];
  // Ignore role swaps and cleanup events when another status role is present.
  if (cycle.some(id => id && member.roles.cache.has(id))) return;
  const removed = cycle.findIndex(id => id && previous.roles.cache.has(id));
  if (removed < 0 || !cycle[(removed + 1) % cycle.length]) return;
  const key = member.guild.id + ':' + member.id;
  if (transitioning.has(key)) return;
  transitioning.add(key);
  try {
    const id = cycle[(removed + 1) % cycle.length];
    const role = await member.guild.roles.fetch(id);
    if (!role || role.managed || !role.editable || role.id === member.guild.id
        || role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('Role cycle needs normal assignable roles below the bot role.');
    }
    await member.roles.add(id, 'Advance Patient / Patient No More / Visitor role cycle');
  } finally { transitioning.delete(key); }
}

export async function assignMemberRoles(guild, settings) {
  const members = await fetchMembers(guild);
  const candidates = [...members.values()].filter(member => !member.user.bot
    && !transitioning.has(guild.id + ':' + member.id)
    && excludesMemberRole(member, settings) === member.roles.cache.has(settings.memberRoleId));
  const errors = [];
  if (!candidates.length) return { members, errors };
  let role;
  try {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Bot needs Manage Roles to automatically manage the member role.');
    role = await guild.roles.fetch(settings.memberRoleId);
    if (!role || role.managed || role.id === guild.id || !role.editable) {
      throw new Error('Place the bot role above the configured member role and choose a normal, assignable role in Setup.');
    }

  } catch (error) { return { members, errors: [error.message] }; }
  const privileged = role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageRoles);
  if (privileged && candidates.some(member => !excludesMemberRole(member, settings))) errors.push('Choose a regular member role without Administrator or Manage Roles for automatic assignment.');
  for (const member of candidates) {
    const excluded = excludesMemberRole(member, settings);
    if (!excluded && privileged) continue;
    try {
      // Use the single-role endpoint; preserve all other manually assigned roles.
      const updated = excluded
        ? await member.roles.remove(role.id, 'Leadership, staff or visitor/no-longer-a-member role takes precedence')
        : await member.roles.add(role.id, 'Automatically assign clan member role');
      members.set(member.id, updated);
    } catch (error) { errors.push(`Cannot ${excluded ? 'remove' : 'assign'} member role ${excluded ? 'from' : 'to'} ${member.id}: ${error.message}`); }
  }
  return { members, errors };
}
