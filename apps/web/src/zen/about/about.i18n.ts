// Zen Staff: Settings > About, the phone app row. Zen Staff has no phone app in the stores yet
// (upstream's links pointed at the T3 Code apps), so the row says it is coming.
import { defineZenMessages } from "../i18n/zenI18n";

const en = {
  mobileDescription: "The Zen Staff app for phones and tablets is on its way.",
  mobileSoon: "Coming soon",
};

const ro: { readonly [K in keyof typeof en]: (typeof en)[K] } = {
  mobileDescription: "Aplicația Zen Staff pentru telefon și tabletă e pe drum.",
  mobileSoon: "În curând",
};

export const aboutText = defineZenMessages({ en, ro });
