const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, REST, Routes, SlashCommandBuilder, SlashCommandStringOption, SlashCommandUserOption } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
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
  } catch {}
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
  if (!logChannel) return console.log('Log channel missing');

  const embed = new EmbedBuilder()
    .setTitle(`${type.toUpperCase()} | MPD Log`)
    .setColor(type === 'warn' ? 0xFFFF00 : type === 'mute' ? 0xFFA500 : 0xFF0000)
    .addFields(
      { name: 'Mod', value: `<@${modId}>`, inline: true },
      { name: 'Target', value: `<@${targetId}>`, inline: true },
      { name: 'Reason', value: reason },
      { name: 'Duration', value: duration ? `${Math.round(duration / 60000)}m` : 'N/A', inline: true },
      { name: 'Time', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: `Records: ${modlogs[targetId].length}` });

  logChannel.send({ embeds: [embed] }).catch(console.error);
}

const commands = [
  new SlashCommandBuilder().setName('warn').setDescription('Warn user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('Target').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('mute').setDescription('Timeout user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('Target').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('duration').setDescription('10m 1h 1d').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban user')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('Target').setRequired(true))
    .addStringOption(new SlashCommandStringOption().setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('modlogs').setDescription('View logs')
    .addUserOption(new SlashCommandUserOption().setName('user').setDescription('Target, optional self')),
  new SlashCommandBuilder().setName('say').setDescription('Bot says msg')
    .addStringOption(new SlashCommandStringOption().setName('content').setDescription('Text').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
  await loadModlogs();
  console.log('Loading slash...');

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
      console.log('Guild cmds registered.');
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log('Global cmds (1h).');
    }
  } catch (err) {
    console.error('Cmd reg fail:', err);
  }

  await client.user.setPresence({ activities: [{ name: 'Metropolitan Police Department', type: 3 }], status: 'online' });
  console.log(`${client.user.tag} ready!`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) {
    return interaction instanceof Object ? interaction.reply({ content: 'Guild cmd only.', ephemeral: true }) : null;
  }

  const member = interaction.member;
  console.log(`Auth check for ${interaction.user.tag}: roles ${member.roles.cache.map(r => r.id).join(',')}`);

  if (!BOD_ROLE_IDS.some(roleId => member.roles.cache.has(roleId))) {
    const userRoles = member.roles.cache.map(r => `<@&${r.id}> (${r.name})`).slice(0, 10).join(', ') || 'none';
    return interaction.reply({
      content: `❌ Unauthorized.\nYour roles: ${userRoles}\nNeed one of: ${BOD_ROLE_IDS.map(id => `<@&${id}>`).join(', ')}`,
      ephemeral: true
    });
  }

  const modId = interaction.user.id;
  await interaction.deferReply({ ephemeral: true });

  try {
    const command = interaction.commandName;
    let targetId, targetMember;

    switch (command) {
      case 'warn':
        targetId = interaction.options.getUser('user').id;
        if (targetId === modId) return interaction.editReply('No self-warn.');
        targetMember = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) return interaction.editReply('Invalid target.');
        const wReason = interaction.options.getString('reason') || 'No reason';
        await addModlog(interaction.guild, 'warn', targetId, modId, wReason);
        interaction.editReply(`✅ Warned <@${targetId}> (${targetMember.displayName})`);
        break;
      case 'mute':
        targetId = interaction.options.getUser('user').id;
        if (targetId === modId) return interaction.editReply('No self-mute.');
        const durStr = interaction.options.getString('duration');
        const durMs = parseDuration(durStr);
        if (!durMs) return interaction.editReply('Duration: e.g. `10m`, `1h`, `1d`. Max 28d.');
        const mReason = interaction.options.getString('reason') || `Timeout ${durStr}`;
        targetMember = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) return interaction.editReply('Invalid target.');
        if (targetMember.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.editReply('Cannot mute admins.');
        await targetMember.timeout(durMs > 2419200000 ? 2419200000 : durMs, mReason); // Max 28d
        await addModlog(interaction.guild, 'mute', targetId, modId, mReason, durMs);
        interaction.editReply(`✅ Muted <@${targetId}> for ${Math.round(durMs/60000)}min`);
        break;
      case 'ban':
        targetId = interaction.options.getUser('user').id;
        if (targetId === modId) return interaction.editReply('No self-ban.');
        const bReason = interaction.options.getString('reason') || 'No reason';
        targetMember = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) return interaction.editReply('Invalid target.');
        await interaction.guild.members.ban(targetId, { reason: bReason });
        await addModlog(interaction.guild, 'ban', targetId, modId, bReason);
        interaction.editReply(`✅ Banned <@${targetId}> (${targetMember.displayName})`);
        break;
      case 'modlogs':
        const logUser = interaction.options.getUser('user') || interaction.user;
        const logId = logUser.id;
        const history = (modlogs[logId] || []).slice(-15);
        const desc = history.length ? 
          history.reverse().map((l, i) => 
            `**<t:${Math.floor(new Date(l.timestamp).getTime()/1000)}:R>** \`${l.type.toUpperCase()}\` <@${l.modId}> | ${l.reason}${l.duration ? ` | ${Math.round(l.duration/60000)}m` : ''}`
          ).join('\\n') :
          '*Clean record.*';
        const embed = new EmbedBuilder()
          .setTitle(`Modlogs • ${logUser.tag}`)
          .setThumbnail(logUser.displayAvatarURL())
          .setColor('#00b0ff')
          .setDescription(desc)
          .setFooter({ text: `${history.length} entries` });
        interaction.editReply({ embeds: [embed] });
        break;
      case 'say':
        const contentSay = interaction.options.getString('content');
        await interaction.deleteReply();
        await interaction.channel.send(contentSay).catch(() => interaction.followUp({ content: 'Say failed (perms?).', ephemeral: true }));
        break;
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Error: \`${err.message}\``).catch(() => {});
  }
});

process.on('SIGINT', async () => await saveModlogs(), process.exit(0) );

client.login(TOKEN).catch(console.error);

