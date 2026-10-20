import { PermissionFlagsBits } from 'discord.js';
import { fetchMembers } from './members.js';
import { isFormerMember } from './configuration.js';

export async function assignMemberRoles(guild, settings) {
  const members = await fetchMembers(guild);
  const candidates = [...members.values()].filter(member => !member.user.bot
    && !isFormerMember(member, settings) && !member.roles.cache.has(settings.memberRoleId));
  const errors = [];
  if (!candidates.length) return { members, errors };
  let role;
  try {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Bot needs Manage Roles to automatically assign the member role.');
    role = await guild.roles.fetch(settings.memberRoleId);
    if (!role || role.managed || role.id === guild.id || !role.editable) {
      throw new Error('Place the bot role above the configured member role and choose a normal, assignable role in Setup.');
    }
    if (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('Choose a regular member role without Administrator or Manage Roles for automatic assignment.');
    }
  } catch (error) { return { members, errors: [error.message] }; }
  for (const member of candidates) {
    try {
      // Use the single-role endpoint; preserve all other manually assigned roles.
      const updated = await member.roles.add(role.id, 'Automatically assign clan member role');
      members.set(member.id, updated);
    } catch (error) { errors.push(`Cannot assign member role to ${member.id}: ${error.message}`); }
  }
  return { members, errors };
}
