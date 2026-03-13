const MAX_SUPPLIERS = 25;

const DEFAULT_SUBJECT_KEYWORDS = [
  'order',
  'invoice',
  'receipt',
  'confirmation',
  'shipment',
  'purchase',
  'payment',
];

const PRIORITY_SUBJECT_KEYWORDS = [
  'order',
  'invoice',
  'receipt',
  'confirmation',
  'acknowledgment',
  'acknowledgement',
  'shipment',
  'shipped',
  'delivered',
  'purchase',
  'payment',
  'order status',
  'purchase order',
];

const PRIORITY_SUPPLIER_ALIASES: Record<string, string[]> = {
  'mcmaster.com': ['mcmaster.com', 'mcmaster-carr.com'],
  'uline.com': ['uline.com'],
};

const PRIORITY_ALIAS_TO_CANONICAL = Object.entries(PRIORITY_SUPPLIER_ALIASES)
  .flatMap(([canonicalDomain, aliases]) =>
    aliases.map((alias) => [alias, canonicalDomain] as const),
  )
  .reduce<Record<string, string>>((map, [alias, canonicalDomain]) => {
    map[alias] = canonicalDomain;
    return map;
  }, {});

export type SupplierQueryMode = 'strict' | 'fallback';

function formatAfterDate(monthsLookback: number, now: Date = new Date()): string {
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - monthsLookback);
  return fromDate.toISOString().split('T')[0].replace(/-/g, '/');
}

function quoteKeyword(keyword: string): string {
  return keyword.includes(' ') ? `"${keyword}"` : keyword;
}

export function sanitizeSupplierDomains(domains: unknown): string[] {
  if (!Array.isArray(domains)) return [];

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const domain of domains) {
    const normalized = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
    const isValid = normalized.length > 2 && normalized.includes('.') && !normalized.includes(' ');
    if (!isValid || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= MAX_SUPPLIERS) break;
  }

  return deduped;
}

export function expandPrioritySupplierDomains(domains: string[]): string[] {
  const normalizedDomains = sanitizeSupplierDomains(domains);
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const domain of normalizedDomains) {
    const canonical = PRIORITY_ALIAS_TO_CANONICAL[domain];
    const group = canonical ? PRIORITY_SUPPLIER_ALIASES[canonical] : [domain];

    for (const alias of group) {
      if (seen.has(alias)) continue;
      seen.add(alias);
      expanded.push(alias);
    }
  }

  return expanded;
}

export function getSupplierLookbackMonths(jobType?: string): number {
  return jobType === 'priority' ? 12 : 6;
}

interface BuildSupplierJobQueryParams {
  supplierDomains: string[];
  jobType?: string;
  mode?: SupplierQueryMode;
  now?: Date;
}

export function buildSupplierJobQuery({
  supplierDomains,
  jobType,
  mode = 'strict',
  now,
}: BuildSupplierJobQueryParams): string {
  const normalizedDomains = sanitizeSupplierDomains(supplierDomains);
  if (normalizedDomains.length === 0) return '';

  const fromClause = normalizedDomains.map((domain) => `from:${domain}`).join(' OR ');
  const lookbackMonths = getSupplierLookbackMonths(jobType);
  const afterDate = formatAfterDate(lookbackMonths, now);

  if (mode === 'fallback') {
    return `(${fromClause}) after:${afterDate}`;
  }

  const keywords = jobType === 'priority' ? PRIORITY_SUBJECT_KEYWORDS : DEFAULT_SUBJECT_KEYWORDS;
  const subjectClause = keywords.map(quoteKeyword).join(' OR ');
  return `(${fromClause}) subject:(${subjectClause}) after:${afterDate}`;
}
