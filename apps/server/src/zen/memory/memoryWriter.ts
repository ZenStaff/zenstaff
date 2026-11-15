// Zen Staff company memory: a seam for other Zen features to save a document (not a chat) to a
// company's hosted memory through the same client, queue, redaction and quotas as conversations.
// ZenMemory registers the writer at startup; the onboarding interview uses it for the company
// profile. Nothing is sent unless the company is connected.

export interface ZenMemoryWriter {
  /** The company has a memory server and a key on this machine. */
  readonly connected: (companyId: string) => boolean;
  /** Redacts, queues and sends one document; the same key twice is one episode on the server. */
  readonly saveDocument: (
    companyId: string,
    document: { readonly key: string; readonly title: string; readonly text: string },
  ) => Promise<{ readonly status: string; readonly detail: string | null }>;
}

let writer: ZenMemoryWriter | null = null;

export function setZenMemoryWriter(next: ZenMemoryWriter | null): void {
  writer = next;
}

export function zenMemoryWriter(): ZenMemoryWriter | null {
  return writer;
}
