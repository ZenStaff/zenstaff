// Zen Staff: Romanian for upstream strings on the screens both editions show (Usage window,
// Settings pages and their dialogs, the thread screen chrome), exact English -> Romanian, read by
// upstreamText.ts. Strings that name environments, projects or providers need edition wording:
// Office's goes in UPSTREAM_OFFICE_RO here, Code's in upstreamCodeText.ts. ZEN.md, "Languages".

/** Office wording (calculator, dosar, asistent AI) for strings new in this table. */
export const UPSTREAM_OFFICE_RO: Readonly<Record<string, string>> = {
  // The right panel's surface launcher (Office keeps Files, Browser, Side chat).
  "Open a surface": "Deschide un panou",
  Files: "Fișiere",
  "Side chat": "Discuție laterală",
  "All providers": "Toți asistenții AI",
  "No providers": "Niciun asistent AI",
  "Linked environments": "Calculatoare legate",
  "Primary environment": "Calculatorul principal",
  "Add Environment": "Adaugă un calculator",
  "Pair another environment to this client.": "Asociază alt calculator cu acest client.",
  "Project scope: All projects": "Dosar: toate dosarele",
  "Environment scope: All environments": "Calculator: toate calculatoarele",
  "Environment connected": "Calculator conectat",
  "The environment is saved and will reconnect on app startup.":
    "Calculatorul e salvat și se reconectează la pornirea aplicației.",
  "Could not link the environment": "Nu am putut lega calculatorul",
  "Turn off local environment?": "Oprești lucrul pe acest calculator?",
  "Turn on local environment?": "Pornești lucrul pe acest calculator?",
  "Run agents on this computer. Turn off to use Zen Staff only with remote environments.":
    "Asistenții lucrează pe acest calculator. Oprește ca să folosești Zen Staff doar cu alte calculatoare.",
  "Turned off. Agents only run in remote environments.":
    "Oprit. Asistenții lucrează doar pe alte calculatoare.",
  "Simulators and emulators installed on this environment's machine.":
    "Simulatoare și emulatoare instalate pe acest calculator.",
  "Click “Add environment” to pair another environment, or connect one from Zen Hub.":
    "Apasă „Adaugă un calculator” ca să asociezi alt calculator sau conectează unul din Zen Hub.",
  "This environment is available through Zen Hub.": "Acest calculator e disponibil prin Zen Hub.",
  "This environment is available to your other devices through Zen Hub.":
    "Acest calculator e disponibil pe celelalte dispozitive prin Zen Hub.",
  "Make this environment available to your other devices through Zen Hub.":
    "Fă acest calculator disponibil pe celelalte dispozitive prin Zen Hub.",
  "Zen Hub is on, but other devices cannot reach this environment.":
    "Zen Hub e pornit, dar celelalte dispozitive nu ajung la acest calculator.",
  "Hold webhook requests while this environment is offline":
    "Păstrează cererile webhook cât calculatorul e offline",
  "Open it in the client you want to pair to this environment.":
    "Deschide-l în aplicația pe care vrei s-o asociezi cu acest calculator.",
};

