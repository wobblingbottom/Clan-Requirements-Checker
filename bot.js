import { Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dayAt, validDay, hasImage } from './tracking.js';
import { PATIENT_ROLE_ID, Store, dateRange } from './state.js';
import { Automation } from './automation.js';
import { commands, panel, modal, timeoffList, file, clean } from './panel.js';
import { checkAccess } from './access.js';
import { brandedMessage } from './messages.js';

const { DISCORD_TOKEN, GUILD_ID, DONATION_CHANNEL_ID } = process.env;
const timezone = process.env.TIMEZONE || 'Europe/Paris';
for (const [name, value] of Object.entries({ GUILD_ID, DONATION_CHANNEL_ID })) {
  if (!/^\d{17,20}$/.test(value || '')) throw new Error(`Set a valid ${name} in .env`);
}
if (!DISCORD_TOKEN || DISCORD_TOKEN === 'put_your_bot_token_here') throw new Error('Set DISCORD_TOKEN in .env');
const today = () => dayAt(Date.now(), timezone);
today();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: [] },
});
let automation;
let store;
let timer;
let queue = Promise.resolve();
const serialize = action => {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
};
let tickQueued = false;
const schedule = () => {
  if (!automation || tickQueued) return;
  tickQueued = true;
  void serialize(() => automation.tick()).catch(error => console.error('Daily check failed:', error.message))
    .finally(() => { tickQueued = false; });
};
async function patient(userId) {
  const member = await automation.guild.members.fetch(userId);
  if (member.user.bot || !member.roles.cache.has(PATIENT_ROLE_ID)) throw new Error('This member must have the Patient role.');
  return member;
}
async function handleAdminSubmit(interaction, action) {
  const get = id => interaction.fields.getTextInputValue(id).trim();
  let response;
  if (action === 'grant') {
    const userId = get('user');
    if (!/^\d{17,20}$/.test(userId)) throw new Error('Enter the member Discord ID, not their name or a role ID.');
    await patient(userId);
    const grant = store.grant(userId, get('start'), Number(get('days')), interaction.user.id);
    response = `Granted ${grant.days} days off to <@${userId}>: **${grant.start} through ${grant.end}**. Grant ID: ${grant.id}.`;
  } else if (action === 'approve') {
    const request = store.data.requests[get('id')];
    if (!request || request.status !== 'pending') throw new Error('Pending request not found.');
    await patient(request.userId);
    const grant = store.grant(request.userId, request.start, request.days, interaction.user.id, request.id);
    response = `Approved request ${request.id}: **${grant.start} through ${grant.end}**. Grant ID: ${grant.id}.`;
  } else if (action === 'reject') {
    store.reject(get('id'), interaction.user.id);
    response = 'Request rejected. The member can see this with /timeoff-status.';
  } else if (action === 'revoke') {
    store.revoke(get('id'), interaction.user.id);
    response = 'Days off revoked. Daily checks apply again unless another approved period covers the member.';
  } else throw new Error('Unknown admin action.');
  await interaction.editReply(brandedMessage('Time off updated', `${response}\n\nNickname changes apply on the next check. Previously sent reminders cannot be withdrawn.`));
  schedule();
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(DONATION_CHANNEL_ID);
    if (channel?.type !== ChannelType.GuildText) throw new Error('Donation channel must be a normal text channel in this server.');
    if (!await guild.roles.fetch(PATIENT_ROLE_ID)) throw new Error('Patient role 1532826238572298451 not found in this server.');
    const me = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    for (const permission of ['ViewChannel', 'ReadMessageHistory', 'AddReactions', 'SendMessages', 'AttachFiles', 'EmbedLinks']) {
      if (!permissions?.has(PermissionFlagsBits[permission])) throw new Error(`Missing donation channel permission: ${permission}`);
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) throw new Error('Bot needs Manage Nicknames permission.');
    store = new Store(fileURLToPath(new URL('./data/state.json', import.meta.url)), today(), GUILD_ID, timezone);
    automation = new Automation({ guild, channel, reminder: channel, store, timezone, botId: client.user.id });
    for (const command of commands) await guild.commands.create(command.toJSON());
    console.log(`Ready: Patient daily checks in ${timezone}. Reminders go to the donation channel.`);
    timer = setInterval(schedule, 60000);
    schedule();
  } catch (error) {
    console.error('Startup failed:', error.message);
    client.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.MessageCreate, async message => {
  if (!automation || message.guildId !== GUILD_ID || message.channelId !== DONATION_CHANNEL_ID
      || message.author.bot || message.webhookId || !hasImage(message)) return;
  try {
    await patient(message.author.id);
    schedule();
    await message.react('📸');
  } catch (error) { console.error('Screenshot acknowledgement:', error.message); }
});

