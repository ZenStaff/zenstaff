// Zen Staff: Romanian for upstream toasts an Office person can meet (chat, composer, sidebar,
// files, preview). Toasts render in a portal under document.body, where the Office rewriter runs.
// Exact strings and patterns, English as upstream writes them -> Romanian. ZEN.md, "Languages".

export const UPSTREAM_TOAST_RO: Readonly<Record<string, string>> = {
  "Agent session will restart": "Sesiunea asistentului va reporni",
  "Your next message starts a fresh session.": "Următorul mesaj pornește o sesiune nouă.",
  "Attach dropped files again or remove them before stashing":
    "Atașează din nou fișierele sau scoate-le înainte să pui mesajul deoparte",
  "Branch copied": "Ramura a fost copiată",
  "Brought back": "Readusă",
  "Browser storage is unavailable, so this stash is kept in memory only for this session.":
    "Browserul nu permite salvarea, așa că mesajul pus deoparte rămâne doar până închizi.",
  "Browser storage rejected the delete, so this prompt could reappear after a reload.":
    "Browserul a refuzat ștergerea, așa că mesajul poate reapărea după reîncărcare.",
  "Browser storage rejected the update, so this entry could still be there after a reload.":
    "Browserul a refuzat schimbarea, așa că intrarea poate fi încă acolo după reîncărcare.",
  "Browser storage rejected the write, so the composer was left as-is. Free up site data and try again.":
    "Browserul a refuzat salvarea, așa că mesajul a rămas cum era. Eliberează spațiu și încearcă din nou.",
  "Click the citation to try again.": "Apasă pe citat ca să încerci din nou.",
  "Could not bring back the side chat": "Nu am putut readuce conversația laterală",
  "Could not copy file": "Nu am putut copia fișierul",
  "Could not copy the request": "Nu am putut copia cererea",
  "Could not copy thread ID": "Nu am putut copia codul sarcinii",
  "Could not delete the side chat": "Nu am putut șterge conversația laterală",
  "Could not disconnect agent session": "Nu am putut deconecta sesiunea asistentului",
  "Could not force stop the agent": "Nu am putut opri forțat asistentul",
  "Could not load saved model preferences. Try again.":
    "Nu am putut încărca preferințele de model. Încearcă din nou.",
  "Could not merge back": "Nu am putut aduce înapoi",
  "Could not open the cited response": "Nu am putut deschide răspunsul citat",
  "Could not open this address": "Nu am putut deschide această adresă",
  "Could not read file": "Nu am putut citi fișierul",
  "Could not save file": "Nu am putut salva fișierul",
  "Could not snooze thread": "Nu am putut amâna sarcina",
  "Could not stash this prompt": "Nu am putut pune mesajul deoparte",
  "Could not stop subagent": "Nu am putut opri ajutorul asistentului",
  "Could not stop workflow": "Nu am putut opri fluxul de lucru",
  "Could not update annotation voice input": "Nu am putut actualiza dictarea pentru notițe",
  "Enter a workspace path": "Scrie calea unui dosar",
  "Failed to copy mention": "Nu am putut copia mențiunea",
  "Failed to rename thread": "Nu am putut redenumi sarcina",
  "Favorites not saved": "Favoritele nu s-au salvat",
  "Folders can only be referenced on a server running on this computer":
    "Poți face trimitere la dosare doar pe un server care rulează pe acest calculator",
  "It will be back in the composer once the question is answered.":
    "Va reveni în caseta de mesaj după ce răspunzi la întrebare.",
  "Keep attachments on this machine": "Păstrează atașamentele pe acest calculator",
  "Loading thread context…": "Încarc contextul sarcinii…",
  "Mention copied": "Mențiunea a fost copiată",
  "Model preferences not saved": "Preferințele de model nu s-au salvat",
  "Not connected: message not sent": "Fără conexiune: mesajul nu s-a trimis",
  "Oldest stashed prompt discarded": "Cel mai vechi mesaj pus deoparte a fost șters",
  "Open a chat for this project and try again.":
    "Deschide o conversație în acest dosar și încearcă din nou.",
  "Page unavailable": "Pagină indisponibilă",
  "Pasted text is too large for this message": "Textul lipit e prea mare pentru acest mesaj",
  "Pasted text is too large to attach": "Textul lipit e prea mare ca să-l atașez",
  "Path copied": "Calea a fost copiată",
  "Plan saved to workspace": "Planul a fost salvat în dosar",
  "Project created": "Dosarul a fost creat",
  "Reconnect to the environment and try again.":
    "Reconectează-te la calculator și încearcă din nou.",
  "Reconnecting to the environment. Try again once it is connected.":
    "Mă reconectez la calculator. Încearcă din nou după ce se conectează.",
  "Reduce the clipboard contents or save a smaller excerpt as a file.":
    "Copiază mai puțin text sau salvează o bucată mai mică într-un fișier.",
  "Remove some text or an attachment, then paste again.":
    "Scoate o parte din text sau un atașament, apoi lipește din nou.",
  "Request copied": "Cererea a fost copiată",
  "Restore this prompt in the environment that received its files.":
    "Readu acest mesaj pe calculatorul care i-a primit fișierele.",
  "Restored prompt may reappear in the stash":
    "Mesajul readus poate reapărea printre cele puse deoparte",
  "Send again once its chip resolves.": "Trimite din nou după ce se încarcă elementul.",
  "Send again once its thumbnail appears.": "Trimite din nou după ce apare miniatura.",
  "Send again when it's ready.": "Trimite din nou când e gata.",
  "Send it to your workspace admin.": "Trimite-o administratorului.",
  "Setting not saved": "Setarea nu s-a salvat",
  "Showing the source response. The saved quote is unchanged.":
    "Arăt răspunsul original. Citatul salvat nu s-a schimbat.",
  "Some attachments were not restored": "Unele atașamente nu au fost readuse",
  "Stash again once its chip resolves.": "Pune deoparte din nou după ce se încarcă elementul.",
  "Stash entry may come back": "Mesajul pus deoparte poate reveni",
  "Stashed files belong to another environment": "Fișierele puse deoparte țin de alt calculator",
  "Stashed images did not attach": "Imaginile puse deoparte nu s-au atașat",
  "Stashed images were not saved": "Imaginile puse deoparte nu s-au salvat",
  "Stashed prompt will not survive a reload": "Mesajul pus deoparte se pierde la reîncărcare",
  "Still bringing attached context into this message.": "Încă aduc în mesaj ce ai atașat.",
  "Still compressing a pasted image.": "Încă micșorez o imagine lipită.",
  "The chat isn't ready to accept input right now.": "Conversația nu poate primi mesaje acum.",
  "The composer is busy; try again once it is ready.":
    "Caseta de mesaj e ocupată; încearcă din nou când e gata.",
  "The main thread gets this side chat with your next message there.":
    "Sarcina principală primește această conversație laterală cu următorul tău mesaj de acolo.",
  "The prompt was stashed, but browser storage rejected its images. They will be missing if you reload.":
    "Mesajul a fost pus deoparte, dar browserul nu i-a salvat imaginile. Vor lipsi dacă reîncarci.",
  "The quoted text has changed": "Textul citat s-a schimbat",
  "The reset time has passed. Retry the thread manually.":
    "Ora resetării a trecut. Reia sarcina de mână.",
  "This connection cannot change one or more selected threads.":
    "Această conexiune nu poate schimba una sau mai multe dintre sarcinile alese.",
  "This question cannot accept attachments.": "Această întrebare nu primește atașamente.",
  "This thread is no longer available": "Această sarcină nu mai e disponibilă",
  "Thread ID copied": "Codul sarcinii a fost copiat",
  "Thread action unavailable": "Acțiune indisponibilă",
  "Thread search is unavailable on this server.":
    "Căutarea în sarcini nu e disponibilă pe acest server.",
  "Thread title cannot be empty": "Titlul sarcinii nu poate fi gol",
  "Turn stopped; the agent is still shutting down": "Lucrul s-a oprit; asistentul încă se închide",
  "Turn stopped; the agent process kept running":
    "Lucrul s-a oprit; programul asistentului a rămas pornit",
  "Type the folder path with @ instead.": "Scrie în schimb calea dosarului cu @.",
  "Unable to add folder": "Nu am putut adăuga dosarul",
  "Unable to add thread": "Nu am putut adăuga sarcina",
  "Unable to add to chat": "Nu am putut adăuga în conversație",
  "Unable to capture screenshot": "Nu am putut face captura de ecran",
  "Unable to change the browser tab": "Nu am putut schimba fila",
  "Unable to move the browser tab": "Nu am putut muta fila",
  "Unable to open browser": "Nu am putut deschide browserul",
  "Unable to read the dropped thread": "Nu am putut citi sarcina trasă aici",
  "Unable to start recording": "Nu am putut porni înregistrarea",
  "Unable to stop recording": "Nu am putut opri înregistrarea",
  "Unable to update popped-out preview": "Nu am putut actualiza fereastra separată",
  "Update the server to enable it.": "Actualizează serverul ca s-o pornești.",
  "Usage limits are unavailable for this provider":
    "Limitele de consum nu sunt disponibile pentru acest asistent",
  "Wait for file uploads before stashing this prompt":
    "Așteaptă să se încarce fișierele înainte să pui mesajul deoparte",
  "Wait for the file to finish loading before copying.":
    "Așteaptă să se încarce fișierul înainte să-l copiezi.",
  "Your typed text was set aside": "Textul scris a fost pus deoparte",
  "Starting triage…": "Pornesc analiza…",
  // Common shapes shared by many upstream error toasts.
  "Something went wrong": "Ceva n-a mers",
  "An unexpected error occurred.": "A apărut o eroare neașteptată.",
  "Failed to send message": "Mesajul nu s-a trimis",
  "Failed to stop": "Nu am putut opri",
};

