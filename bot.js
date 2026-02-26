// bot.js
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import fetch from "node-fetch";
import { loadLinks, saveLinks } from "./storage.js";

/**
 * ENV
 * DISCORD_TOKEN=...
 * API_BASE=https://teamkill.club
 */
const API_BASE = process.env.API_BASE || "https://teamkill.club";

// ===============================
// Persisted live links
// ===============================
// { guildId, channelId, messageId, slug, countToken?, lastHash }
let liveLinks = [];

// key: `${messageId}:${userId}` => personId
const selectedPersonByMessageAndUser = new Map();

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, opts);
  const txt = await res.text();
  let data = null;
  try {
    data = JSON.parse(txt);
  } catch {}
  if (!res.ok) throw data || { error: txt || "error", status: res.status };
  return data;
}

// ===============================
// Token validation (IMPORTANT)
// ===============================
async function resolveCountToken(token) {
  if (!token) return null;
  try {
    const r = await api("/api/resolve_count_token.php?token=" + encodeURIComponent(token));
    // erwartet: { slug: "..." }
    if (r && r.slug) return String(r.slug);
    return null;
  } catch {
    return null;
  }
}

async function validateCountTokenForSlug(countToken, slug) {
  if (!countToken) return { ok: false, reason: "missing" };
  const resolvedSlug = await resolveCountToken(countToken);
  if (!resolvedSlug) return { ok: false, reason: "invalid" };
  if (slug && resolvedSlug !== slug) return { ok: false, reason: "mismatch", resolvedSlug };
  return { ok: true, resolvedSlug };
}

// ===============================
// UI Builders
// ===============================
function buildLeaderboardEmbed(data) {
  const people = Array.isArray(data?.people) ? data.people : [];
  const sorted = [...people].sort(
    (a, b) => (Number(b.count) - Number(a.count)) || String(a.name).localeCompare(String(b.name))
  );
  const topScore = sorted.length ? Number(sorted[0].count) : null;

  const lines = sorted.map((p) => {
    const isTop = topScore !== null && Number(p.count) === topScore;
    const crown = isTop ? "👑 " : "";
    return `${crown}**${p.name}** — ${p.count}`;
  });

  return {
    title: data?.list?.name || "Teamkill.club",
    description: lines.length ? lines.join("\n") : "Noch keine Einträge.",
    color: 0x8b5cf6,
    footer: { text: "Live via teamkill.club" },
    timestamp: new Date().toISOString(),
  };
}

function buildComponents(data, messageId, hasCounting) {
  const people = [...(data.people || [])].slice(0, 25);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`tk_select:${messageId}`)
    .setPlaceholder("Spieler auswählen…")
    .addOptions(
      people.length
        ? people.map((p) => ({
            label: (p.name || "Spieler").slice(0, 80),
            value: String(p.id),
            description: `Aktuell: ${p.count}`,
          }))
        : [{ label: "Keine Spieler", value: "0", description: "Bitte erst Spieler anlegen", default: true }]
    );

  const row1 = new ActionRowBuilder().addComponents(select);

  const btnPlus = new ButtonBuilder()
    .setCustomId(`tk_plus:${messageId}`)
    .setLabel("+1")
    .setStyle(ButtonStyle.Success)
    .setDisabled(!hasCounting);

  const btnMinus = new ButtonBuilder()
    .setCustomId(`tk_minus:${messageId}`)
    .setLabel("-1")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasCounting);

  const row2 = new ActionRowBuilder().addComponents(btnPlus, btnMinus);

  return [row1, row2];
}

function isAdminAllowed(member) {
  const perms = member?.permissions;
  if (!perms?.has) return false;
  return (
    perms.has(PermissionsBitField.Flags.Administrator) ||
    perms.has(PermissionsBitField.Flags.ManageGuild)
  );
}

async function upsertPersist() {
  await saveLinks(liveLinks);
}

function findByChannel(guildId, channelId) {
  return liveLinks.find((x) => x.guildId === guildId && x.channelId === channelId);
}

function findByMessage(messageId) {
  return liveLinks.find((x) => x.messageId === messageId);
}

async function safeFetchTextChannel(channelId) {
  const ch = await client.channels.fetch(channelId);
  if (!ch || typeof ch.isTextBased !== "function" || !ch.isTextBased()) return null;
  return ch;
}

// ===============================
// Discord Client
// ===============================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  liveLinks = await loadLinks();
  console.log(`🔁 Restored links: ${liveLinks.length}`);

  // Cleanup malformed
  liveLinks = liveLinks.filter((x) => x?.guildId && x?.channelId && x?.messageId && x?.slug);
  await upsertPersist();
});

