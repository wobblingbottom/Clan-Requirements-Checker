import { Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dayAt, validDay, hasImage } from './tracking.js';
import { PATIENT_ROLE_ID, TIMEOFF_ROLE_IDS, canRequestTimeoff, Store, dateRange } from './state.js';
import { Automation } from './automation.js';
import { commands, panel, adminTimeoffView, modal } from './panel.js';
import { timeoffView, donationView, timeoffRequestNotice } from './views.js';
import { checkAccess } from './access.js';
import { brandedMessage } from './messages.js';

const { DISCORD_TOKEN, GUILD_ID, DONATION_CHANNEL_ID } = process.env;
const ADMIN_CHANNEL_ID = '1532826033089151184';
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
let adminChannel;
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
async function timeoffMember(userId) {
  const member = await automation.guild.members.fetch(userId);
  if (!canRequestTimeoff(member)) throw new Error('This member does not have a role that can request time off.');
  return member;
}
async function updateRequestNotice(request, decision, adminId) {
  if (!request.noticeMessageId) return;
  try {
    const message = await adminChannel.messages.fetch(request.noticeMessageId);
    await message.edit(timeoffRequestNotice(request, decision, adminId));
  } catch (error) {
    console.error(`Could not update time-off request message ${request.id}:`, error.message);
  }
}
async function handleAdminSubmit(interaction, action) {
  const get = id => interaction.fields.getTextInputValue(id).trim();
  let response;
  if (action === 'grant') {
    const userId = get('user');
    if (!/^\d{17,20}$/.test(userId)) throw new Error('Enter the member Discord ID, not their name or a role ID.');
    await timeoffMember(userId);
    const grant = store.grant(userId, get('start'), Number(get('days')), interaction.user.id);
    response = `Granted ${grant.days} days off to <@${userId}>: **${grant.start} through ${grant.end}**. Grant ID: ${grant.id}.`;
  } else if (action === 'approve') {
    const request = store.data.requests[get('id')];
    if (!request || request.status !== 'pending') throw new Error('Pending request not found.');
    await timeoffMember(request.userId);
    const grant = store.grant(request.userId, request.start, request.days, interaction.user.id, request.id);
    await updateRequestNotice(request, 'approved', interaction.user.id);
    response = `Approved request ${request.id}: **${grant.start} through ${grant.end}**. Grant ID: ${grant.id}.`;
  } else if (action === 'reject') {
    const request = store.data.requests[get('id')];
    store.reject(get('id'), interaction.user.id);
    await updateRequestNotice(request, 'rejected', interaction.user.id);
    response = 'Request rejected. The member can see this with /timeoff-status.';
  } else if (action === 'revoke') {
    store.revoke(get('id'), interaction.user.id);
    response = 'Days off revoked. Daily checks apply again unless another approved period covers the member.';
  } else throw new Error('Unknown admin action.');
  await interaction.editReply(brandedMessage('Time off updated', `${response}\n\nNickname changes apply on the next check. Previously sent reminders cannot be withdrawn.`));
  schedule();
}

