// Zen Staff: a `file` input of a workflow form. "Choose a file" copies the file into
// `<work folder>/inputs/` on the machine that runs the task (zen.office.uploadInputFile) and fills
// in its path; a path to a file already in the folder can still be typed.
import type { EnvironmentId } from "@t3tools/contracts";
import { ZEN_INPUT_FILE_MAX_BYTES } from "@t3tools/contracts/zenOffice";
import { LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAtomCommand } from "../../state/use-atom-command";
import { useZenText } from "../i18n/zenI18n";
import { officeChatText } from "./officeChat.i18n";
import { uploadOfficeInputFile } from "./officeState";
import { fileToBase64 } from "./officeWorkflowTools";

export interface WorkflowUploadTarget {
  readonly environmentId: EnvironmentId;
  /** The work folder (the project's workspace root). */
  readonly cwd: string;
}

export function WorkflowFileInput(props: {
  readonly id: string;
  readonly value: string;
  readonly placeholder?: string | undefined;
  readonly onChange: (value: string) => void;
  readonly upload: WorkflowUploadTarget | undefined;
}) {
  const t = useZenText(officeChatText);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<
    | { readonly kind: "idle" }
    | { readonly kind: "busy" }
    | { readonly kind: "note"; readonly text: string; readonly error: boolean }
  >({ kind: "idle" });
  const upload = useAtomCommand(uploadOfficeInputFile, {
    label: t.chooseFile,
    reportFailure: false,
  });
  const choose = async (file: File | undefined) => {
    if (!file || !props.upload) return;
    if (file.size > ZEN_INPUT_FILE_MAX_BYTES) {
      setState({ kind: "note", text: t.fileTooLarge, error: true });
      return;
    }
    setState({ kind: "busy" });
    const result = await upload({
      environmentId: props.upload.environmentId,
      input: { cwd: props.upload.cwd, fileName: file.name, dataBase64: await fileToBase64(file) },
    });
    if (result._tag !== "Success") {
      setState({ kind: "note", text: t.fileUploadFailed, error: true });
      return;
    }
    props.onChange(result.value.relativePath);
    setState({ kind: "note", text: t.fileCopied(result.value.relativePath), error: false });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!props.upload || state.kind === "busy"}
          onClick={() => fileRef.current?.click()}
          data-zen-file-input={props.id}
        >
          {state.kind === "busy" ? (
            <LoaderCircleIcon aria-hidden className="animate-spin" />
          ) : (
            <UploadIcon aria-hidden />
          )}
          {state.kind === "busy" ? t.uploadingFile : t.chooseFile}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Input
          id={props.id}
          className="min-w-0 flex-1"
          value={props.value}
          aria-label={t.orTypePath}
          placeholder={props.placeholder ?? t.orTypePath}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </div>
      {!props.upload ? (
        <p className="text-muted-foreground text-xs">{t.chooseFolderFirst}</p>
      ) : state.kind === "note" ? (
        <p
          role={state.error ? "alert" : "status"}
          className={
            state.error ? "text-destructive-foreground text-xs" : "text-muted-foreground text-xs"
          }
        >
          {state.text}
        </p>
      ) : null}
    </div>
  );
}
