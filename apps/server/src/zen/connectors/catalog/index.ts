// Zen Staff: the shipped connector catalog. JSON imports are bundled, so packaged builds carry it
// (the hub will serve newer copies: ZEN_CONNECTORS_CATALOG_URL). One file per app; see ZEN.md.
import apify from "./apify.json" with { type: "json" };
import efacturaAnaf from "./efactura-anaf.json" with { type: "json" };
import elevenlabs from "./elevenlabs.json" with { type: "json" };
import gmail from "./gmail.json" with { type: "json" };
import googleBusinessProfile from "./google-business-profile.json" with { type: "json" };
import googleCalendar from "./google-calendar.json" with { type: "json" };
import googleDrive from "./google-drive.json" with { type: "json" };
import horecaos from "./horecaos.json" with { type: "json" };
import hubspot from "./hubspot.json" with { type: "json" };
import metaPages from "./meta-pages.json" with { type: "json" };
import microsoftTeams from "./microsoft-teams.json" with { type: "json" };
import notion from "./notion.json" with { type: "json" };
import oblio from "./oblio.json" with { type: "json" };
import onedriveSharepoint from "./onedrive-sharepoint.json" with { type: "json" };
import outlook from "./outlook.json" with { type: "json" };
import pipedrive from "./pipedrive.json" with { type: "json" };
import saga from "./saga.json" with { type: "json" };
import shopify from "./shopify.json" with { type: "json" };
import slack from "./slack.json" with { type: "json" };
import smartbill from "./smartbill.json" with { type: "json" };
import stripe from "./stripe.json" with { type: "json" };
import trello from "./trello.json" with { type: "json" };
import woocommerce from "./woocommerce.json" with { type: "json" };
import zapier from "./zapier.json" with { type: "json" };

export const BUILTIN_CONNECTOR_FILES: ReadonlyArray<unknown> = [
  apify,
  efacturaAnaf,
  elevenlabs,
  gmail,
  googleBusinessProfile,
  googleCalendar,
  googleDrive,
  horecaos,
  hubspot,
  metaPages,
  microsoftTeams,
  notion,
  oblio,
  onedriveSharepoint,
  outlook,
  pipedrive,
  saga,
  shopify,
  slack,
  smartbill,
  stripe,
  trello,
  woocommerce,
  zapier,
];
