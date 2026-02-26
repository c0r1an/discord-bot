import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const cmd = new SlashCommandBuilder()
  .setName("teamkill")
  .setDescription("Teamkill.club Tools")

  .addSubcommand(sc =>
    sc.setName("create")
      .setDescription("Erstellt eine neue Teamkill-Liste")
      .addStringOption(o =>
        o.setName("name")
          .setDescription("Listenname")
          .setRequired(false)
      )
  )

  .addSubcommand(sc =>
    sc.setName("link")
      .setDescription("Postet Live-Stand (optional mit Counting)")
      .addStringOption(o =>
        o.setName("slug")
          .setDescription("Listen-Slug (z.B. y7o6y1afq1)")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("count_token")
          .setDescription("Optional: Count-Token (64 hex) für +1/-1 Buttons")
          .setRequired(false)
      )
  )

  .addSubcommand(sc =>
    sc.setName("unlink")
      .setDescription("Entfernt den Live-Link in diesem Channel (falls vorhanden)")
  );

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function run() {
  const body = [cmd.toJSON()];
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body }
  );
  console.log("✅ Commands registered");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});