async function handleTimeoffReview(interaction) {
  const [, action, requestId] = interaction.customId.split(':');
  if (!['approve', 'reject'].includes(action)) throw new Error('Unknown review action.');
  if (interaction.channelId !== ADMIN_CHANNEL_ID || interaction.message.author.id !== client.user.id) {
    throw new Error('This review button is not from the configured admin channel.');
  }
  const request = store.data.requests[requestId];
  if (!request || request.status !== 'pending') throw new Error('This request has already been reviewed or no longer exists.');
  await timeoffMember(request.userId);
  if (action === 'approve') store.grant(request.userId, request.start, request.days, interaction.user.id, request.id);
  else store.reject(request.id, interaction.user.id);
  await interaction.message.edit(timeoffRequestNotice(request, action === 'approve' ? 'approved' : 'rejected', interaction.user.id));
  await interaction.editReply(brandedMessage(`Request ${action === 'approve' ? 'approved' : 'rejected'}`,
    `<@${request.userId}> has been ${action === 'approve' ? 'excused for the requested dates' : 'kept on the donation requirement'}.`));
  schedule();
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(DONATION_CHANNEL_ID);
    adminChannel = await guild.channels.fetch(ADMIN_CHANNEL_ID);
    if (channel?.type !== ChannelType.GuildText) throw new Error('Donation channel must be a normal text channel in this server.');
    if (adminChannel?.type !== ChannelType.GuildText) throw new Error('Admin channel 1532826033089151184 must be a normal text channel in this server.');
    for (const roleId of TIMEOFF_ROLE_IDS) {
      if (!await guild.roles.fetch(roleId)) throw new Error(`Configured time-off role ${roleId} was not found in this server.`);
    }
    const me = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    for (const permission of ['ViewChannel', 'ReadMessageHistory', 'AddReactions', 'SendMessages', 'AttachFiles', 'EmbedLinks']) {
      if (!permissions?.has(PermissionFlagsBits[permission])) throw new Error(`Missing donation channel permission: ${permission}`);
    }
    const adminPermissions = adminChannel.permissionsFor(me);
    for (const permission of ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'AttachFiles']) {
      if (!adminPermissions?.has(PermissionFlagsBits[permission])) throw new Error(`Missing admin channel permission: ${permission}`);
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
  const isButton = interaction.isButton() && ['admin:', 'timeoff-page:', 'report-page:', 'timeoff-review:'].some(prefix => interaction.customId.startsWith(prefix));
  const isModal = interaction.isModalSubmit() && interaction.customId.startsWith('admin-submit:');
  if (!isCommand && !isButton && !isModal) return;
  try {
    if (!automation || interaction.guildId !== GUILD_ID) throw new Error('Bot is starting or this is not the configured server.');
    checkAccess(interaction, GUILD_ID);
    if (isButton && interaction.customId.startsWith('admin:')
        && interaction.customId !== 'admin:list' && !interaction.customId.startsWith('admin:page:')) {
      const action = interaction.customId.split(':')[1];
      if (!['grant', 'approve', 'reject', 'revoke'].includes(action)) throw new Error('Unknown action.');
      await interaction.showModal(modal(action, today()));
      return;
    }
    const isReview = isButton && interaction.customId.startsWith('timeoff-review:');
    if (isReview) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    else if (isButton) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await serialize(async () => {
      if (isReview) return handleTimeoffReview(interaction);
      const page = isButton ? Number(interaction.customId.split(':').at(-1)) || 0 : 0;
      if (isModal) return handleAdminSubmit(interaction, interaction.customId.split(':')[1]);
      if (interaction.commandName === 'donation-admin') {
        return interaction.editReply(panel(store, automation, today(), timezone));
      }
      if (isButton && (interaction.customId === 'admin:list' || interaction.customId.startsWith('admin:page:'))) {
        return interaction.editReply(adminTimeoffView(store, today(), timezone, page));
      }
      if (interaction.commandName === 'timeoff') {
        await timeoffMember(interaction.user.id);
        const start = interaction.options.getString('start');
        const days = interaction.options.getInteger('days');
        dateRange(start, days);
        if (start < today()) throw new Error('Requests must start today or later. Ask an admin for a retroactive exemption.');
        const request = store.request(interaction.user.id, start, days, interaction.options.getString('reason') || '');
        try {
          const notice = await adminChannel.send(timeoffRequestNotice(request));
          request.noticeMessageId = notice.id;
          store.save();
        } catch (error) {
          console.error(`Could not notify admins about request ${request.id}:`, error.message);
          return interaction.editReply(brandedMessage('Time-off request saved',
            `Request **${request.id}** was saved, but I could not post it in <#${ADMIN_CHANNEL_ID}>. An admin can still review it in \`/donation-admin\`.`));
        }
        return interaction.editReply(brandedMessage('Time-off request submitted',
          'Your request is waiting for an administrator. You are excused only after approval.\nUse `/timeoff-status` to check for updates.', {
            fields: [
              { name: 'Dates', value: `${request.start} through ${request.end}` },
              { name: 'Days off', value: String(days), inline: true },
              { name: 'Request ID', value: request.id, inline: true },
            ],
          }));
      }
      if (interaction.commandName === 'timeoff-status' || (isButton && interaction.customId.startsWith('timeoff-page:'))) {
        return interaction.editReply(timeoffView(store, today(), timezone, interaction.user.id, page));
      }
      const day = isButton ? interaction.customId.split(':')[1] : interaction.options.getString('date') || today();
      if (!validDay(day) || day > today() || day < '2015-01-01') throw new Error('Use a real YYYY-MM-DD date from 2015 through today.');
      const report = await automation.report(day);
      return interaction.editReply(donationView(report, day, today(), timezone, page));
    });
  } catch (error) {
    console.error('Interaction failed:', error.message);
    const payload = brandedMessage('Unable to complete this action', String(error.message).slice(0, 1900));
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ ...payload, attachments: [], components: [] });
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