client.on(Events.InteractionCreate, async interaction => {
  const isCommand = interaction.isChatInputCommand() && commands.some(c => c.name === interaction.commandName);
  const isButton = interaction.isButton() && interaction.customId.startsWith('admin:');
  const isModal = interaction.isModalSubmit() && interaction.customId.startsWith('admin-submit:');
  if (!isCommand && !isButton && !isModal) return;
  try {
    if (!automation || interaction.guildId !== GUILD_ID) throw new Error('Bot is starting or this is not the configured server.');
    checkAccess(interaction, GUILD_ID);
    if (isButton && interaction.customId !== 'admin:list') {
      const action = interaction.customId.split(':')[1];
      if (!['grant', 'approve', 'reject', 'revoke'].includes(action)) throw new Error('Unknown action.');
      await interaction.showModal(modal(action, today()));
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await serialize(async () => {
      if (isModal) return handleAdminSubmit(interaction, interaction.customId.split(':')[1]);
      if (isButton || interaction.commandName === 'donation-admin') return interaction.editReply(panel(store, automation, today(), timezone));
      if (interaction.commandName === 'timeoff') {
        await patient(interaction.user.id);
        const start = interaction.options.getString('start');
        const days = interaction.options.getInteger('days');
        dateRange(start, days);
        if (start < today()) throw new Error('Requests must start today or later. Ask an admin for a retroactive exemption.');
        const request = store.request(interaction.user.id, start, days, interaction.options.getString('reason') || '');
        return interaction.editReply(brandedMessage('Time-off request submitted',
          'Your request is waiting for an administrator. You are excused only after approval.\nUse `/timeoff-status` to check for updates.', {
            fields: [
              { name: 'Dates', value: `${request.start} through ${request.end}` },
              { name: 'Days off', value: String(days), inline: true },
              { name: 'Request ID', value: request.id, inline: true },
            ],
          }));
      }
      if (interaction.commandName === 'timeoff-status') {
        return interaction.editReply(brandedMessage('Your days off',
          'Your requests and approved dates are attached. Pending requests still need admin approval.', {
            files: [file(timeoffList(store, today(), timezone, interaction.user.id), 'my-time-off.txt')],
          }));
      }
      const day = interaction.options.getString('date') || today();
      if (!validDay(day) || day > today() || day < '2015-01-01') throw new Error('Use a real YYYY-MM-DD date from 2015 through today.');
      const report = await automation.report(day);
      const label = m => `${clean(m.displayName)} (${m.id})`;
      const text = [
        `Daily donation proof: ${day} (${timezone})`,
        'Image uploads are not verified donations. Roster uses current Patient members.',
        ...(day === today() ? ['Today is still in progress.'] : []),
        '', `SUBMITTED (${report.submitted.length})`, ...report.submitted.map(m => `${label(m)}: ${report.submissions.get(m.id)}`),
        '', `MISSING (${report.missing.length})`, ...report.missing.map(label),
        '', `EXCUSED (${report.excused.length})`, ...report.excused.map(label),
      ].join('\n');
      return interaction.editReply(brandedMessage('Daily donation report',
        `**${day}** · ${timezone}\nTracking **${report.roster.length}** Patient members.\nFull member lists and screenshot links are attached.${day === today() ? '\n\nToday is still in progress.' : ''}`, {
        fields: [
          { name: 'Submitted', value: String(report.submitted.length), inline: true },
          { name: 'Missing proof', value: String(report.missing.length), inline: true },
          { name: 'Excused', value: String(report.excused.length), inline: true },
        ],
        files: [file(text, `donations-${day}.txt`)],
      }));
    });
  } catch (error) {
    console.error('Interaction failed:', error.message);
    const payload = brandedMessage('Unable to complete this action', String(error.message).slice(0, 1900));
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch (replyError) { console.error('Could not respond:', replyError.message); }
  }
});
client.on(Events.Error, error => console.error('Discord client error:', error.message));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(timer);
  client.destroy();
  process.exit(0);
});
client.login(DISCORD_TOKEN).catch(error => {
  console.error('Login failed:', error.message);
  client.destroy();
  process.exitCode = 1;
});
