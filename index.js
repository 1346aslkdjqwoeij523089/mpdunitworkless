const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, REST, Routes, SlashCommandBuilder, SlashCommandStringOption, SlashCommandUserOption } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = client.user ? client.user.id : process.env.CLIENT_ID; // Set CLIENT_ID env if needed
const LOG_CHANNEL_ID = '1498899829844082798';
const BOD_ROLE_IDS = ['1478060223200493750', '1497249386919628840', '1478062056543359037', '1497570951465009235'];
const DATA_DIR = './data';
const MODLOGS_FILE = path.join(DATA_DIR, 'modlogs.json');

let modlogs = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    // ok
  }
}

async function loadModlogs() {
  await ensureDataDir();
  try {
    const data = await fs.readFile(MODLOGS_FILE, 'utf8');
    modlogs = JSON.parse(data);
  } catch {
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
  if (isNaN(n)) return null;
  switch (unit.toLowerCase()) {
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

async function addModlog(guild, type, targetId, modId, reason = 'No reason', duration = null) {
  if (!modlogs[targetId]) modlogs[targetId] = [];
  const logEntry = {
    type,
    modId,
    reason,
    timestamp: new Date().toISOString(),
    duration,
  };
  modlogs[targetId].push(logEntry);
  await saveModlogs();

  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setTitle(`${type.toUpperCase()} Log`)
    .setColor(type === 'warn' ? 0xFFFF00 : type === 'mute' ? 0xFFA500 : 0xFF0000)
    .addFields(
      { name: 'Moderator', value: `<@${modId}>`, inline: true },
      { name: 'Target', value: `<@${targetId}>`, inline: true },
      { name: 'Action', value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Duration', value: duration ? `${Math.round(duration / 60000)}m` : 'N/A', inline: true },
      { name: 'Time', value: new Date().toLocaleString(), inline: true },
    )
    .setTimestamp()
    .setFooter({ text: `Entry ID: ${modlogs[targetId].length}` });

  logChannel.send({ embeds: [embed] }).catch(console.error);
}

const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('reason').setDescription('Reason for warn')),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('User to mute').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('duration').setDescription('Duration e.g. 10m, 1h, 1d').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('reason').setDescription('Reason')),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('reason').setDescription('Reason')),
  new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription('View modlogs for a user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('User (optional, defaults to you)')),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Say a message as bot')
    .addStringOption(new SlashCommandStringOption().setName('content').setDescription('Message').setRequired(true)),
].map(command => command.toJSON());

client.once('ready', async () => {
  await loadModlogs();

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Started refreshing slash cmds.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Slash cmds registered globally (1h propagation).');
  } catch (err) {
    console.error(err);
  }

  client.user.setPresence({
    activities: [{ name: 'Metropolitan Police Department', type: 3 }], // Watching
    status: 'online',
  });
  console.log(`Logged as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  if (!BOD_ROLE_IDS.some(id => member.roles.cache.has(id))) {
    return interaction.reply({ content: '❌ Not authorized (need BoD+ role).', ephemeral: true });
  }

  const modId = interaction.user.id;
  await interaction.deferReply({ ephemeral: true });

  const command = interaction.commandName;
  let targetId, target;

  switch (command) {
    case 'warn':
      target = interaction.options.getUser('user');
      targetId = target.id;
      if (targetId === modId) return interaction.editReply('Cannot warn self.');
      target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target) return interaction.editReply('Invalid user.');
      const wReason = interaction.options.getString('reason') || 'No reason';
      await addModlog(interaction.guild, 'warn', targetId, modId, wReason);
      interaction.editReply(`✅ Warned ${target}`);
      break;
    case 'mute':
      target = interaction.options.getUser('user');
      targetId = target.id;
      if (targetId === modId) return interaction.editReply('Cannot mute self.');
      const durStr = interaction.options.getString('duration');
      const durMs = parseDuration(durStr);
      if (!durMs) return interaction.editReply('Invalid duration: use 10m, 1h, 1d.');
      const mReason = interaction.options.getString('reason') || `Muted for ${durStr}`;
      target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target) return interaction.editReply('Invalid user.');
      if (target.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.editReply('Cannot mute admins.');
      await target.timeout(durMs, mReason);
      await addModlog(interaction.guild, 'mute', targetId, modId, mReason, durMs);
      interaction.editReply(`✅ Muted ${target} for ~${Math.round(durMs/60000)}min`);
      break;
    case 'ban':
      target = interaction.options.getUser('user');
      targetId = target.id;
      if (targetId === modId) return interaction.editReply('Cannot ban self.');
      const bReason = interaction.options.getString('reason') || 'No reason';
      target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target) return interaction.editReply('Invalid user.');
      await interaction.guild.members.ban(targetId, { reason: bReason });
      await addModlog(interaction.guild, 'ban', targetId, modId, bReason);
      interaction.editReply(`✅ Banned ${target}`);
      break;
    case 'modlogs':
      const logsUser = interaction.options.getUser('user') || interaction.user;
      const logsId = logsUser.id;
      const history = modlogs[logsId] || [];
      const embed = new EmbedBuilder()
        .setTitle(`📋 Modlogs: ${logsUser.username}`)
        .setColor(0x0099FF)
        .setDescription(history.length ? 
          history.slice(-10).reverse().map(l => 
            `**${new Date(l.timestamp).toLocaleString()}** \`${l.type.toUpperCase()}\` by <@${l.modId}> \`${l.reason}\`${l.duration ? ` (**${Math.round(l.duration/60000)}m**)` : ''}`
          ).join('\n') : 
          'No modlogs found.'
        );
      interaction.editReply({ embeds: [embed], ephemeral: true });
      break;
    case 'say':
      const content = interaction.options.getString('content');
      await interaction.deleteReply();
      await interaction.channel.send(content);
      break;
    default:
      interaction.editReply('Unknown command.');
  }
});

process.on('SIGINT', async () => {
  await saveModlogs();
  process.exit(0);
});

client.login(TOKEN);

