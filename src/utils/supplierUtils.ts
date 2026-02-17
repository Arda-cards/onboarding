import { DiscoveredSupplier } from '../services/api';

interface MergeSuppliersOptions {
  canonicalizeDomain?: (domain: string) => string;
}

function uniqueSampleSubjects(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.flat().forEach((subject) => {
    if (!subject || seen.has(subject)) return;
    seen.add(subject);
    merged.push(subject);
  });

  return merged;
}

export function mergeSuppliers(
  prioritySuppliers: DiscoveredSupplier[],
  discoveredSuppliers: DiscoveredSupplier[],
  options?: MergeSuppliersOptions,
): DiscoveredSupplier[] {
  const canonicalizeDomain = options?.canonicalizeDomain ?? ((domain: string) => domain);
  const merged = new Map<string, DiscoveredSupplier>();
  const priorityDomains = new Set<string>();

  prioritySuppliers.forEach((supplier) => {
    const canonicalDomain = canonicalizeDomain(supplier.domain);
    priorityDomains.add(canonicalDomain);
    merged.set(canonicalDomain, { ...supplier, domain: canonicalDomain });
  });

  discoveredSuppliers
    .map((supplier) => ({
      ...supplier,
      domain: canonicalizeDomain(supplier.domain),
    }))
    .filter((supplier) => !supplier.domain.includes('amazon'))
    .forEach((supplier) => {
      if (merged.has(supplier.domain)) {
        const existing = merged.get(supplier.domain)!;
        merged.set(supplier.domain, {
          ...existing,
          emailCount: existing.emailCount + supplier.emailCount,
          score: Math.max(existing.score, supplier.score),
          category: existing.category !== 'unknown' ? existing.category : supplier.category,
          sampleSubjects: uniqueSampleSubjects(existing.sampleSubjects, supplier.sampleSubjects).slice(0, 5),
          isRecommended: existing.isRecommended || supplier.isRecommended,
        });
      } else {
        merged.set(supplier.domain, supplier);
      }
    });

  return Array.from(merged.values()).sort((a, b) => {
    const aPriority = priorityDomains.has(a.domain);
    const bPriority = priorityDomains.has(b.domain);
    if (aPriority && !bPriority) return -1;
    if (!aPriority && bPriority) return 1;
    return b.score - a.score;
  });
}