/** Romanian for both editions (no environment, project or provider wording in them). */
export const UPSTREAM_SCREENS_RO: Readonly<Record<string, string>> = {
  // Usage window
  Usage: "Consum",
  "Usage breadcrumb": "Navigare în consum",
  "Usage metric": "Ce măsori",
  "Usage period": "Perioada",
  "Cost (C)": "Cost (C)",
  Tokens: "Tokeni",
  "Tokens (T)": "Tokeni (T)",
  Limits: "Limite",
  "Limits (L)": "Limite (L)",
  "Refresh limits": "Reîncarcă limitele",
  "Refresh usage": "Reîncarcă consumul",
  Weekly: "Săptămânal",
  Monthly: "Lunar",
  Session: "Sesiune",
  "5-hour": "5 ore",
  "Monthly spend": "Cheltuieli lunare",
  "Monthly credit limit": "Limita lunară de credit",
  left: "rămas",
  Left: "Rămas",
  "% left": "% rămas",
  Segment: "Segment",
  "Ahead of pace: spending faster than the window elapses":
    "Peste ritm: consumi mai repede decât trece intervalul",
  "On pace with the window": "În ritm cu intervalul",
  "Under pace: headroom left for the rest of the window":
    "Sub ritm: mai ai loc pentru restul intervalului",
  "The line is where even spending would be.": "Linia arată unde ai fi la un consum uniform.",
  "Use a reset credit?": "Folosești un credit de resetare?",
  "This redeems one credit on your account and clears the current rate-limit windows. It cannot be undone.":
    "Folosește un credit din contul tău și golește intervalele de limită curente. Nu se poate anula.",
  "Use credit": "Folosește creditul",
  "Reset applied. Your windows have cleared.": "Resetarea s-a aplicat. Intervalele s-au golit.",
  "Nothing to reset right now.": "Nu e nimic de resetat acum.",
  "No reset credit left.": "Nu mai ai credite de resetare.",
  "That credit was already redeemed.": "Creditul a fost deja folosit.",
  "Could not use the reset credit.": "Nu am putut folosi creditul de resetare.",
  "No reset credits banked": "Niciun credit de resetare păstrat",
  "Using…": "Folosesc…",
  "Use reset": "Folosește resetarea",
  "Using reset credit…": "Folosesc creditul de resetare…",
  "No provider on the selected environments reports subscription limits.":
    "Niciun furnizor din mediile alese nu raportează limite de abonament.",
  "View usage in ChatGPT with your connected account.":
    "Vezi consumul în ChatGPT cu contul conectat.",
  "Manage usage": "Gestionează consumul",
  "Toggle account email visibility": "Arată sau ascunde adresa de e-mail",
  "Click to reveal email": "Apasă ca să vezi adresa de e-mail",
  "Click to hide email": "Apasă ca să ascunzi adresa de e-mail",
  Plan: "Abonament",
  Via: "Prin",
  Resets: "Se resetează",
  "Even pace": "Ritm uniform",
  Restores: "Revine",
  "resets now": "se resetează acum",
  "Resets momentarily": "Se resetează imediat",
  "ChatGPT shared usage": "Consum comun ChatGPT",
  Totals: "Totaluri",
  Breakdown: "Detaliere",
  "No activity in this window.": "Nicio activitate în această perioadă.",
  Unpriced: "Fără preț",
  Total: "Total",
  "No environments connected.": "Niciun mediu conectat.",
  "Totals are partial while selected environments scan.":
    "Totalurile sunt parțiale cât timp mediile alese se scanează.",
  "Model prices": "Prețurile modelelor",
  "Unpriced usage details": "Detalii despre consumul fără preț",
  Hourly: "Pe ore",
  Daily: "Zilnic",
  "Processed tokens": "Tokeni procesați",
  "processed tokens": "tokeni procesați",
  "Cached input": "Intrare din cache",
  "Uncached input": "Intrare fără cache",
  Output: "Ieșire",
  "Cache savings": "Economii din cache",
  "Cache read": "Citit din cache",
  "Cache write": "Scris în cache",
  "Tokens by type": "Tokeni pe tipuri",
  "Cost by type": "Cost pe tipuri",
  "Cost by speed": "Cost pe viteze",
  "Usage breakdown": "Detalierea consumului",
  "Usage breakdown by time": "Consumul în timp",
  "Daily processed tokens by provider": "Tokeni procesați zilnic, pe furnizori",
  Hour: "Ora",
  Day: "Ziua",
  sessions: "sesiuni",
  session: "sesiune",
  "Past 24h": "Ultimele 24 h",
  "7 days": "7 zile",
  "30 days": "30 de zile",
  "90 days": "90 de zile",
  "Some environments could not report usage": "Unele medii nu au putut raporta consumul",
  Unavailable: "Indisponibil",
  "Update required": "Trebuie actualizat",
  "Scanning…": "Scanez…",
  "Refreshing…": "Reîncarc…",

  // Settings sidebar and search
  "Diffs & pull requests": "Diferențe și PR-uri",
  Keybindings: "Scurtături de tastatură",
  SnapShots: "Capturi de ecran",
  "Source control": "Controlul versiunilor",
  Worktrees: "Worktree-uri",
  Labs: "Experimente",
  Devices: "Dispozitive",
  "No settings found": "Nu am găsit nicio setare",
  "Clear settings search": "Șterge căutarea în setări",
  "Settings search results": "Rezultatele căutării în setări",
  Settings: "Setări",

  // Settings: General and About
  "Up to Date": "La zi",
  "zs command": "Comanda zs",
  "Run Zen Staff's CLI as `zs` from any terminal.":
    "Pornește linia de comandă Zen Staff cu `zs` din orice terminal.",
  "Could not install zs": "Nu am putut instala comanda zs",
  "Could not remove zs": "Nu am putut șterge comanda zs",
  "Something went wrong.": "Ceva n-a mers.",
  Install: "Instalează",
  "App Store": "App Store",
  "Google Play": "Google Play",
  "Search licenses": "Caută licențe",
  "Search open-source licenses": "Caută licențe open source",
  "Open-source notices are unavailable": "Notificările open source nu sunt disponibile",
  "Try again": "Încearcă din nou",
  "No licenses match that search.": "Nicio licență nu se potrivește căutării.",
  "Loading open-source notices…": "Încarc notificările open source…",
  "The license manifest could not load.": "Lista de licențe nu s-a putut încărca.",
  "The license manifest took too long to load.": "Lista de licențe s-a încărcat prea greu.",
  "Project source": "Codul sursă al proiectului",
  "Third-party notices": "Notificări pentru terți",
  "Fonts for titles and captions": "Fonturi pentru titluri și subtitrări",
  "Web page tools (Playwright)": "Unelte pentru pagini web (Playwright)",

  // Settings: Appearance
  "Colors & themes": "Culori și teme",
  "Color scheme": "Schemă de culori",
  "Appearance mode": "Modul de afișare",
  "Follow the system appearance": "Urmează aspectul sistemului",
  System: "Sistem",
  "Use light mode": "Folosește modul luminos",
  Light: "Luminos",
  "Use dark mode": "Folosește modul întunecat",
  Dark: "Întunecat",
  Themes: "Teme",
  "Create theme": "Creează o temă",
  "Add theme": "Adaugă o temă",
  Interface: "Interfață",
  Contrast: "Contrast",
  "Adjust the contrast of colors and borders across the interface.":
    "Reglează contrastul culorilor și al marginilor în toată interfața.",
  "Glass opacity": "Opacitatea sticlei",
  "Higher values make menus, dialogs, and the composer more solid.":
    "Valorile mai mari fac meniurile, ferestrele și caseta de mesaj mai opace.",
  "Chat width": "Lățimea conversației",
  "Set how wide messages and the composer can grow on large screens.":
    "Cât de late pot fi mesajele și caseta de mesaj pe ecranele mari.",
  Comfortable: "Confortabil",
  "Thread details": "Detaliile sarcinii",
  "Choose what the thread details card shows. You can also right-click the card.":
    "Alege ce arată cardul cu detaliile sarcinii. Poți da și clic dreapta pe card.",
  of: "din",
  "Effort display": "Afișarea efortului",
  "Show reasoning effort in the composer as its name, such as High, or as bars.":
    "Arată efortul de gândire în caseta de mesaj ca nume (de ex. High) sau ca bare.",
  Word: "Cuvânt",
  "Render math": "Afișează formulele matematice",
  "Typeset LaTeX math, such as $x^2$ or \\[x^2\\], in messages and Markdown previews. The composer keeps TeX source editable.":
    "Afișează formulele LaTeX, ca $x^2$ sau \\[x^2\\], în mesaje și în previzualizările Markdown. În caseta de mesaj sursa TeX rămâne editabilă.",
  Advanced: "Avansat",
  Typography: "Tipografie",
  "Interface font": "Fontul interfeței",
  "Everything outside code blocks and the terminal.": "Tot ce nu e bloc de cod sau terminal.",
  "Interface font family": "Familia fontului interfeței",
  "Interface font size": "Mărimea fontului interfeței",
  "Prompt font preview": "Previzualizarea fontului pentru mesaje",
  "Monospace font": "Font monospațiat",
  "Code blocks, diffs, file previews, and the terminal.":
    "Blocuri de cod, diferențe, previzualizări de fișiere și terminalul.",
  "Monospace font family": "Familia fontului monospațiat",
  "Code font size": "Mărimea fontului pentru cod",
  "Terminal font preview": "Previzualizarea fontului din terminal",
  "Terminal input": "Intrare în terminal",
  "Terminal scrollback": "Istoricul terminalului",
  "Word wrap": "Rânduri împărțite",
  "Wrap long lines in code blocks, diffs, and file previews by default.":
    "Împarte implicit rândurile lungi în blocuri de cod, diferențe și previzualizări.",
  "Wrap code, diffs, and file previews by default":
    "Împarte implicit rândurile în cod, diferențe și previzualizări",
  "Code font": "Fontul pentru cod",
  "Prompt font": "Fontul pentru mesaje",
  "Terminal font": "Fontul terminalului",
  "Separate fonts": "Fonturi separate",
  "Font smoothing": "Netezirea fonturilor",
  "Panel animations": "Animațiile panourilor",

  // Settings: Chat
  "Follow-ups": "Mesaje în timpul lucrului",
  "Composer context": "Contextul casetei de mesaj",
  "Quit shortcut": "Scurtătura de închidere",

  // Settings: Diffs & pull requests
  "Diff layout": "Așezarea diferențelor",
  "Show diffs stacked or side by side. The toggle in the diff toolbar changes this too.":
    "Arată diferențele una sub alta sau alăturat. Se poate schimba și din bara diferențelor.",
  Stacked: "Una sub alta",
  "Side by side": "Alăturat",
  "Hide whitespace changes": "Ascunde modificările de spații",
  "Set whether the diff panel ignores whitespace-only edits by default.":
    "Dacă panoul de diferențe ignoră implicit modificările doar de spații.",
  "Hide whitespace changes by default": "Ascunde implicit modificările de spații",
  "Default diff file state": "Starea implicită a fișierelor",
  "Start with files expanded or collapsed when opening diffs or a pull request's Code tab.":
    "Fișierele pornesc deschise sau strânse când deschizi diferențele sau tabul Cod al unui PR.",
  "Diff colors": "Culorile diferențelor",
  "Choose colors for additions and deletions, including change counts.":
    "Alege culorile pentru adăugări și ștergeri, inclusiv la numărul de modificări.",
  "Red & green": "Roșu și verde",
  "Open pull requests and changes panels proactively":
    "Deschide singur panourile de PR-uri și modificări",
  "Open linked pull requests first. Otherwise, open Changes for edits to at least 3 files or 50 lines.":
    "Deschide întâi PR-urile legate. Altfel, deschide Modificări când s-au schimbat cel puțin 3 fișiere sau 50 de rânduri.",
  "Open pull requests in Zen Staff": "Deschide PR-urile în Zen Staff",
  "Clicking a pull request link opens it in Zen Staff. Turn off to open pull request links like any other link, on your git host.":
    "Un link către un PR se deschide în Zen Staff. Oprește ca să se deschidă ca orice link, pe serverul git.",
  "Pull requests": "Pull requesturi",
  Expanded: "Deschise",
  Collapsed: "Strânse",

  // Settings: Keybindings (page chrome; command names stay as they are)
  "The browser may claim some shortcuts first. The desktop app receives them all.":
    "Browserul poate prelua unele scurtături înaintea aplicației. Aplicația desktop le primește pe toate.",
  "Search keybindings": "Caută scurtături",
  "Add keybinding": "Adaugă o scurtătură",
  "Open keybindings.json": "Deschide keybindings.json",
  Navigation: "Navigare",
  Always: "Mereu",
  Other: "Altele",
  "Preview & diff": "Previzualizare și diferențe",

  // Settings: SnapShots
  "Capture a window and attach it to your current draft.":
    "Capturează o fereastră și atașeaz-o la mesajul pe care îl scrii.",
  "Enable snapshots": "Pornește capturile de ecran",
  "Capture animations": "Animații la captură",
  "Capture flash": "Bliț la captură",
  "Capture shortcut": "Scurtătura pentru captură",
  "Capture sound": "Sunet la captură",
  "Include app text": "Include textul aplicației",

  // Settings: Providers
  "Add hub": "Adaugă un hub",
  "No hubs configured.": "Niciun hub configurat.",
  "Decrease provider health check interval": "Micșorează intervalul de verificare",
  "Provider health check interval in seconds": "Intervalul de verificare, în secunde",
  "Increase provider health check interval": "Mărește intervalul de verificare",
  seconds: "secunde",
  "Compact idle threads": "Compactează sarcinile inactive",
  "When to compact an idle Claude thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Each Claude provider can override this.":
    "Când se compactează o sarcină Claude inactivă de peste 200.000 de tokeni: după ce revii, chiar înainte să expire cache-ul sau niciodată. Fiecare furnizor Claude poate schimba asta.",
  "Custom Codex home and config directory.": "Dosarul propriu pentru Codex și configurarea lui.",
  "Shadow home path": "Calea dosarului separat",
  "Account-specific Codex home. Keeps auth.json separate while sharing state from CODEX_HOME.":
    "Dosar Codex pentru acest cont. Ține auth.json separat și folosește restul din CODEX_HOME.",
  "Additional CLI arguments passed to codex app-server on session start.":
    "Argumente CLI în plus, date lui codex app-server la pornirea sesiunii.",

  // Settings: Threads
  'Leave empty to use "~/" when the Add Project browser opens.':
    "Lasă gol ca să pornească din „~/” la adăugarea unui proiect.",
  "Add project base directory": "Dosarul de pornire la adăugarea unui proiect",
  "Clones go to github.com/owner/repo under the folder above, like ghq.":
    "Clonele merg în github.com/owner/repo sub dosarul de mai sus, ca la ghq.",
  hour: "oră",
  hours: "ore",
  at: "la",
  "This evening": "Diseară",
  Tomorrow: "Mâine",
  "Same time as an option above": "Aceeași oră ca o variantă de mai sus",
  "Auto-settle merged threads": "Închide automat sarcinile cu PR îmbinat",
  "Settle a thread when its pull request merges. Closed pull requests still settle automatically.":
    "Marchează sarcina terminată când PR-ul ei se îmbină. PR-urile închise o marchează oricum.",
  "Keep threads with a PR": "Păstrează sarcinile cu PR",
  "Inactivity does not settle threads with a pull request. Merge and close still do.":
    "Sarcinile cu PR nu se închid din inactivitate. Îmbinarea și închiderea PR-ului le închid în continuare.",

  // Settings: Devices
  "Use devices": "Folosește dispozitive",
  "Open simulators and emulators in the Device panel. Hub:":
    "Deschide simulatoare și emulatoare în panoul Dispozitiv. Hub:",
  "Device hub": "Hubul de dispozitive",
  "Agents can use devices": "Agenții pot folosi dispozitive",
  "New agent sessions can open and drive these devices. agent-device:":
    "Sesiunile noi ale agenților pot deschide și controla aceste dispozitive. agent-device:",
  "Agent device access": "Accesul agenților la dispozitive",
  "Device sources": "Surse de dispozitive",
  "Add source": "Adaugă o sursă",
  "Local simulators": "Simulatoare locale",
  "Test connection": "Testează conexiunea",
  "Testing connection": "Testez conexiunea",
  "Machine over SSH": "Mașină prin SSH",
  Device: "Dispozitiv",
  Starting: "Pornește",
  "Device host not removed everywhere": "Gazda de dispozitive nu s-a șters peste tot",
  "Device host not saved everywhere": "Gazda de dispozitive nu s-a salvat peste tot",
  "Device host not saved": "Gazda de dispozitive nu s-a salvat",
  "Can't connect": "Nu se poate conecta",
  Icon: "Pictogramă",
  "Not available": "Indisponibil",
  "Not added": "Neadăugat",
  "Not set up on this machine.": "Nu e configurat pe această mașină.",

  // Settings: Source control
  Repositories: "Depozite",
  "Automatically pull": "Pull automat",
  "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it.":
    "Ține ramura implicită la zi când checkout-ul nu are modificări sau commituri locale. Fiecare proiect poate schimba asta.",
  "Default automatic pull": "Pull automat implicit",
  "Remove agent credits when merging": "Scoate mențiunile agenților la îmbinare",
  "Default merge method": "Metoda de îmbinare implicită",
  "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device.":
    "PR-urile pornesc cu această metodă. Ultima aleasă refolosește ce ai ales ultima dată pe acest dispozitiv.",
  "Default pull request merge method": "Metoda implicită de îmbinare a PR-urilor",
  "Version Control": "Controlul versiunilor",
  "Rescan server environment": "Scanează din nou serverul",
  "Git availability": "Disponibilitatea Git",
  "Coming Soon": "În curând",
  "Support for": "Suportul pentru",
  "is coming soon.": "vine în curând.",
  "Source control providers": "Servicii de control al versiunilor",
  "Could not verify": "Nu am putut verifica",
  "Not authenticated": "Neautentificat",
  "Available.": "Disponibil.",
  "Not available on this server:": "Indisponibil pe acest server:",
  "Writing & review": "Scriere și revizuire",
  "Source control writing style": "Stilul textelor pentru controlul versiunilor",
  "In each project, matches recent change descriptions and change request titles.":
    "În fiecare proiect urmează stilul descrierilor recente și al titlurilor de PR.",
  "Repository conventions": "Convențiile depozitului",
  "Review guides (beta)": "Ghiduri de revizuire (beta)",
  "Add a Guide tab to pull requests. An agent explains the changes and points out decisions that need review.":
    "Adaugă un tab Ghid la PR-uri. Un agent explică modificările și arată deciziile care trebuie verificate.",
  "Review guides": "Ghiduri de revizuire",
  "Review guide instructions": "Instrucțiunile ghidului de revizuire",
  "Review guide model": "Modelul pentru ghidul de revizuire",
  "Source control writer model": "Modelul pentru textele de versiuni",
  "Follow change request templates": "Urmează șabloanele de PR",
  "Git fetch interval": "Intervalul pentru git fetch",
  Submodules: "Submodule",

  // Settings: Worktrees
  Creation: "Creare",
  "Worktree location": "Locul worktree-urilor",
  "Folder where new worktrees are created, on any drive, such as D:\\worktrees or ~/worktrees. Existing worktrees stay where they are. Leave empty to use the Zen Staff home folder.":
    "Dosarul în care se creează worktree-urile noi, pe orice disc, de ex. D:\\worktrees sau ~/worktrees. Cele existente rămân unde sunt. Lasă gol ca să folosești dosarul Zen Staff.",
  "Start from remote": "Pornește de pe remote",
  "Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing.":
    "Folosește ultimul commit al ramurii remote urmărite de ramura de bază, chiar dacă are alt nume. Altfel folosește ramura cu același nume de pe origin. Dacă ea lipsește, folosește ramura locală.",
  "Start new worktrees from remote by default": "Pornește implicit worktree-urile noi de pe remote",
  Branches: "Ramuri",
  "Worktree branch naming": "Numele ramurilor din worktree-uri",
  "Choose how new worktree branches are named from your first message.":
    "Alege cum se numesc ramurile noi, pornind de la primul tău mesaj.",
  "Static prefix": "Prefix fix",
  "Branch prefix": "Prefixul ramurii",
  "For example, t3 or t3/ produces t3/add-search. Leave empty for no prefix.":
    "De exemplu, t3 sau t3/ dă t3/add-search. Lasă gol pentru fără prefix.",
  "No prefix": "Fără prefix",
  "Delete worktrees with deleted threads": "Șterge worktree-urile sarcinilor șterse",
  "Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept.":
    "Șterge worktree-urile nefolosite când se șterg sarcinile active sau arhivate. Cele cu modificări locale rămân.",
  "Delete merged worktrees": "Șterge worktree-urile îmbinate",
  "Remove worktrees whose pull request is merged and whose commits are included in the default branch.":
    "Șterge worktree-urile al căror PR e îmbinat și ale căror commituri sunt în ramura implicită.",
  "Delete inactive worktrees": "Șterge worktree-urile inactive",
  "Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept.":
    "Șterge worktree-urile după ce sarcinile lor au stat inactive atâtea zile. Ramurile și istoricul rămân.",
  "Keep worktrees with local changes": "Păstrează worktree-urile cu modificări locale",
  "Worktree cleanup": "Curățarea worktree-urilor",

  // Settings: Labs
  Beta: "Beta",
  "Boring sidebar (group by project)": "Bară laterală simplă (pe proiecte)",
  "Group sidebar threads into project folders. Pinned threads stay on top, and Snoozed and Settled stay below the folders.":
    "Grupează sarcinile din bara laterală pe proiecte. Cele fixate rămân sus, Amânate și Terminate rămân sub ele.",
  "Two-line folder rows": "Rânduri pe două linii",
  "In the boring sidebar, show folder threads on two lines: the title, then the branch, pull request, and agent.":
    "În bara laterală simplă, arată sarcinile pe două linii: titlul, apoi ramura, PR-ul și agentul.",
  "Tool calls in chat": "Pașii agentului în conversație",
  "Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.":
    "Ascunde comenzile, editările și căutările agenților. Ascunde reușitele păstrează erorile. Zen arată doar răspunsurile finale. Aprobările, întrebările și erorile se văd mereu.",
  "Show all": "Arată tot",
  "Guest links": "Linkuri pentru invitați",
  "Share a thread with a guest who watches it live in a browser and sends messages you approve. Needs Zen Hub: sign in and link this machine in":
    "Trimite o sarcină unui invitat care o urmărește live în browser și trimite mesaje pe care le aprobi tu. Are nevoie de Zen Hub: conectează-te și leagă acest calculator din",
  ". Turning it off stops every guest link.":
    ". Dacă o oprești, se opresc toate linkurile pentru invitați.",
  "Let agents here work on your other machines, and theirs here. Turn it on for each machine, then link them in":
    "Agenții de aici pot lucra pe celelalte calculatoare ale tale și invers. Pornește pe fiecare, apoi leagă-le din",
  ". While off, nothing new starts over a link; running tasks finish.":
    ". Cât e oprit, nu pornește nimic nou printr-o legătură; sarcinile în curs se termină.",
  "Simlock device hosts (alpha)": "Gazde de dispozitive Simlock (alfa)",
  "Let the Device panel lease simulators and emulators from your own":
    "Panoul Dispozitiv poate împrumuta simulatoare și emulatoare din propriul",
  "pool, added in": "grup, adăugat în",
  ". An alpha that may change or break. Zen Staff never installs Simlock.":
    ". E o versiune alfa care se poate schimba sau strica. Zen Staff nu instalează niciodată Simlock.",
  "Simlock device hosts": "Gazde de dispozitive Simlock",
  "Plan mode (legacy)": "Modul plan (vechi)",
  "Restore Build/Plan, /plan, /default, and Shift+Tab. Off uses build mode.":
    "Readuce Build/Plan, /plan, /default și Shift+Tab. Oprit folosește modul build.",
  "Context window indicator (legacy)": "Indicatorul ferestrei de context (vechi)",
  "Shows context window usage as a circular indicator in the composer.":
    "Arată cât din fereastra de context e folosit, ca un cerc în caseta de mesaj.",

  // Settings: Environments (Connections)
  "This machine": "Acest calculator",
  "Network access": "Acces din rețea",
  "Load balancing": "Împărțirea sarcinilor",
  "New threads in shared projects start on the machine with the most free CPU and memory, weighted by each machine's preference.":
    "Sarcinile noi din proiectele comune pornesc pe calculatorul cu cel mai mult procesor și memorie liberă, după preferința fiecăruia.",
  Prefer: "Preferat",
  Normal: "Normal",
  "Less often": "Mai rar",
  "Manual only": "Doar manual",
  "Automatically balance load": "Împarte automat sarcinile",
  "Pull request sharing": "Partajarea PR-urilor",
  "Machines you trust here can read PR data through each other's source control access. Enable both machines. Read and act may use broader permissions than the machine that owns them. This applies only to this device.":
    "Calculatoarele în care ai încredere pot citi date despre PR-uri prin accesul la git al celuilalt. Pornește pe amândouă. Citire și acțiune poate folosi drepturi mai largi decât calculatorul care le deține. Se aplică doar pe acest dispozitiv.",
  "Read PRs": "Citește PR-urile",
  "Read and act": "Citire și acțiune",
  "Could not save pull request routing permission": "Nu am putut salva dreptul pentru PR-uri",
  Connected: "Conectat",
  Connecting: "Se conectează",
  Reconnecting: "Se reconectează",
  "Client not supported": "Client nesuportat",
  "Connection failed": "Conexiunea a eșuat",
  Routes: "Rute",
  "Hide routes": "Ascunde rutele",
  "Add route": "Adaugă o rută",
  "In use": "Folosită",
  "Remove route": "Șterge ruta",
  "Reorder routes": "Reordonează rutele",
  "Route added": "Ruta a fost adăugată",
  "Could not add the route.": "Nu am putut adăuga ruta.",
  Update: "Actualizează",
  "Switch off": "Oprește",
  "Switch on": "Pornește",
  "Switched off": "Oprit",
  Restarting: "Repornește",
  "Removing…": "Șterg…",
  "Remove from this device…": "Scoate de pe acest dispozitiv…",
  "Copy MCP URL": "Copiază adresa MCP",
  "Could not copy MCP URL": "Nu am putut copia adresa MCP",
  "Get more tunnels": "Mai multe tuneluri",
  "Enable Zen Hub": "Pornește Zen Hub",
  "Zen Hub linked": "Zen Hub legat",
  "Zen Hub tunnel disabled": "Tunelul Zen Hub oprit",
  "Zen Hub unlinked": "Zen Hub dezlegat",
  "The managed tunnel was removed. Agent activity publishing stays on.":
    "Tunelul administrat a fost scos. Trimiterea activității agenților rămâne pornită.",
  "Agent activity enabled": "Activitatea agenților pornită",
  "Agent activity disabled": "Activitatea agenților oprită",
  "Webhooks held while offline": "Webhookurile se păstrează cât e offline",
  "Webhooks no longer held": "Webhookurile nu se mai păstrează",
  "Your session does not have permission to manage Zen Hub access.":
    "Sesiunea ta nu are dreptul să gestioneze accesul Zen Hub.",
  "Zen Hub is on. Reachability has not been checked yet.":
    "Zen Hub e pornit. Încă nu am verificat dacă se poate ajunge la el.",
  "Sign in to send activity to mobile notifications and Live Activities.":
    "Conectează-te ca să trimiți activitatea în notificările de pe telefon și în Live Activities.",
  "Send activity to mobile notifications and Live Activities without Zen Hub.":
    "Trimite activitatea în notificările de pe telefon și în Live Activities fără Zen Hub.",
  "Publish agent activity to mobile clients": "Trimite activitatea agenților pe telefon",
  "Publish agent activity": "Trimite activitatea agenților",
  "Hold webhooks while offline": "Păstrează webhookurile cât e offline",
  "To edit these settings, pair this connection with both View relay and Manage relay permissions.":
    "Ca să schimbi aceste setări, asociază conexiunea cu drepturile Vede releul și Gestionează releul.",
  "Remote link": "Link la distanță",
  "Link another machine running Zen Staff, such as a VPS, so agents here can launch and drive threads there.":
    "Leagă alt calculator cu Zen Staff, de exemplu un VPS, ca agenții de aici să poată porni și conduce sarcini acolo.",
  "Already linked. Linking again renews it with the access you pick.":
    "E deja legat. Dacă îl legi din nou, legătura se reînnoiește cu accesul ales.",
  "Could not forget the link": "Nu am putut șterge legătura",
  "Expired. Link it again with a new pairing code.": "A expirat. Leagă-l din nou cu un cod nou.",
  "Not answering right now.": "Nu răspunde acum.",
  Reachable: "Accesibil",
  "Forgetting…": "Șterg…",
  Forget: "Uită",
  "Paste the code": "Lipește codul",
  "Linking…": "Leg…",
  Linked: "Legat",
  "Another address…": "Altă adresă…",
  "Choose a machine": "Alege un calculator",
  "What agents here may do there": "Ce pot face acolo agenții de aici",
  "Not connected": "Neconectat",
  "Couldn't change this setting.": "Nu am putut schimba setarea.",
  "Zen Staff will restart without running a server on this computer. Any agents and terminals running here will stop, and other devices will no longer be able to connect to this computer. Your projects, history, and remote environments are unaffected.":
    "Zen Staff repornește fără server pe acest calculator. Agenții și terminalele de aici se opresc, iar alte dispozitive nu se mai pot conecta la el. Proiectele, istoricul și celelalte calculatoare rămân neatinse.",
  "Zen Staff will restart and start running a server on this computer again.":
    "Zen Staff repornește și pornește din nou serverul pe acest calculator.",
  "Restart and turn off": "Repornește și oprește",
  "Restart and turn on": "Repornește și pornește",
  "Enable network access?": "Pornești accesul din rețea?",
  "Disable network access?": "Oprești accesul din rețea?",
  "Let your other devices connect to Zen Staff over the network. Pair devices to give them access. Zen Staff will restart.":
    "Celelalte dispozitive se pot conecta la Zen Staff prin rețea. Asociază-le ca să le dai acces. Zen Staff repornește.",
  "Devices connected over your local network will disconnect. Existing tunnels, such as Zen Hub or Tailscale HTTPS, keep working. Zen Staff will restart.":
    "Dispozitivele conectate prin rețeaua locală se deconectează. Tunelurile existente, ca Zen Hub sau Tailscale HTTPS, merg mai departe. Zen Staff repornește.",
  "Restart and enable": "Repornește și pornește",
  "Restart and disable": "Repornește și oprește",
  "Exposed on all interfaces.": "Accesibil pe toate interfețele.",
  "Limited to this machine.": "Doar pe acest calculator.",
  "This connection cannot view or change network exposure.":
    "Această conexiune nu poate vedea sau schimba accesul din rețea.",
  "Remote access is already configured. Change network exposure where the server starts.":
    "Accesul de la distanță e deja configurat. Schimbă-l acolo unde pornește serverul.",
  "Network exposure information is unavailable.": "Nu am informații despre accesul din rețea.",
  "Retry update": "Reîncearcă actualizarea",
  "Retrying…": "Reîncerc…",
  "Restarting…": "Repornesc…",
  "Applying…": "Aplic…",
  "Loading…": "Se încarcă…",
  "Use Tailscale Serve to expose this backend through a MagicDNS HTTPS URL.":
    "Folosește Tailscale Serve ca serverul să fie accesibil la o adresă HTTPS MagicDNS.",
  "Enable Tailscale HTTPS": "Pornește Tailscale HTTPS",
  "Set up Tailscale HTTPS?": "Configurezi Tailscale HTTPS?",
  "Disable Tailscale HTTPS?": "Oprești Tailscale HTTPS?",
  "Pending MagicDNS endpoint": "Adresa MagicDNS e în așteptare",
  "Environment icon": "Pictograma",
  "Environment identification": "Identificare",
  "Secret providers": "Surse de secrete",
  "Add secret provider": "Adaugă o sursă de secrete",
  Host: "Gazdă",
  Username: "Utilizator",
  Port: "Port",
  "Paste a full pairing URL here to fill both fields automatically.":
    "Lipește aici linkul complet de asociere ca să se completeze singure ambele câmpuri.",
  "This machine is on your Zen Hub account. Use it as a fallback route.":
    "Acest calculator e în contul tău Zen Hub. Folosește-l ca rută de rezervă.",
  "Add Zen Hub": "Adaugă Zen Hub",
  "Loading hosts…": "Încarc gazdele…",
  "Failed to add backend.": "Nu am putut adăuga serverul.",
  "Could not add backend": "Nu am putut adăuga serverul",
  "Backend added": "Server adăugat",
  "Adding…": "Adaug…",
  "Search hosts or type devbox": "Caută gazde sau scrie devbox",
  "Pair this machine again over another address, such as its Tailscale name. It joins the existing routes instead of adding a second machine.":
    "Asociază din nou acest calculator prin altă adresă, de ex. numele lui Tailscale. Se adaugă la rutele existente, nu ca alt calculator.",
  "Enter a backend host and pairing code.": "Scrie adresa serverului și codul de asociere.",
  "Use local SSH config, agent, and tunnels for the backend.":
    "Folosește configurarea SSH locală, agentul și tunelurile pentru server.",
  "Enter a backend host.": "Scrie adresa serverului.",
  "Enter a pairing code.": "Scrie codul de asociere.",
  "These permissions apply to your active route. Other routes may have different permissions.":
    "Aceste drepturi sunt pentru ruta activă. Alte rute pot avea alte drepturi.",
  "Not granted": "Neacordat",

  // Settings: Sharing & access (pairing)
  "Pairing link": "Link de asociere",
  "Show link": "Arată linkul",
  "Show code": "Arată codul",
  "Hosted app pairing link": "Link de asociere pentru aplicația web",
  "Open it in the browser on the device you want to connect.":
    "Deschide-l în browser pe dispozitivul pe care vrei să-l conectezi.",
  "Paste it into another client to finish pairing.":
    "Lipește-l în altă aplicație ca să termini asocierea.",
  "Clipboard copy unavailable": "Copierea nu e disponibilă",
  "Showing the full value instead.": "Arăt în schimb valoarea completă.",
  "Could not copy pairing URL": "Nu am putut copia linkul de asociere",
  "Could not copy pairing code": "Nu am putut copia codul de asociere",
  "Could not copy hosted app link": "Nu am putut copia linkul aplicației web",
  "Revoking…": "Revoc…",
  Revoke: "Revocă",
  "Not connected yet.": "Încă neconectat.",
  "Failed to create pairing URL.": "Nu am putut crea linkul de asociere.",
  "Creating…": "Creez…",
  Setup: "Configurare",
  Disable: "Oprește",
  Hide: "Ascunde",
  "Opens the hosted app, no install needed": "Deschide aplicația web, fără instalare",
  "Devices on the same network": "Dispozitive din aceeași rețea",
  "Devices on your private network": "Dispozitive din rețeaua ta privată",
  "Reachable from anywhere": "Accesibil de oriunde",
  "Clients on this machine": "Aplicații de pe acest calculator",

  // Thread screen chrome (Code shows most of it)
  "Toggle Sidebar": "Arată sau ascunde bara laterală",
  "Resize Sidebar": "Redimensionează bara laterală",
  "Maximize panel": "Mărește panoul",
  "Toggle thread details panel": "Arată sau ascunde detaliile sarcinii",
  "Toggle terminal drawer": "Arată sau ascunde terminalul",
  "Toggle right panel": "Arată sau ascunde panoul din dreapta",
  "Thread breadcrumb": "Navigare în sarcină",
  Conversation: "Conversație",
  "Syncing messages...": "Sincronizez mesajele...",
  "Message input": "Caseta de mesaj",
  "More composer controls": "Mai multe opțiuni pentru mesaj",
  "Start voice input": "Pornește dictarea",
  "Submit message": "Trimite mesajul",
  "Send a message to start the conversation.": "Trimite un mesaj ca să începi conversația.",
  "Open in editor": "Deschide în editor",
  "Choose editor": "Alege editorul",
  "Add project script": "Adaugă un script de proiect",
  "Select ref": "Alege ramura sau tagul",
  "Choose what to show": "Alege ce să arate",
  "Command palette": "Paleta de comenzi",
  "Triage an issue": "Analizează o problemă",
  "An agent investigates a Zen Staff problem and helps file an issue":
    "Un agent cercetează o problemă din Zen Staff și te ajută să o raportezi",
  "Copy thread": "Copiază sarcina",
  "Link pull request to thread": "Leagă un PR de sarcină",
  "Show linked pull requests": "Arată PR-urile legate",
  "Restart agent session": "Repornește sesiunea agentului",
  "Search project contents": "Caută în conținutul proiectului",
  "Open pull requests": "Deschide PR-urile",
  "Message New thread": "Mesaj pentru sarcina nouă",
  "Git actions": "Acțiuni Git",
  "Git action options": "Opțiuni pentru acțiunile Git",
  "Commit, push & PR": "Commit, push și PR",
  Changes: "Modificări",
  "Connecting…": "Mă conectez…",

  // Settings: Providers (cards, sign-in, models)
  "Authenticated as": "Autentificat ca",
  "Continue authentication": "Continuă autentificarea",
  "Sensitive, stored separately": "Sensibil, păstrat separat",
  "Plain text": "Text simplu",
  "Starting update": "Pornesc actualizarea",
  "Run it in a terminal when you are ready to update.":
    "Rulează comanda într-un terminal când vrei să actualizezi.",
  Incompatible: "Incompatibil",
  Unsupported: "Nesuportat",
  "Limited support": "Suport limitat",
  Updating: "Se actualizează",
  "Update now": "Actualizează acum",
  "Copy update command": "Copiază comanda de actualizare",
  "Reset to the device setting": "Revino la setarea dispozitivului",
  "Instance label": "Numele instanței",
  "Primary device": "Dispozitivul principal",
  "Local device": "Dispozitiv local",
  "Remote device": "Dispozitiv la distanță",
  "Could not connect to this device": "Nu m-am putut conecta la acest dispozitiv",
  "Device unavailable": "Dispozitiv indisponibil",
  "No connected devices": "Niciun dispozitiv conectat",
  "Loading devices": "Încarc dispozitivele",
  "Limited permissions": "Drepturi limitate",
  "Checking what this session is allowed to change.": "Verific ce poate schimba această sesiune.",
  "Authentication request expired": "Cererea de autentificare a expirat",
  Next: "Înainte",
  Docs: "Documentație",
  Source: "Sursă",
  Label: "Nume",
  "Show more": "Arată mai multe",
  "Enter manually": "Scrie de mână",
  "Accent color": "Culoare de accent",
  "Optional marker shown in the picker.": "Semn opțional afișat în listă.",
  "Adding...": "Adaug...",
  "Continue to sign-in": "Continuă la conectare",
  "Add instance": "Adaugă instanța",
  "Configure manually": "Configurează manual",
  "Move up": "Mută mai sus",
  "Move down": "Mută mai jos",
  "Edit name and options": "Editează numele și opțiunile",
  "Remove custom model": "Șterge modelul propriu",
  "Fast mode": "Modul rapid",
  "No reasoning": "Fără gândire",
  "Filter models": "Filtrează modelele",
  "Enable all": "Pornește tot",
  "Disable all": "Oprește tot",
  Favorites: "Favorite",
  All: "Toate",
  "Hidden from picker": "Ascuns din listă",
  "Shown in picker": "Afișat în listă",
  "Custom models are always shown in the picker": "Modelele proprii apar mereu în listă",
  "Remove from favorites": "Scoate din favorite",
  "Add to favorites": "Adaugă la favorite",
  "Open browser": "Deschide browserul",
  "Copy sign-in link": "Copiază linkul de conectare",
  "Open docs": "Deschide documentația",
  "Loading sign-in terminal…": "Încarc terminalul de conectare…",
  Connect: "Conectează",
  Continue: "Continuă",
  "Starting sign-in…": "Pornesc conectarea…",
  "Checking credentials and loading models…": "Verific datele și încarc modelele…",
  "Checking your account…": "Verific contul…",
  "Complete sign-in in the terminal below.": "Termină conectarea în terminalul de mai jos.",
  "Enter your credentials below.": "Scrie datele de conectare mai jos.",
  "Finish signing in in your browser.": "Termină conectarea în browser.",
  "Signed in.": "Conectat.",
  Account: "Cont",
  "Sign-in method": "Metoda de conectare",
  "Cancel sign-in": "Anulează conectarea",
  "Change account": "Schimbă contul",
  "Retry connection": "Reîncearcă conectarea",
  "Retry sign-in": "Reîncearcă autentificarea",
  "Installed.": "Instalat.",
  "Not installed.": "Neinstalat.",
  "Cancel installation": "Anulează instalarea",
  "Retry installation": "Reîncearcă instalarea",
  "Setup unavailable": "Configurarea nu e disponibilă",

  // Settings: Environments on Windows (WSL) and Tailscale
  "WSL backend": "Backend WSL",
  "Switch to Windows": "Treci pe Windows",
  "Default distro": "Distribuția implicită",
  "Run the selected WSL distro alongside Windows. Projects remain on their current filesystem.":
    "Rulează distribuția WSL aleasă alături de Windows. Proiectele rămân unde sunt.",
  "Run only the WSL backend. Zen Staff restarts when this changes.":
    "Rulează doar backendul WSL. Zen Staff repornește când schimbi asta.",
  "Run WSL only": "Doar WSL",
  "Turn off WSL and switch back to Windows?": "Oprești WSL și revii la Windows?",
  "Disable WSL backend?": "Oprești backendul WSL?",
  "Switch WSL distro?": "Schimbi distribuția WSL?",
  "Start the WSL backend": "Pornește backendul WSL",
  "Run only the WSL backend?": "Rulezi doar backendul WSL?",
  "Re-enable the Windows backend?": "Pornești din nou backendul Windows?",
  "Zen Staff will restart on the Windows backend. Threads and projects opened against WSL stay safe inside the distro and become available again when you re-enable WSL.":
    "Zen Staff repornește pe backendul Windows. Sarcinile și proiectele din WSL rămân în siguranță în distribuție și revin când pornești din nou WSL.",
  "The WSL backend will stop. Threads and projects opened against WSL stay safe inside the distro, but they'll be unavailable in Zen Staff until you re-enable WSL.":
    "Backendul WSL se oprește. Sarcinile și proiectele din WSL rămân în siguranță în distribuție, dar nu le vezi în Zen Staff până nu pornești din nou WSL.",
  "Zen Staff will restart the WSL backend on the new distro. Sessions still running on the current distro will be interrupted.":
    "Zen Staff repornește backendul WSL pe noua distribuție. Sesiunile care rulează pe distribuția actuală se întrerup.",
  "Run the WSL backend alongside the Windows one, or stop the Windows backend and use only WSL? You can change this later from Settings.":
    "Rulezi backendul WSL alături de cel Windows sau oprești backendul Windows și folosești doar WSL? Poți schimba asta oricând din Setări.",
  "Zen Staff will restart and start only the WSL backend. Your Windows-side projects won't be accessible until you turn this off again.":
    "Zen Staff repornește doar cu backendul WSL. Proiectele din Windows nu vor fi accesibile până nu oprești asta.",
  "Zen Staff will restart and bring the Windows backend back up alongside WSL.":
    "Zen Staff repornește și pornește din nou backendul Windows alături de WSL.",
  "Use only WSL": "Folosește doar WSL",
  "Run both backends": "Rulează ambele backenduri",
  "Disable WSL": "Oprește WSL",
  "Switch distro": "Schimbă distribuția",
  "Couldn't load the WSL backend state.": "Nu am putut citi starea backendului WSL.",
  "Could not change WSL backend": "Nu am putut schimba backendul WSL",
  "Zen Staff will restart the local backend without Tailscale Serve.":
    "Zen Staff repornește backendul local fără Tailscale Serve.",
  "Zen Staff will restart the local backend with Tailscale Serve enabled and ask Tailscale to proxy HTTPS traffic to this backend.":
    "Zen Staff repornește backendul local cu Tailscale Serve, iar Tailscale va trimite traficul HTTPS către el.",
  "Could not set up Tailscale HTTPS": "Nu am putut configura Tailscale HTTPS",
  "Could not disable Tailscale HTTPS": "Nu am putut opri Tailscale HTTPS",
  "Enter a port from 1 to 65535.": "Scrie un port între 1 și 65535.",
  "Copy the token and pair from another client using this backend's reachable host.":
    "Copiază tokenul și asociază din altă aplicație folosind adresa accesibilă a acestui backend.",
  "No QR for this endpoint. Another device scanning a loopback link would dial itself; copy the URL for use on this machine instead.":
    "Nu există cod QR pentru această adresă: alt dispozitiv care scanează un link local s-ar conecta la el însuși. Copiază linkul pentru acest calculator.",
  "Clipboard copy is unavailable here. Open or manually copy this hosted app link on the device you want to connect.":
    "Copierea nu merge aici. Deschide sau copiază de mână acest link pe dispozitivul pe care vrei să-l conectezi.",
  "Clipboard copy is unavailable here. Open or manually copy this full pairing URL on the device you want to connect.":
    "Copierea nu merge aici. Deschide sau copiază de mână acest link de asociere pe dispozitivul pe care vrei să-l conectezi.",
  "Clipboard copy is unavailable here. Manually copy this code into another client.":
    "Copierea nu merge aici. Copiază de mână acest cod în cealaltă aplicație.",
  "Simlock host not saved everywhere": "Gazda Simlock nu s-a salvat peste tot",
  "Simlock host not removed everywhere": "Gazda Simlock nu s-a șters peste tot",

  // Settings: other pages
  "Device hub: not installed. Show details": "Hubul de dispozitive: neinstalat. Arată detaliile",
  "Agent device: not installed. Show details": "Accesul agenților: neinstalat. Arată detaliile",
  "just now": "chiar acum",
  ago: "în urmă",
  "CODEX_HOME path": "Calea CODEX_HOME",
  "Archived threads will appear here.": "Sarcinile arhivate apar aici.",
  "Zen Staff splash screen": "Ecranul de pornire Zen Staff",
  "OpenTelemetry export": "Export OpenTelemetry",
  "Choose one environment to configure its telemetry exports.":
    "Alege un mediu ca să-i configurezi exportul de telemetrie.",
  "Resource monitor": "Monitorul de resurse",
  "Trace Diagnostics": "Diagnoza urmelor",
  "Open logs folder": "Deschide dosarul cu jurnale",
  "Live Processes": "Procese active",
  "Resource History": "Istoricul resurselor",
  "Remove recognized agent credit lines from merge and squash messages on hosts that support it, keeping human co-authors. Includes auto-merge. Excludes merge queues, stack merges, and existing commits.":
    "Scoate rândurile cu mențiuni ale agenților din mesajele de îmbinare și squash, unde serverul permite, și păstrează coautorii oameni. Include îmbinarea automată. Nu se aplică la cozile de îmbinare, îmbinările în stivă și commiturile existente.",
  "Add a Bitbucket token in Settings → Source Control.":
    "Adaugă un token Bitbucket în Setări → Controlul versiunilor.",
};

