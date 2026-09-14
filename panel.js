import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { PATIENT_ROLE_ID } from './state.js';

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
export const file = (text, name) => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name });
export const clean = value => String(value).replace(/[\r\n\t]/g, ' ');
export function timeoffList(store, today, timezone, userId) {
  const requests = Object.values(store.data.requests).filter(r => !userId || r.userId === userId);
  const grants = Object.values(store.data.grants).filter(g => !userId || g.userId === userId);
  return [
    `Time off (${timezone}); start and end dates are inclusive.`,
    'Pending requests are NOT exemptions. Approved time off is required.',
    '', 'REQUESTS', ...requests.map(r => `${r.id} | user ${r.userId} | ${r.start} to ${r.end} | ${r.days} days | ${r.status} | ${clean(r.reason || '')}`),
    '', 'GRANTS', ...grants.map(g => `${g.id} | user ${g.userId} | ${g.start} to ${g.end} | ${g.revokedAt ? 'revoked' : g.end < today ? 'expired' : g.start > today ? 'scheduled' : 'active'} | admin ${g.adminId}`),
  ].join('\n');
}
export function panel(store, automation, today, timezone) {
  const pending = Object.values(store.data.requests).filter(r => r.status === 'pending').length;
  const buttons = [ ['list', 'Requests & days off'], ['grant', 'Grant days off'],
    ['approve', 'Approve request'], ['reject', 'Reject request'], ['revoke', 'Revoke days off'] ];
  const errors = [...automation.nicknameErrors, ...(automation.lastError ? [automation.lastError] : [])];
  return {
    content: `**Donation admin panel**\nPatient role: <@&${PATIENT_ROLE_ID}>\nDaily timezone: ${timezone}\nPending requests: **${pending}**\nLast check: ${automation.lastCheck || 'Starting'}\nChecks run every minute. Review the attached list for request/grant IDs.\n${errors.length ? `**${errors.length} automation issue(s)** — see issues.txt.` : ''}`,
    components: [new ActionRowBuilder().addComponents(buttons.map(([action, label]) =>
      new ButtonBuilder().setCustomId(`admin:${action}`).setLabel(label).setStyle(ButtonStyle.Secondary)))],
    files: [file(timeoffList(store, today, timezone), 'time-off.txt'), ...(errors.length ? [file(errors.join('\n'), 'issues.txt')] : [])],
    allowedMentions: { parse: [] },
  };
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
