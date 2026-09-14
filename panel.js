import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { PATIENT_ROLE_ID } from './state.js';
import { listMessage, timeoffBlocks, issueBlocks } from './views.js';

export const commands = [
  new SlashCommandBuilder().setName('donations').setDescription('Daily Patient proof report, including excused members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('date').setDescription('YYYY-MM-DD; defaults to today')),
  new SlashCommandBuilder().setName('timeoff').setDescription('Request days off from donation requirements')
    .addStringOption(o => o.setName('start').setDescription('First day off: YYYY-MM-DD').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Number of days, including the start date').setMinValue(1).setMaxValue(365).setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason, visible only to you and admins').setMaxLength(500)),
  new SlashCommandBuilder().setName('timeoff-status').setDescription('View your time-off requests and approved dates'),
  new SlashCommandBuilder().setName('donation-admin').setDescription('Open the private donation and time-off admin panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];
export function panel(store, automation, today, timezone, page = 0) {
  const pending = Object.values(store.data.requests).filter(r => r.status === 'pending').length;
  const buttons = [ ['list', 'Requests & days off'], ['grant', 'Grant days off'],
    ['approve', 'Approve request'], ['reject', 'Reject request'], ['revoke', 'Revoke days off'] ];
  const message = listMessage('Donation admin panel',
      'Manage requests and approved days off below. Checks run every minute.',
      [...issueBlocks(automation), ...timeoffBlocks(store, today)], page, 'admin:page', {
        fields: [
          { name: 'Tracked members', value: `<@&${PATIENT_ROLE_ID}>`, inline: true },
          { name: 'Pending requests', value: String(pending), inline: true },
          { name: 'Timezone', value: timezone, inline: true },
          { name: 'Last check', value: automation.lastCheck || 'Starting' },
        ],
      });
  message.components.unshift(new ActionRowBuilder().addComponents(buttons.map(([action, label]) =>
    new ButtonBuilder().setCustomId(`admin:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary))));
  return message;
}
export function modal(action, today) {
  const specs = action === 'grant' ? [
    ['user', 'Member Discord ID', 'Paste the member ID, not the role ID'], ['start', 'First day off (YYYY-MM-DD)', today], ['days', 'Number of days (1–365)', '1'],
  ] : [[ 'id', action === 'revoke' ? 'Grant ID from the panel list' : 'Request ID from the panel list', '8-character ID' ]];
  return new ModalBuilder().setCustomId(`admin-submit:${action}`).setTitle({ grant: 'Grant days off', approve: 'Approve request', reject: 'Reject request', revoke: 'Revoke days off' }[action])
    .addComponents(specs.map(([id, label, placeholder]) => new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40))));
}