type Replacer = (...groups: string[]) => string;

const MONTHS: Readonly<Record<string, string>> = {
  Jan: "ian.",
  Feb: "feb.",
  Mar: "mar.",
  Apr: "apr.",
  May: "mai",
  Jun: "iun.",
  Jul: "iul.",
  Aug: "aug.",
  Sep: "sept.",
  Oct: "oct.",
  Nov: "nov.",
  Dec: "dec.",
};
const MONTH = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";

/** "4d 21h" -> "4z 21h"; hours and minutes read the same in Romanian. */
function romanianDuration(text: string): string {
  return text.replace(/\b(\d+)d\b/g, "$1z");
}

/** Romanian count with "de" from 20 up: "9 sesiuni", "791 de sesiuni". */
function countRo(value: string, one: string, many: string): string {
  const n = Number(value.replace(/[.,\s]/g, ""));
  if (n === 1) return `1 ${one}`;
  const rest = n % 100;
  return n === 0 || (rest >= 1 && rest <= 19) ? `${value} ${many}` : `${value} de ${many}`;
}

const PERIODS: Readonly<Record<string, string>> = {
  "Past 24h": "Ultimele 24 h",
  "7 days": "7 zile",
  "30 days": "30 de zile",
  "90 days": "90 de zile",
};