/** Toasts with values in them; `$1`... are the captured groups. */
export const UPSTREAM_TOAST_PATTERNS_RO: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly ro: string;
}> = [
  { pattern: /^(.+) copied$/, ro: "Am copiat: $1" },
  { pattern: /^Large paste attached as (.+)$/, ro: "Textul lung a fost atașat ca $1" },
  { pattern: /^Couldn't bring (.+) into this message$/, ro: "Nu am putut aduce $1 în acest mesaj" },
  { pattern: /^Couldn't get the path of "(.+)"$/, ro: "Nu am putut afla calea pentru „$1”" },
  { pattern: /^Deleted action "(.+)"$/, ro: "Am șters acțiunea „$1”" },
  {
    pattern: /^(.+) Remove the chip or attach the file again\.$/,
    ro: "$1 Scoate elementul sau atașează din nou fișierul.",
  },
  {
    pattern: /^The stash holds (\d+) prompts; the oldest was removed to make room\.$/,
    ro: "Pot pune deoparte cel mult $1 mesaje; l-am șters pe cel mai vechi.",
  },
  {
    pattern: /^This connection lacks permission to change settings on (.+)\.$/,
    ro: "Această conexiune nu are voie să schimbe setările pe $1.",
  },
  { pattern: /^Could not save on (.+?): (.+)$/, ro: "Nu am putut salva pe $1: $2" },
];
