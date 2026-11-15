import {
  ZEN_MOBILE_LEGAL_URL,
  ZEN_MOBILE_PRIVACY_URL,
  ZEN_MOBILE_SECURITY_URL,
} from "../../../zen/config";

// Zen Staff: ZED-ZEN's terms and privacy pages (src/zen/config.ts), not t3.codes.
const PRIVACY_POLICY_URL = ZEN_MOBILE_PRIVACY_URL;
const SECURITY_POLICY_URL = ZEN_MOBILE_SECURITY_URL;
const TERMS_OF_SERVICE_URL = ZEN_MOBILE_LEGAL_URL;
export const LEGAL_URL = ZEN_MOBILE_LEGAL_URL;

const ALLOWED_LEGAL_DOCUMENT_URLS = [
  LEGAL_URL,
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
  SECURITY_POLICY_URL,
] as const;

function webDocumentIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

const ALLOWED_LEGAL_DOCUMENT_IDENTITIES = new Set(
  ALLOWED_LEGAL_DOCUMENT_URLS.map(webDocumentIdentity).filter(
    (value): value is string => value !== null,
  ),
);

export function isLegalDocumentUrl(value: string): boolean {
  const identity = webDocumentIdentity(value);
  return identity !== null && ALLOWED_LEGAL_DOCUMENT_IDENTITIES.has(identity);
}
