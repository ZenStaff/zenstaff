// Zen Staff chat integrations: one adapter and one install manifest per platform.
import type { ZenChatPlatform } from "@t3tools/contracts/zenChat";

import { createEmailAdapter, emailManifest } from "../email/emailAdapter.ts";
import { createDiscordAdapter, discordManifest } from "./discord.ts";
import { createGoogleChatAdapter, googleChatManifest } from "./googleChat.ts";
import { createSlackAdapter, slackManifest } from "./slack.ts";
import { createTeamsAdapter, teamsManifest } from "./teams.ts";
import { createTelegramAdapter, telegramManifest } from "./telegram.ts";
import type { AdapterFactory, ManifestBuilder } from "./types.ts";
import { createWhatsAppAdapter, whatsAppManifest } from "./whatsapp.ts";

export const ADAPTERS: Readonly<Record<ZenChatPlatform, AdapterFactory>> = {
  slack: createSlackAdapter,
  teams: createTeamsAdapter,
  discord: createDiscordAdapter,
  telegram: createTelegramAdapter,
  googlechat: createGoogleChatAdapter,
  whatsapp: createWhatsAppAdapter,
  email: createEmailAdapter,
};

export const MANIFESTS: Readonly<Record<ZenChatPlatform, ManifestBuilder>> = {
  slack: slackManifest,
  teams: teamsManifest,
  discord: discordManifest,
  telegram: telegramManifest,
  googlechat: googleChatManifest,
  whatsapp: whatsAppManifest,
  email: emailManifest,
};
