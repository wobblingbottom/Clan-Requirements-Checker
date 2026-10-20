import { SlashCommandBuilder } from 'discord.js';

export const CLAN_TIMEOFF_MODAL = 'clan:timeoff-submit';
export const LEGACY_COMMANDS = ['donations', 'timeoff', 'timeoff-status', 'donation-admin'];
export const ACTIONS = [
  { name: 'Donation report', value: 'donations' },
  { name: 'Request time off', value: 'timeoff' },
  { name: 'My time off', value: 'timeoff-status' },
  { name: 'Admin panel', value: 'donation-admin' },
  { name: 'Setup', value: 'setup' },
];
export const commands = [new SlashCommandBuilder()
  .setName('clan').setDescription('Donation reports and member time off')
  .addStringOption(o => o.setName('action').setDescription('Choose a clan action')
    .setRequired(true).addChoices(...ACTIONS))
  .addStringOption(o => o.setName('date').setDescription('Donation report date; leave empty for today'))];

export function commandAction(interaction) {
  if (interaction.commandName !== 'clan') return interaction.commandName;
  const action = interaction.options.getString('action', true);
  if (!ACTIONS.some(choice => choice.value === action)) throw new Error('Choose a valid clan action.');
  return action;
}

export async function registerCommands(guild) {
  // Register the replacement before removing old entries. Keep unrelated commands.
  for (const command of commands) await guild.commands.create(command.toJSON());
  const registered = await guild.commands.fetch();
  for (const command of registered.values()) {
    if (LEGACY_COMMANDS.includes(command.name)) await guild.commands.delete(command.id);
  }
}
