// Zen Staff: in Office the file tree folds away while a document (Word, Excel, PowerPoint, PDF) is
// open, so the page gets the panel's width instead of a ~150 px column. The tree button brings it
// back for that file. Code keeps upstream's remembered tree state. Hooked into FilePreviewPanel.tsx.
import { useState } from "react";

import { useZenOffice } from "../office/useZenEdition";

export function useZenOfficeExplorerFold(path: string | null, documentOpen: boolean) {
  const office = useZenOffice();
  const [shownFor, setShownFor] = useState<string | null>(null);
  const folded = office && documentOpen && path !== null && shownFor !== path;
  return { folded, unfold: () => setShownFor(path) };
}
