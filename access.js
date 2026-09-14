import { PermissionFlagsBits } from 'discord.js';

export function checkAccess(interaction, guildId) {
  if (interaction.guildId !== guildId) throw new Error('This is not the configured server.');
  const approval = interaction.customId?.startsWith('timeoff-review:approve:')
    || interaction.customId === 'admin:approve'
    || interaction.customId === 'admin-submit:approve';
  if (approval) {
    const roles = interaction.member?.roles;
    const hasRole = id => Array.isArray(roles) ? roles.includes(id) : roles?.cache?.has(id);
    if (!['1532826140086112256', '1532826772624769316'].some(hasRole)) {
      throw new Error('Only Leaders and Co-leaders can approve time-off requests.');
    }
    return;
  }
  const admin = interaction.customId?.startsWith('admin:')
    || interaction.customId?.startsWith('admin-submit:')
    || interaction.customId?.startsWith('timeoff-review:')
    || interaction.commandName === 'donation-admin';
  if (admin && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Only server administrators can manage days off.');
  }
  if ((interaction.commandName === 'donations' || interaction.customId?.startsWith('report-page:'))
      && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server permission to view donation reports.');
  }
}
