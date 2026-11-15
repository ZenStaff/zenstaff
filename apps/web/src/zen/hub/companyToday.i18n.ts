// Zen Staff: strings for "Your company today" (CompanyTodayCard.tsx).
import { defineZenMessages } from "../i18n/zenI18n";

export const companyTodayText = defineZenMessages({
  en: {
    title: "Your company today",
    chooseCompany: "Company",
    openInBrowser: "Open in browser",
    approvalsWaiting: (count: number): string =>
      count === 1 ? "approval waiting" : "approvals waiting",
    nothingWaiting: "Nothing waits for you",
    staffWorking: (total: number) =>
      total === 0 ? "No AI staff yet" : `of ${total} AI staff working`,
    devicesOnline: "your devices online",
    devicesUnknown: "Your devices",
    runnerOnline: "Company server online",
    runnerOffline: "Company server offline",
    runnerNone: "No company server yet",
    runnerUnknown: "Company server: the hub did not answer",
    approvalChats: (count: number) =>
      count === 1 ? "1 chat asks for your OK" : `${count} chats ask for your OK`,
    approvalStaff: (count: number) =>
      count === 1 ? "1 AI staff action to approve" : `${count} AI staff actions to approve`,
    approvalMessages: (count: number) =>
      count === 1 ? "1 message reply to approve" : `${count} message replies to approve`,
    approvalDevices: (count: number) =>
      count === 1
        ? "1 new device waits on this computer"
        : `${count} new devices wait on this computer`,
    staffTitle: "AI staff",
    staffUnlinked: "Link a company on this computer to see its AI staff.",
    staffEmpty: "No AI staff hired yet.",
    staffMore: (count: number) => `+${count} more`,
    staffStatus: {
      working: "Working",
      idle: "Idle",
      "waiting-approval": "Waiting for approval",
      paused: "Paused",
    } as Record<string, string>,
    packsTitle: "Packs that did not install",
    packOn: (machine: string, person: string) => `${machine}, ${person}`,
    openPacks: "Open packs",
    openStaff: "Open AI staff",
  },
  ro: {
    title: "Firma ta azi",
    chooseCompany: "Firma",
    openInBrowser: "Deschide în browser",
    approvalsWaiting: (count: number) =>
      count === 1 ? "aprobare te așteaptă" : "aprobări te așteaptă",
    nothingWaiting: "Nimic nu te așteaptă",
    staffWorking: (total: number) =>
      total === 0 ? "Încă nu ai angajați AI" : `din ${total} angajați AI lucrează`,
    devicesOnline: "dispozitivele tale conectate",
    devicesUnknown: "Dispozitivele tale",
    runnerOnline: "Serverul firmei e conectat",
    runnerOffline: "Serverul firmei e deconectat",
    runnerNone: "Firma nu are încă un server",
    runnerUnknown: "Serverul firmei: hub-ul nu a răspuns",
    approvalChats: (count: number) =>
      count === 1 ? "O conversație îți cere acordul" : `${count} conversații îți cer acordul`,
    approvalStaff: (count: number) =>
      count === 1
        ? "O acțiune a angajaților AI de aprobat"
        : `${count} acțiuni ale angajaților AI de aprobat`,
    approvalMessages: (count: number) =>
      count === 1 ? "Un răspuns la mesaje de aprobat" : `${count} răspunsuri la mesaje de aprobat`,
    approvalDevices: (count: number) =>
      count === 1
        ? "Un dispozitiv nou așteaptă pe acest calculator"
        : `${count} dispozitive noi așteaptă pe acest calculator`,
    staffTitle: "Angajați AI",
    staffUnlinked: "Leagă o firmă pe acest calculator ca să-i vezi angajații AI.",
    staffEmpty: "Încă nu ai angajat niciun agent AI.",
    staffMore: (count: number) => `încă ${count}`,
    staffStatus: {
      working: "Lucrează",
      idle: "Liber",
      "waiting-approval": "Așteaptă aprobare",
      paused: "În pauză",
    } as Record<string, string>,
    packsTitle: "Pachete care nu s-au instalat",
    packOn: (machine: string, person: string) => `${machine}, ${person}`,
    openPacks: "Deschide pachetele",
    openStaff: "Deschide angajații AI",
  },
});
