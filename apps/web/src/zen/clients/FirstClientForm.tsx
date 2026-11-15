// Zen Staff: "Adaugă primul client" / "Adaugă un client": a local company plus its brand profile
// saved through the onboarding model (`brand.setLogo`, `profile.save`: answers, company-profile.md,
// memory folder). "Spune-mi despre client" creates it by name and opens the interview chat instead.
// ZEN.md, "First client".
import type { EnvironmentId } from "@t3tools/contracts";
import { ONBOARDING_TONES, type OnboardingTone } from "@t3tools/contracts/zenCompanies";
import { RegistryContext } from "@effect/atom-react";
import { ImageUpIcon, MessageCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { useContext, useState } from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { cn } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { dominantColors } from "../approvals/approvalsModel";
import { companiesListAtom, companyCreate } from "../companies/companiesState";
import { zenErrorMessage } from "../i18n/serverText";
import { useZenLocale, useZenText } from "../i18n/zenI18n";
import { onboardingText } from "../onboarding/onboarding.i18n";
import { fileToBase64, useOnboardingCall } from "../onboarding/onboardingClient";
import { clientsText } from "./clients.i18n";

const LOGO_MAX = 2 * 1024 * 1024;

/** Reads up to three brand colors from the logo (a 64 px copy on a canvas). */
function colorsFromImage(dataUrl: string): Promise<Array<string>> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (context === null) return resolve([]);
      context.drawImage(image, 0, 0, size, size);
      resolve(dominantColors(context.getImageData(0, 0, size, size).data, 3));
    };
    image.onerror = () => resolve([]);
    image.src = dataUrl;
  });
}

export interface SavedClient {
  readonly id: string;
  readonly name: string;
}

