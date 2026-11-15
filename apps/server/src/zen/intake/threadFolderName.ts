// Zen Staff: the words of a Scratch thread's folder name (`<date>-<words>-<id>`) for
// ManagedProjectFolders.folderForThread: diacritics folded ("Postări" was "post-ri"), a link counts
// as its site name (was "https-www-reddit-com-r"), a workflow message is named by its title.
import { splitWorkflowMessage } from "@t3tools/contracts/zenOffice";

const MAX_WORDS = 5;
const MAX_LENGTH = 48;

/** The plain-words part of a thread folder name, or "" when the text has none. */
export function zenThreadFolderWords(text: string): string {
  const split = splitWorkflowMessage(text);
  const source = split
    ? split.summary
        .split("\n")
        .map((line) => line.replace(/^[^:?]{1,80}[:?]\s+/, "").trim())
        .filter((line, index) => index === 0 || line.length > 0)
        .slice(0, 3)
        .join(" ")
    : text.slice(0, 2_000);
  return source
    .replace(/\[zen-[a-z-]+:[^\]]*\]/g, " ")
    .replace(/\bhttps?:\/\/(?:www\.)?([^\s/?#]+)[^\s]*/gi, (_, host: string) =>
      host.split(".").slice(0, -1).join(" "),
    )
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .join("-")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, "");
}
