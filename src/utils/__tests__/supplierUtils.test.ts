import { describe, expect, it } from 'vitest';
import { DiscoveredSupplier } from '../../services/api';
import {
  canonicalizePrioritySupplierDomain,
  isPrioritySupplierDomain,
  OTHER_PRIORITY_SUPPLIERS,
} from '../../views/supplierSetupUtils';
import { mergeSuppliers } from '../supplierUtils';

describe('mergeSuppliers', () => {
  it('collapses priority aliases into canonical priority suppliers', () => {
    const discoveredSuppliers: DiscoveredSupplier[] = [
      {
        domain: 'mcmaster-carr.com',
        displayName: 'McMaster-Carr',
        emailCount: 2,
        score: 88,
        category: 'industrial',
        sampleSubjects: ['Order A'],
        isRecommended: true,
      },
      {
        domain: 'mcmaster.com',
        displayName: 'McMaster',
        emailCount: 3,
        score: 80,
        category: 'industrial',
        sampleSubjects: ['Order B'],
        isRecommended: true,
      },
      {
        domain: 'fastenal.com',
        displayName: 'Fastenal',
        emailCount: 4,
        score: 75,
        category: 'industrial',
        sampleSubjects: ['Fastenal Order'],
        isRecommended: true,
      },
    ];

    const merged = mergeSuppliers(OTHER_PRIORITY_SUPPLIERS, discoveredSuppliers, {
      canonicalizeDomain: canonicalizePrioritySupplierDomain,
    });

    const mcmaster = merged.find((supplier) => supplier.domain === 'mcmaster.com');
    expect(mcmaster).toBeDefined();
    expect(mcmaster?.emailCount).toBe(5);
    expect(mcmaster?.sampleSubjects).toEqual(expect.arrayContaining(['Order A', 'Order B']));

    const selectableOtherSuppliers = merged.filter(
      (supplier) => !isPrioritySupplierDomain(supplier.domain) && !supplier.domain.includes('amazon'),
    );
    expect(selectableOtherSuppliers.map((supplier) => supplier.domain)).toEqual(['fastenal.com']);
  });
});
