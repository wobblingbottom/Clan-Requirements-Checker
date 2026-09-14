import { PermissionFlagsBits } from 'discord.js';

export function checkAccess(interaction, guildId) {
  if (interaction.guildId !== guildId) throw new Error('This is not the configured server.');
  const admin = interaction.customId?.startsWith('admin:')
    || interaction.customId?.startsWith('admin-submit:') || interaction.commandName === 'donation-admin';
  if (admin && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Only server administrators can manage days off.');
  }
  if (interaction.commandName === 'donations' && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server permission to view donation reports.');
  }
}