// ===============================
// Interactions
// ===============================
client.on("interactionCreate", async (interaction) => {
  try {
    // ---------------------------
    // Slash Commands
    // ---------------------------
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "teamkill") return;

      const sub = interaction.options.getSubcommand();

      // Admin-only for link/unlink
      if ((sub === "link" || sub === "unlink") && !isAdminAllowed(interaction.member)) {
        return interaction.reply({
          content: "❌ Dafür brauchst du Manage Server / Admin Rechte.",
          ephemeral: true,
        });
      }

      // /teamkill create [name]
      if (sub === "create") {
        const name = interaction.options.getString("name") || "Unsere Teamkill-Liste";
        await interaction.deferReply({ ephemeral: true });

        const created = await api("/api/owner_create.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        const slug = created?.slug;
        const ownerToken = created?.owner_token;

        let countUrl = created?.links?.count || null;
        let countToken = null;

        // robust: count token aus link extrahieren oder via owner_settings holen
        if (countUrl) {
          const m = String(countUrl).match(/\/c\/([a-f0-9]{64})/i);
          if (m) countToken = m[1];
        }
        if (!countToken && ownerToken) {
          const s = await api("/api/owner_settings.php", {
            method: "GET",
            headers: { "X-Owner-Token": ownerToken },
          });
          if (s?.count_token) {
            countToken = s.count_token;
            countUrl = `${API_BASE}/c/${s.count_token}`;
          }
        }

        const viewUrl = slug ? `${API_BASE}/l/${slug}` : "(unknown)";
        const ownerUrl = ownerToken ? `${API_BASE}/o/${ownerToken}` : "(unknown)";
        if (!countUrl) countUrl = "(unknown)";

        return interaction.editReply({
          content:
            `✅ Liste erstellt: **${name}**\n\n` +
            `👀 View: ${viewUrl}\n` +
            `🎯 Count: ${countUrl}\n` +
            `🛡️ Owner (nur für dich): ${ownerUrl}\n\n` +
            `➡️ Live posten:\n` +
            `\`/teamkill link slug:${slug}${countToken ? ` count_token:${countToken}` : ""}\``,
        });
      }

      // /teamkill link <slug> [count_token]
      if (sub === "link") {
        const slug = interaction.options.getString("slug", true);
        const countTokenInput = interaction.options.getString("count_token", false) || null;

        await interaction.deferReply({ ephemeral: true });

        // One per channel: replace existing
        const existing = findByChannel(interaction.guildId, interaction.channelId);
        if (existing) {
          try {
            const ch = await safeFetchTextChannel(existing.channelId);
            if (ch) {
              const m = await ch.messages.fetch(existing.messageId);
              await m.delete().catch(() => {});
            }
          } catch {}
          liveLinks = liveLinks.filter(
            (x) => !(x.guildId === interaction.guildId && x.channelId === interaction.channelId)
          );
          await upsertPersist();
        }

        // Fetch list
        let data;
        try {
          data = await api("/api/list_get.php?slug=" + encodeURIComponent(slug));
          if (!data?.list) throw new Error("not found");
        } catch {
          return interaction.editReply("❌ Liste nicht gefunden oder API nicht erreichbar.");
        }

        // Validate count token STRICTLY
        let hasCounting = false;
        let countToken = null;
        let tokenInfo = "";
        if (countTokenInput) {
          const v = await validateCountTokenForSlug(countTokenInput, slug);
          if (v.ok) {
            hasCounting = true;
            countToken = countTokenInput;
            tokenInfo = "Buttons aktiv ✅ (count_token gültig)";
          } else if (v.reason === "mismatch") {
            tokenInfo = `⚠️ count_token passt nicht zum slug (gehört zu ${v.resolvedSlug}). Buttons aus.`;
          } else {
            tokenInfo = "⚠️ count_token ungültig. Buttons aus.";
          }
        } else {
          tokenInfo = "ℹ️ Kein count_token angegeben → read-only.";
        }

        // Post public message
        const publicMsg = await interaction.channel.send({
          embeds: [buildLeaderboardEmbed(data)],
          components: hasCounting ? buildComponents(data, "PENDING", true) : [],
        });

        if (hasCounting) {
          await publicMsg.edit({ components: buildComponents(data, publicMsg.id, true) });
        }

        liveLinks.push({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: publicMsg.id,
          slug,
          countToken, // only stored if valid
          lastHash: JSON.stringify(data.people || []),
        });
        await upsertPersist();

        return interaction.editReply(`✅ Verbunden! Live-Post erstellt.\nSlug: **${slug}**\n${tokenInfo}`);
      }

      // /teamkill unlink
      if (sub === "unlink") {
        await interaction.deferReply({ ephemeral: true });

        const existing = findByChannel(interaction.guildId, interaction.channelId);
        if (!existing) return interaction.editReply("ℹ️ In diesem Channel ist kein Live-Post verbunden.");

        try {
          const ch = await safeFetchTextChannel(existing.channelId);
          if (ch) {
            const m = await ch.messages.fetch(existing.messageId);
            await m.delete().catch(() => {});
          }
        } catch {}

        liveLinks = liveLinks.filter(
          (x) => !(x.guildId === interaction.guildId && x.channelId === interaction.channelId)
        );
        await upsertPersist();

        return interaction.editReply("✅ Verbindung entfernt.");
      }

      return;
    }

    // ---------------------------
    // Select Menu: choose person
    // ---------------------------
    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith("tk_select:")) return;

      const messageId = interaction.customId.split(":")[1];
      const personId = interaction.values?.[0];

      if (!personId || personId === "0") {
        return interaction.reply({ content: "ℹ️ Keine gültige Auswahl.", ephemeral: true });
      }

      selectedPersonByMessageAndUser.set(`${messageId}:${interaction.user.id}`, personId);

      return interaction.reply({
        content: `✅ Auswahl gespeichert. Jetzt +1 / -1 drücken.`,
        ephemeral: true,
      });
    }

    // ---------------------------
    // Buttons: +1 / -1
    // ---------------------------
    if (interaction.isButton()) {
      const [action, messageId] = interaction.customId.split(":");
      if (!(action === "tk_plus" || action === "tk_minus")) return;

      const link = findByMessage(messageId);
      if (!link) return interaction.reply({ content: "❌ Live-Link nicht gefunden.", ephemeral: true });

      // HARD RULE: counting only with count_token
      if (!link.countToken) {
        return interaction.reply({
          content: "⚠️ Counting ist deaktiviert (kein gültiger count_token beim /teamkill link).",
          ephemeral: true,
        });
      }

      // Extra safety: token still belongs to this slug?
      const v = await validateCountTokenForSlug(link.countToken, link.slug);
      if (!v.ok) {
        // disable in storage and inform
        link.countToken = null;
        await upsertPersist();
        return interaction.reply({
          content: "❌ count_token ist nicht mehr gültig → Counting wurde deaktiviert.",
          ephemeral: true,
        });
      }

      const selected = selectedPersonByMessageAndUser.get(`${messageId}:${interaction.user.id}`);
      if (!selected) {
        return interaction.reply({ content: "ℹ️ Bitte erst Spieler auswählen (Dropdown).", ephemeral: true });
      }

      const delta = action === "tk_plus" ? 1 : -1;

      await interaction.deferReply({ ephemeral: true });

      try {
        const res = await api("/api/delta_post.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Count-Token": link.countToken,
          },
          body: JSON.stringify({
            slug: link.slug,
            person_id: Number(selected),
            delta,
          }),
        });

        return interaction.editReply(`✅ ${delta > 0 ? "+1" : "-1"} gesetzt. Neuer Stand: **${res.count}**`);
      } catch (e) {
        return interaction.editReply(`❌ Fehler: ${e?.error || e?.message || "unbekannt"}`);
      }
    }
  } catch (e) {
    try {
      const msg = `❌ Fehler: ${e?.error || e?.message || "unknown"}`;
      if (interaction?.deferred || interaction?.replied) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch {}
    console.error("interactionCreate error:", e);
  }
});

