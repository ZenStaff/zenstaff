// Zen Staff: Romanian for upstream strings in the Code edition, read by upstreamText.ts. Code keeps
// developer words (proiect, mediu, furnizor, agent) where Office says dosar, calculator, asistent
// AI. Entries here win over the shared tables in Code; everything else falls back to them.
// ZEN.md, "Languages".

/** Exact upstream strings, Code wording. */
export const UPSTREAM_CODE_RO: Readonly<Record<string, string>> = {
  // Settings navigation (groups and pages)
  Agents: "Agenți",
  Code: "Cod",
  Providers: "Furnizori",
  Projects: "Proiecte",
  Threads: "Sarcini",
  Environments: "Medii",
  "Diffs & pull requests": "Diferențe și PR-uri",
  Diffs: "Diferențe",
  Keybindings: "Scurtături de tastatură",
  SnapShots: "Capturi de ecran",
  "Source control": "Controlul versiunilor",
  "Source Control": "Controlul versiunilor",
  Worktrees: "Worktree-uri",
  Labs: "Experimente",
  Environment: "Mediu",
  Project: "Proiect",
  Permissions: "Permisiuni",
  Runtime: "Rulare",
  "Binary path": "Calea programului",
  "Launch arguments": "Argumente de pornire",
  Workspace: "Spațiu de lucru",
  "Workspace root": "Rădăcina proiectului",
  "Current checkout": "Checkout-ul curent",
  "Use the project checkout": "În checkout-ul proiectului",
  Path: "Cale",
  Thread: "Sarcină",

  // Sidebar, palette and thread menus
  "New project": "Proiect nou",
  "Add project": "Adaugă un proiect",
  "No projects yet": "Încă nu ai proiecte",
  "No threads in these projects yet": "Încă nu sunt sarcini în aceste proiecte",
  "Pin project": "Fixează proiectul",
  "Unpin project": "Scoate fixarea proiectului",
  "Search projects": "Caută proiecte",
  "Search projects...": "Caută proiecte...",
  "No matching projects.": "Niciun proiect potrivit.",
  "Project settings": "Setările proiectului",
  "Turn into project": "Fă din ea un proiect",
  "or start without a project": "sau începe fără proiect",
  "New thread without a project": "Sarcină nouă fără proiect",
  "Search commands, projects, and threads": "Caută comenzi, proiecte și sarcini",
  "Search commands, projects, and threads...": "Caută comenzi, proiecte și sarcini...",
  "No project": "Fără proiect",
  "Local folder": "Dosar local",
  "All projects": "Toate proiectele",
  "All environments": "Toate mediile",
  "All providers": "Toți furnizorii",
  "No providers": "Niciun furnizor",
  "Project scope: All projects": "Proiect: toate proiectele",
  "Environment scope: All environments": "Mediu: toate mediile",

  // Settings: General, Projects and Threads
  "Project grouping": "Gruparea proiectelor",
  "Combine matching repositories across environments.":
    "Arată o singură dată același depozit din mai multe medii.",
  "Project order": "Ordinea proiectelor",
  "Order of projects in the sidebar project picker and command palette.":
    "Ordinea proiectelor în bara laterală și în paleta de comenzi.",
  "Choose a project to manage its name, icon, checkouts and actions.":
    "Alege un proiect ca să-i gestionezi numele, pictograma, checkout-urile și acțiunile.",
  "New projects": "Proiecte noi",
  "Add project starts in": "Adăugarea unui proiect pornește din",
  "Default permissions for new threads. Projects can override them.":
    "Permisiunile implicite pentru sarcinile noi. Fiecare proiect le poate schimba.",
  "Default model for new threads, selected automatically. Projects can override it.":
    "Modelul implicit pentru sarcinile noi, ales automat. Fiecare proiect îl poate schimba.",
  "Where new threads start. Projects and their t3.json can override it.":
    "Unde pornesc sarcinile noi. Proiectele și fișierul lor t3.json o pot schimba.",
  "Default runtime mode": "Modul de rulare implicit",
  "Runtime mode": "Modul de rulare",
  "Full access": "Acces complet",
  Supervised: "Cu aprobare",
  "Fallback model": "Model de rezervă",
  "Clone into host folders": "Clonează în dosare după gazdă",
  "Add provider": "Adaugă un furnizor",
  "Provider instances": "Instanțe de furnizor",
  "Project name": "Numele proiectului",
  "Archive project": "Arhivează proiectul",
  "Delete project": "Șterge proiectul",
  "Default permissions": "Permisiuni implicite",
  "No providers available": "Niciun furnizor disponibil",
  "No providers available.": "Niciun furnizor disponibil.",
  "No text generation providers available.": "Niciun furnizor pentru generarea de text.",
  "Select a project": "Alege un proiect",
  "Filter threads by project": "Filtrează sarcinile după proiect",
  "Allow agents to use the shared browser. Projects can override it.":
    "Lasă agenții să folosească browserul comun. Fiecare proiect poate schimba asta.",
  "Model preferences and custom models are saved on the selected environment and shared across connected devices.":
    "Preferințele de model și modelele proprii se salvează pe mediul ales și se folosesc pe toate dispozitivele conectate.",
  "No models reported for this provider yet.": "Acest furnizor nu a raportat încă modele.",
  "API keys, base URLs, and other per-instance CLI settings.":
    "Chei API, adrese de bază și alte setări CLI pentru fiecare instanță.",
  "Manage providers": "Gestionează furnizorii",
  "Clean up transcripts with a provider": "Corectează transcrierile cu un furnizor",
  "Names and terms transcription should spell your way, saved on this device. Add an alias when it keeps hearing a term wrong. The name of the project you dictate in is also sent as a hint.":
    "Nume și termeni pe care transcrierea să-i scrie ca tine, salvați pe acest dispozitiv. Adaugă o variantă când aude mereu greșit un termen. Numele proiectului în care dictezi se trimite și el ca indiciu.",
  "Saved on the environment and used in every project there, along with each person’s own dictionary. Pick a project above to limit these words to one project.":
    "Salvat pe mediu și folosit în toate proiectele de acolo, alături de dicționarul fiecăruia. Alege un proiect mai sus ca să limitezi cuvintele la el.",

  // Environments (Connections), Access, Scheduled tasks: environment = mediu
  "Local environment": "Mediul local",
  "Connect an environment to choose its text generation model.":
    "Conectează un mediu ca să-i alegi modelul pentru generarea de text.",
  "Auto uses the environment’s GPU when it has one.":
    "Automat folosește placa video a mediului, dacă are una.",
  "Connect an environment first.": "Conectează mai întâi un mediu.",
  "On an environment": "Pe un mediu",
  "Chosen environment (unavailable)": "Mediul ales (indisponibil)",
  "The color scheme pages are told to prefer. System follows your OS setting.":
    "Tema de culori cerută paginilor. Sistem urmează setarea sistemului de operare.",
  "Connect to an environment to import cookies": "Conectează un mediu ca să imporți cookie-uri",
  "Connect to an environment to remove this profile and its data.":
    "Conectează un mediu ca să ștergi acest profil și datele lui.",
  "No environment selected": "Niciun mediu ales",
  "Connect an environment to view its settings and access.":
    "Conectează un mediu ca să-i vezi setările și accesul.",
  "Generate a one-time link that another device can use to pair with this backend as an authorized client.":
    "Creează un link de unică folosință prin care alt dispozitiv se asociază cu acest backend ca client autorizat.",
  "Could not load linked environments": "Nu am putut încărca mediile legate",
  "Loading linked environments…": "Încarc mediile legate…",
  "No linked environments": "Niciun mediu legat",
  "Link an environment": "Leagă un mediu",
  "No saved remote environments": "Niciun mediu la distanță salvat",
  "Connect an environment to manage the secret providers its provider variables read from.":
    "Conectează un mediu ca să-i gestionezi sursele de secrete.",
  "Environment-wide setting. Select an environment to change it.":
    "Setare pentru tot mediul. Alege un mediu ca s-o schimbi.",
  "This task was deleted or belongs to a different project. Check your project filter.":
    "Sarcina a fost ștearsă sau ține de alt proiect. Verifică filtrul de proiecte.",
  "No tasks match this environment and project selection.":
    "Nicio sarcină pentru mediul și proiectul alese.",
  "Environment disconnected": "Mediu deconectat",
  "No environments available": "Niciun mediu disponibil",
  "Connect an environment to manage scheduled tasks.":
    "Conectează un mediu ca să-i gestionezi sarcinile programate.",
  "Reconnect this environment before saving.": "Reconectează mediul înainte să salvezi.",
  "Set on the environment. Show where this value comes from":
    "Setat pe mediu. Arată de unde vine valoarea",
  "Add environment": "Adaugă un mediu",
  "Add Environment": "Adaugă un mediu",
  "Click “Add environment” to pair another environment.":
    "Apasă „Adaugă un mediu” ca să asociezi alt mediu.",
  "Click “Add environment” to pair another environment, or connect one from Zen Hub.":
    "Apasă „Adaugă un mediu” ca să asociezi alt mediu sau conectează unul din Zen Hub.",
  "View environment": "Vede mediul",
  "Change environment settings": "Schimbă setările mediului",
  "Maintain environment": "Întreține mediul",
  "Inspect processes, resource use, and logs on this environment.":
    "Vezi procesele, resursele folosite și jurnalele acestui mediu.",
  "Open all environments": "Deschide toate mediile",
  "Show all environments": "Arată toate mediile",
  "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.":
    "Reia automat sarcinile întrerupte după o actualizare, o eroare sau o repornire a mașinii, pe mediile alese.",
  "Primary environment": "Mediul principal",
  "Pair another environment to this client.": "Asociază alt mediu cu acest client.",
  "Simulators and emulators installed on this environment's machine.":
    "Simulatoare și emulatoare instalate pe mașina acestui mediu.",
  "Simulators and emulators installed on each environment's own machine.":
    "Simulatoare și emulatoare instalate pe mașina fiecărui mediu.",
  "Connected or already available locally on each selected environment.":
    "Conectate sau deja disponibile local pe fiecare mediu ales.",
  "Turn off local environment?": "Oprești mediul local?",
  "Turn on local environment?": "Pornești mediul local?",
  "Run agents on this computer. Turn off to use Zen Staff only with remote environments.":
    "Rulează agenți pe acest calculator. Oprește-l ca să folosești Zen Staff doar cu medii la distanță.",
  "Turned off. Agents only run in remote environments.":
    "Oprit. Agenții rulează doar în medii la distanță.",
  "Could not link the environment": "Nu am putut lega mediul",
  "Linked environments": "Medii legate",
  "Agents here can then launch, message and wait on threads there. It appears in that environment's Connections, where it can be revoked.":
    "Agenții de aici vor putea porni sarcini acolo, le vor putea scrie și aștepta. Legătura apare la Conexiuni în celălalt mediu, de unde poate fi revocată.",
  "From that environment's Connections, or zs pair there":
    "Din Conexiuni în celălalt mediu sau cu zs pair rulat acolo",
  "This environment is available through Zen Hub.": "Acest mediu e disponibil prin Zen Hub.",
  "This environment is no longer available through Zen Hub.":
    "Acest mediu nu mai e disponibil prin Zen Hub.",
  "This environment publishes agent activity to your mobile clients.":
    "Acest mediu trimite activitatea agenților pe telefoanele tale.",
  "This environment will stop publishing agent activity.":
    "Acest mediu nu va mai trimite activitatea agenților.",
  "Zen Hub keeps webhook requests for up to 24 hours while this environment is offline.":
    "Zen Hub păstrează cererile webhook până la 24 de ore cât acest mediu e offline.",
  "Requests to an offline environment now fail. Anything already held is still delivered.":
    "Cererile către un mediu offline eșuează acum. Ce era deja păstrat se livrează în continuare.",
  "Sign in to make this environment available to your other devices through Zen Hub.":
    "Conectează-te ca acest mediu să fie disponibil pe celelalte dispozitive prin Zen Hub.",
  "This environment was removed from Zen Hub. Turn it on to link it again.":
    "Acest mediu a fost scos din Zen Hub. Pornește-l ca să-l legi din nou.",
  "Zen Hub is on, but other devices cannot reach this environment.":
    "Zen Hub e pornit, dar celelalte dispozitive nu ajung la acest mediu.",
  "This environment is available to your other devices through Zen Hub.":
    "Acest mediu e disponibil pe celelalte dispozitive prin Zen Hub.",
  "Zen Hub is out of sync. This environment is linked only to publish agent activity, so other devices cannot connect. Turn Zen Hub on to repair it.":
    "Zen Hub nu e sincronizat. Acest mediu e legat doar ca să trimită activitatea agenților, deci celelalte dispozitive nu se pot conecta. Pornește Zen Hub ca să repari.",
  "Make this environment available to your other devices through Zen Hub.":
    "Fă acest mediu disponibil pe celelalte dispozitive prin Zen Hub.",
  "This environment was removed from Zen Hub. Run `zs connect link` on the host to link it again.":
    "Acest mediu a fost scos din Zen Hub. Rulează `zs connect link` pe gazdă ca să-l legi din nou.",
  "Keep webhook requests for up to 24 hours while this environment is offline, then deliver them. Off: Zen Hub only forwards requests and stores nothing.":
    "Păstrează cererile webhook până la 24 de ore cât acest mediu e offline, apoi le livrează. Oprit: Zen Hub doar transmite cererile și nu păstrează nimic.",
  "Hold webhook requests while this environment is offline":
    "Păstrează cererile webhook cât mediul e offline",
  "Environment connected": "Mediu conectat",
  "The environment is saved and will reconnect on app startup.":
    "Mediul e salvat și se reconectează la pornirea aplicației.",
  "Open it in the client you want to pair to this environment.":
    "Deschide-l în clientul pe care vrei să-l asociezi cu acest mediu.",

  // Settings: Providers, provider wording
  Provider: "Furnizor",
  "More providers": "Mai mulți furnizori",
  "Provider default": "Implicit pentru furnizor",
  "No providers configured.": "Niciun furnizor configurat.",
  "Loading provider settings": "Încarc setările furnizorilor",
  "Provider settings are unavailable": "Setările furnizorilor nu sunt disponibile",
  "Refreshing providers": "Reverific furnizorii",
  "Failed to refresh providers": "Nu am putut reverifica furnizorii",
  "Provider instance added": "Instanța de furnizor a fost adăugată",
  "Could not add provider instance": "Nu am putut adăuga instanța de furnizor",
  "This provider instance is no longer available on this device.":
    "Această instanță de furnizor nu mai e disponibilă pe acest dispozitiv.",
  "Connect an execution environment before configuring providers.":
    "Conectează un mediu de rulare înainte să configurezi furnizorii.",
  "Reconnect this device to set up its provider, or select another device.":
    "Reconectează dispozitivul ca să-i configurezi furnizorul sau alege alt dispozitiv.",
  "Device that runs this provider.": "Dispozitivul pe care rulează acest furnizor.",
  "Shown in the provider list.": "Apare în lista de furnizori.",
  "Overridden for this project": "Schimbat pentru acest proiect",
  "Overridden for this project. Show where this value comes from":
    "Schimbat pentru acest proiect. Arată de unde vine valoarea",
  "Provider sign-in failed. Try again.": "Conectarea la furnizor a eșuat. Încearcă din nou.",

  // Toasts with Office wording
  "Enter a workspace path": "Scrie calea spațiului de lucru",
  "Open a chat for this project and try again.":
    "Deschide o conversație în acest proiect și încearcă din nou.",
  "Plan saved to workspace": "Planul a fost salvat în spațiul de lucru",
  "Project created": "Proiectul a fost creat",
  "Reconnect to the environment and try again.": "Reconectează-te la mediu și încearcă din nou.",
  "Reconnecting to the environment. Try again once it is connected.":
    "Mă reconectez la mediu. Încearcă din nou după ce se conectează.",
  "Restore this prompt in the environment that received its files.":
    "Readu acest mesaj în mediul care i-a primit fișierele.",
  "Stashed files belong to another environment": "Fișierele puse deoparte țin de alt mediu",
};

/** Code wording for upstream text with values in it. */
export const UPSTREAM_CODE_PATTERNS_RO: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly ro: string;
}> = [
  { pattern: /^No threads in (.+) yet$/, ro: "Încă nu sunt sarcini în $1" },
  { pattern: /^Environment scope: (.+)$/, ro: "Mediu: $1" },
  { pattern: /^Project scope: (.+)$/, ro: "Proiect: $1" },
  { pattern: /^Refresh (.+) provider status$/, ro: "Reverifică furnizorul $1" },
  { pattern: /^(.+) provider status$/, ro: "Starea furnizorului $1" },
  { pattern: /^Dismiss (.+) provider error$/, ro: "Ascunde eroarea furnizorului $1" },
  // Provider cards: "Select Codex", "Enable Claude" (names start with a capital).
  { pattern: /^Select ([A-Z][\w.-]*(?: \(dev\))?)$/, ro: "Alege $1" },
  { pattern: /^Enable ([A-Z][\w.-]*(?: \(dev\))?)$/, ro: "Pornește $1" },
];
