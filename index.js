const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const LOG_CHANNEL_ID = '1498899829844082798';
const BOD_IDS = ['1478060223200493750', '1497249386919628840', '1478062056543359037', '1497570951465009235'];
const DATA_DIR = './data';
const MODLOGS_FILE = path.join(DATA_DIR, 'modlogs.json');
const PREFIX = '=';

let modlogs = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.log('Data dir already exists');
  }
}

async function loadModlogs() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(MODLOGS_FILE, 'utf8');
    modlogs = JSON.parse(data);
  } catch (err) {
    modlogs = {};
  }
}

async function saveModlogs() {
  await fs.writeFile(MODLOGS_FILE, JSON.stringify(modlogs, null, 2));
}

function parseDuration(str) {
  const match = str.match(/(\\d+)([mhd])/i);
  if (!match) return null;
  const [, num, unit] = match;
  const n = parseInt(num);
  switch (unit.toLowerCase()) {
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

async function addModlog(guild, type, targetId, modId, reason = 'No reason', duration = null) {
  if (!modlogs[targetId]) modlogs[targetId] = [];
  modlogs[targetId].push({
    type,
    modId,
    reason,
    timestamp: new Date().toISOString(),
    duration,
  });
  await saveModlogs();

  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return console.log('Log channel not found');

  const embed = new EmbedBuilder()
    .setTitle(`${type.toUpperCase()} Log`)
    .setColor(type === 'warn' ? 0xFFFF00 : type === 'mute' ? 0xFFA500 : 0xFF0000)
    .addFields(
      { name: 'Moderator', value: `<@${modId}>`, inline: true },
      { name: 'Target', value: `<@${targetId}>`, inline: true },
      { name: 'Action', value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
      { name: 'Reason', value: reason },
      { name: 'Duration', value: duration ? `${duration / 60000}m` : 'N/A', inline: true },
      { name: 'Timestamp', value: new Date().toDateString(), inline: true },
    )
    .setTimestamp();

  await logChannel.send({ embeds: [embed] });
}

async function handleCommand(message) {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\\s+/);
  const command = args.shift().toLowerCase();
  const modId = message.author.id;

  if (!BOD_IDS.includes(modId)) {
    return message.reply('You are not authorized to use this command.');
  }

  const targetMention = args[0];
  let targetId;
  if (targetMention && targetMention.startsWith('<@') && targetMention.endsWith('>')) {
    targetId = targetMention.slice(2, -1).replace('!', '');
  }

  if (targetId === modId) {
    return message.reply('Cannot mod yourself.');
  }

  const target = message.guild.members.cache.get(targetId) || await message.guild.members.fetch(targetId).catch(() => null);
  if (!target && (command === 'warn' || command === 'mute' || command === 'ban')) {
    return message.reply('Invalid target.');
  }

  const reason = args.slice(1).join(' ') || 'No reason provided';

  switch (command) {
    case 'warn':
      await addModlog(message.guild, 'warn', targetId, modId, reason);
      await message.reply(`Warned <@${targetId}>`);
      break;
    case 'mute': {
      const durStr = reason.split(' ')[0];
      const durMs = parseDuration(durStr);
      const muteReason = reason.replace(durStr, '').trim() || reason;
      if (!durMs) return message.reply('Invalid duration (e.g., 10m, 1h, 1d)');
      if (!target.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await target.timeout(durMs, muteReason);
        await addModlog(message.guild, 'mute', targetId, modId, muteReason, durMs);
        await message.reply(`Muted <@${targetId}> for ${durMs / 60000}m`);
      } else {
        await message.reply('Cannot mute admins.');
      }
      break;
    }
    case 'ban': {
      await target.ban({ reason });
      await addModlog(message.guild, 'ban', targetId, modId, reason);
      await message.reply(`Banned <@${targetId}>`);
      break;
    }
    case 'say':
      await message.delete();
      await message.channel.send(reason || 'No message provided.');
      break;
    case 'modlogs':
      if (!targetId) return message.reply('Provide user ID or mention.');
      const history = modlogs[targetId] || [];
      const embed = new EmbedBuilder()
        .setTitle(`Modlogs for <@${targetId}>`)
        .setColor(0x0099FF)
        .setDescription(history.length ? history.slice(0, 10).map(l => `[${new Date(l.timestamp).toLocaleString()}] ${l.type.toUpperCase()}: ${l.reason}${l.duration ? ` (${l.duration / 60000}m)` : ''}`).join('\\n') : 'No logs.');
      await message.reply({ embeds: [embed] });
      break;
    default:
      await message.reply('Unknown command.');
  }
}

client.once('ready', async () => {
  await loadModlogs();
  client.user.setPresence({
    activities: [{ name: 'Metropolitan Police Department', type: 3 }],
    status: 'online',
  });
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', handleCommand);

process.on('SIGINT', async () => {
  await saveModlogs();
  process.exit(0);
});

client.login(TOKEN);