export function FirstClientForm(props: {
  readonly environmentId: EnvironmentId;
  /** First run or "another client" from the switcher. */
  readonly first: boolean;
  readonly onSaved: (client: SavedClient) => void;
  /** "Spune-mi despre client": the company exists (name only); open its interview chat. */
  readonly onTellMe: (client: SavedClient) => void;
  readonly onBack?: () => void;
}) {
  const t = useZenText(clientsText);
  const tones = useZenText(onboardingText).tones;
  const locale = useZenLocale();
  const registry = useContext(RegistryContext);
  const create = useAtomCommand(companyCreate, { reportFailure: false });
  const onboarding = useOnboardingCall(props.environmentId);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<{ readonly dataUrl: string; readonly base64: string } | null>(
    null,
  );
  const [colors, setColors] = useState<ReadonlyArray<string>>([]);
  const [fromLogo, setFromLogo] = useState(false);
  const [picked, setPicked] = useState<ReadonlyArray<OnboardingTone>>([]);
  const [toneNotes, setToneNotes] = useState("");
  const [rules, setRules] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseLogo = async (file: File | undefined) => {
    if (file === undefined) return;
    if (file.size > LOGO_MAX) {
      setError(t.logoTooBig);
      return;
    }
    setError(null);
    const base64 = await fileToBase64(file);
    const dataUrl = `data:${file.type || "image/png"};base64,${base64}`;
    setLogo({ dataUrl, base64 });
    const found = await colorsFromImage(dataUrl);
    if (found.length > 0 && (colors.length === 0 || fromLogo)) {
      setColors(found);
      setFromLogo(true);
    }
  };

  const createCompany = async (color: string | undefined): Promise<SavedClient> => {
    const created = await create({
      environmentId: props.environmentId,
      input: { name: name.trim(), ...(color === undefined ? {} : { color }) },
    });
    if (created._tag === "Failure") throw new Error(zenErrorMessage(created.cause, t.tryAgain));
    registry.refresh(companiesListAtom(props.environmentId));
    return { id: created.value.id, name: created.value.name };
  };

  const saveProfile = async (client: SavedClient) => {
    let logoName: string | undefined;
    if (logo !== null) {
      const saved = await onboarding<{ name: string }>("brand.setLogo", {
        companyId: client.id,
        base64: logo.base64,
      });
      logoName = saved.name;
    }
    await onboarding("profile.save", {
      companyId: client.id,
      locale,
      answers: {
        companyName: client.name,
        ...(website.trim() === "" ? {} : { website: website.trim() }),
        ...(picked.length === 0 ? {} : { tones: picked }),
        ...(toneNotes.trim() === "" ? {} : { toneNotes: toneNotes.trim() }),
        ...(rules.trim() === "" ? {} : { rules: rules.trim() }),
        ...(colors.length === 0 ? {} : { brandColors: colors }),
        ...(logoName === undefined ? {} : { logo: logoName }),
      },
    });
    // The profile is filled: the interview does not pop up for this client.
    await onboarding("dismissFirstRun", { companyId: client.id });
  };

  const save = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    // Promise chain, not try/finally: the React Compiler skips components with a finally.
    await createCompany(colors[0])
      .then(async (client) => {
        await saveProfile(client);
        props.onSaved(client);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t.tryAgain));
    setBusy(false);
  };

  const tellMe = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    await createCompany(colors[0])
      .then((client) => props.onTellMe(client))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t.tryAgain));
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4" data-zen-first-client>
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">
          {props.first ? t.firstClientTitle : t.anotherClientTitle}
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">{t.firstClientIntro}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t.name}</span>
          <Input
            value={name}
            maxLength={80}
            placeholder={t.namePlaceholder}
            onChange={(event) => setName(event.currentTarget.value)}
            data-zen-client-name
          />
        </label>
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t.logo}</span>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 hover:bg-accent/50">
            {logo === null ? (
              <ImageUpIcon className="size-4 text-muted-foreground" aria-hidden />
            ) : (
              <img src={logo.dataUrl} alt={t.logo} className="size-6 rounded object-contain" />
            )}
            <span>{logo === null ? t.chooseLogo : t.changeLogo}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={(event) => void chooseLogo(event.currentTarget.files?.[0])}
              data-zen-client-logo
            />
          </label>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t.colors}</span>
        <div className="flex flex-wrap items-center gap-2" data-zen-client-colors>
          {colors.map((color, index) => (
            <span
              key={`color-slot-${String(index)}-${color}`}
              className="flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-0.5"
            >
              <input
                type="color"
                value={color}
                aria-label={t.colors}
                className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
                onChange={(event) => {
                  const next = event.currentTarget.value.toUpperCase();
                  setFromLogo(false);
                  setColors((current) => current.map((item, at) => (at === index ? next : item)));
                }}
              />
              <span className="font-mono text-xs" data-zen-no-translate>
                {color}
              </span>
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={t.removeColor(color)}
                onClick={() => setColors((current) => current.filter((_, at) => at !== index))}
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {colors.length < 5 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setFromLogo(false);
                setColors((current) => [...current, "#2F6F5E"]);
              }}
            >
              <PlusIcon className="size-3.5" />
              {t.addColor}
            </Button>
          ) : null}
        </div>
        {fromLogo && colors.length > 0 ? (
          <span className="text-muted-foreground text-xs">{t.colorsFromLogo}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t.tone}</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.tone}>
          {ONBOARDING_TONES.map((tone) => {
            const on = picked.includes(tone);
            return (
              <button
                key={tone}
                type="button"
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent/50",
                  on && "border-primary bg-primary/10 text-foreground",
                )}
                onClick={() =>
                  setPicked((current) =>
                    on ? current.filter((item) => item !== tone) : [...current, tone].slice(-4),
                  )
                }
                data-zen-client-tone={tone}
              >
                {tones[tone]}
              </button>
            );
          })}
        </div>
        <Input
          value={toneNotes}
          maxLength={1000}
          aria-label={t.toneNotes}
          placeholder={t.toneNotesPlaceholder}
          onChange={(event) => setToneNotes(event.currentTarget.value)}
        />
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t.rules}</span>
        <Textarea
          value={rules}
          rows={2}
          maxLength={3000}
          placeholder={t.rulesPlaceholder}
          onChange={(event) => setRules(event.currentTarget.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t.website}</span>
        <Input
          value={website}
          maxLength={300}
          inputMode="url"
          placeholder={t.websitePlaceholder}
          onChange={(event) => setWebsite(event.currentTarget.value)}
        />
      </label>
      {error !== null ? (
        <Alert variant="error">
          <AlertDescription>
            {t.failed}: {error}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {props.onBack ? (
          <Button variant="ghost" onClick={props.onBack}>
            {t.back}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            disabled={busy || name.trim() === ""}
            title={t.tellMeHint}
            onClick={() => void tellMe()}
            data-zen-client-tell-me
          >
            <MessageCircleIcon className="size-4" />
            {t.tellMe}
          </Button>
          <Button
            disabled={busy || name.trim() === ""}
            onClick={() => void save()}
            data-zen-client-save
          >
            {busy ? t.saving : t.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
