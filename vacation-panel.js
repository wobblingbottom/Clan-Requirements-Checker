import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { brandedMessage } from './messages.js';

export const VACATION_CHANNEL_ID = '1549128315095355422';
export const VACATION_BUTTON = 'vacation:request';
export const VACATION_MODAL = 'vacation:submit';

export function vacationNotice() {
  return {
    ...brandedMessage('Crazyland clan member vacations.',
      "**inactive-notices**\n\nIf you'll be inactive for a few days, let the leadership team know by __creating a ticket__ and include how long you expect to be away and, if possible, the reason for your absence."),
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(VACATION_BUTTON).setLabel('Create ticket').setEmoji('📩').setStyle(ButtonStyle.Success))],
  };
}

export function vacationModal(today) {
  const fields = [
    new TextInputBuilder().setCustomId('start').setLabel('Start date (YYYY-MM-DD)').setStyle(TextInputStyle.Short)
      .setRequired(true).setMinLength(10).setMaxLength(10).setValue(today),
    new TextInputBuilder().setCustomId('days').setLabel('Number of days off (1–365)').setStyle(TextInputStyle.Short)
      .setRequired(true).setMaxLength(3),
    new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph)
      .setRequired(false).setMaxLength(500),
  ];
  return new ModalBuilder().setCustomId(VACATION_MODAL).setTitle('Request days off')
    .addComponents(...fields.map(field => new ActionRowBuilder().addComponents(field)));
}

export async function ensureVacationNotice(channel, store, botId) {
  const matches = message => message.author?.id === botId && message.components?.some(row =>
    row.components.some(component => component.customId === VACATION_BUTTON));
  let message;
  const saved = store.data.vacationPanel;
  if (saved?.channelId === channel.id && saved.messageId) {
    try { message = await channel.messages.fetch(saved.messageId); }
    catch (error) { if (error.code !== 10008) throw error; }
    if (message && !matches(message)) throw new Error('Saved vacation notice is not a matching bot message.');
  }
  // Recover a successful send whose ID was not saved before a restart.
  if (!message) {
    let before;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('Vacation channel history exceeds recovery limit. No duplicate notice was posted.');
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      message = batch.find(matches);
      if (message || batch.size < 100) break;
      before = batch.last().id;
    }
  }
  if (message) await message.edit({ ...vacationNotice(), attachments: [] });
  else message = await channel.send(vacationNotice());
  store.data.vacationPanel = { channelId: channel.id, messageId: message.id };
  store.save();
  return message;
}