/** Upstream text with values in it, for both editions. A function gets the captured groups. */
export const UPSTREAM_SCREENS_PATTERNS_RO: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly ro: string | Replacer;
}> = [
  // Usage window: reset badges and durations ("4d 21h", "↻ 4d 21h", "resets in 2h 5m").
  { pattern: /^(\d+)d (\d+)h$/, ro: "$1z $2h" },
  { pattern: /^↻ (.+)$/, ro: (rest) => `↻ ${romanianDuration(rest)}` },
  { pattern: /^resets in (.+)$/, ro: (rest) => `se resetează în ${romanianDuration(rest)}` },
  { pattern: /^Weekly · (.+)$/, ro: "Săptămânal · $1" },
  { pattern: /^Session · (.+)$/, ro: "Sesiune · $1" },
  { pattern: /^(.+) · Weekly$/, ro: "$1 · Săptămânal" },
  { pattern: /^(\d+)% left$/, ro: "$1% rămas" },
  { pattern: /^(\d+)% left by now$/, ro: "$1% rămas până acum" },
  {
    pattern: /^(.+): (\d+)% left(?:, resets in ([^,]+))?(?:, (\d+)% of the window left)?$/,
    ro: (name, left, resets, window) =>
      `${name}: ${left}% rămas${resets ? `, se resetează în ${romanianDuration(resets)}` : ""}${
        window ? `, ${window}% din interval rămas` : ""
      }`,
  },
  {
    pattern: /^(Past 24h|7 days|30 days|90 days) \((.+)\)$/,
    ro: (period, keys) => `${PERIODS[period] ?? period} (${keys})`,
  },
  { pattern: /^([\d.,]+) sessions?$/, ro: (n) => countRo(n, "sesiune", "sesiuni") },
  { pattern: /^([\d.]+)% of tokens · (.+)$/, ro: "$1% din tokeni · $2" },
  { pattern: /^([\d.]+)% of cost · (.+)$/, ro: "$1% din cost · $2" },
  {
    pattern: new RegExp(`^${MONTH} (\\d{1,2}) to ${MONTH} (\\d{1,2})$`),
    ro: (m1, d1, m2, d2) => `${d1} ${MONTHS[m1]} – ${d2} ${MONTHS[m2]}`,
  },
  {
    pattern: new RegExp(`^${MONTH} (\\d{1,2})$`),
    ro: (month, day) => `${day} ${MONTHS[month]}`,
  },
  // Settings
  { pattern: /^Copy version (.+)$/, ro: "Copiază versiunea $1" },
  { pattern: /^Thread details: (\d+) of (\d+) on$/, ro: "Detaliile sarcinii: $1 din $2 pornite" },
  { pattern: /^Snooze option (\d+)$/, ro: "Varianta $1 pentru Amână" },
  { pattern: /^Remove snooze option (\d+)$/, ro: "Șterge varianta $1 pentru Amână" },
  { pattern: /^Menu now: (.+)$/, ro: "Meniul acum: $1" },
  { pattern: /^Revoked (\d+) other clients?$/, ro: "Am revocat $1 alte aplicații" },
  { pattern: /^Use (.+) light mode$/, ro: "Folosește $1 în modul luminos" },
  { pattern: /^Use (.+) dark mode$/, ro: "Folosește $1 în modul întunecat" },
  { pattern: /^Use (.+) theme$/, ro: "Folosește tema $1" },
  { pattern: /^Duplicate (.+)$/, ro: "Duplică $1" },
  { pattern: /^Toggle (.+) details$/, ro: "Arată sau ascunde detaliile $1" },
  {
    pattern:
      /^(GitHub|GitLab|GitCafe|Bitbucket|Azure DevOps|Forgejo \/ Gitea|Git|Jujutsu) availability$/,
    ro: "Disponibilitate $1",
  },
  { pattern: /^Add accent color for (.+)$/, ro: "Alege o culoare pentru $1" },
  { pattern: /^Authenticated · (.+)$/, ro: "Autentificat · $1" },
  { pattern: /^(\d+) clients?$/, ro: (n) => countRo(n, "aplicație", "aplicații") },
  // Thread screen
  { pattern: /^New thread in (.+)$/, ro: "Sarcină nouă în $1" },
  { pattern: /^New thread, (.+)$/, ro: "Sarcină nouă, $1" },
  { pattern: /^Thread actions for (.+)$/, ro: "Acțiuni pentru $1" },
  { pattern: /^Run context: (.+)$/, ro: "Unde rulează: $1" },
  { pattern: /^vs (\S+)$/, ro: "față de $1" },
];

/** Applies a pattern rule's Romanian to `key`, or null when it does not match. */
export function applyScreensPattern(
  key: string,
  rules: ReadonlyArray<{ readonly pattern: RegExp; readonly ro: string | Replacer }>,
): string | null {
  for (const rule of rules) {
    const match = rule.pattern.exec(key);
    if (!match) continue;
    if (typeof rule.ro === "string") return key.replace(rule.pattern, rule.ro);
    return rule.ro(...match.slice(1).map((group) => group ?? ""));
  }
  return null;
}