// ===============================
// Polling loop: update live posts
// ===============================
setInterval(async () => {
  if (!client.isReady()) return;

  let changed = false;

  for (const entry of [...liveLinks]) {
    try {
      const data = await api("/api/list_get.php?slug=" + encodeURIComponent(entry.slug));
      const newHash = JSON.stringify(data.people || []);
      if (newHash === entry.lastHash) continue;

      entry.lastHash = newHash;
      changed = true;

      // If token exists, ensure still valid (optional but safer)
      let hasCounting = false;
      if (entry.countToken) {
        const v = await validateCountTokenForSlug(entry.countToken, entry.slug);
        hasCounting = v.ok;
        if (!hasCounting) {
          entry.countToken = null; // disable counting
        }
      }

      const embed = buildLeaderboardEmbed(data);

      const channel = await safeFetchTextChannel(entry.channelId);
      if (!channel) throw new Error("Missing Access or not a text channel");

      const message = await channel.messages.fetch(entry.messageId);

      await message.edit({
        embeds: [embed],
        components: hasCounting ? buildComponents(data, message.id, true) : [],
      });
    } catch (err) {
      const msg = String(err?.message || "");
      const shouldRemove =
        msg.includes("Unknown Message") ||
        msg.includes("Missing Access") ||
        msg.includes("Unknown Channel") ||
        msg.includes("Unknown Guild");

      console.error("Live update error:", err?.message || err);

      if (shouldRemove) {
        liveLinks = liveLinks.filter((x) => x !== entry);
        changed = true;
      }
    }
  }

  if (changed) {
    try {
      await upsertPersist();
    } catch (e) {
      console.error("saveLinks error:", e?.message || e);
    }
  }
}, 5000);

// ===============================
// Login y7o6y1afq1
// ===============================
client.login(process.env.DISCORD_TOKEN);