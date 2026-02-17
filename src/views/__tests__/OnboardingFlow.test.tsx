import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../SupplierSetup', () => ({
  SupplierSetup: ({ onCanProceed }: { onCanProceed?: (canProceed: boolean) => void }) => (
    <div>
      <div>supplier-setup</div>
      <button type="button" onClick={() => onCanProceed?.(true)}>
        enable-email-continue
      </button>
    </div>
  ),
}));

vi.mock('../BarcodeScanStep', () => ({
  BarcodeScanStep: () => <div>barcode-step</div>,
}));

vi.mock('../PhotoCaptureStep', () => ({
  PhotoCaptureStep: () => <div>photo-step</div>,
}));

vi.mock('../CSVUploadStep', () => ({
  CSVUploadStep: () => <div>csv-step</div>,
}));

vi.mock('../MasterListStep', () => ({
  MasterListStep: () => <div>masterlist-step</div>,
}));

vi.mock('../ArdaSyncStep', () => ({
  ArdaSyncStep: () => <div>sync-step</div>,
}));

import { OnboardingFlow } from '../OnboardingFlow';

describe('OnboardingFlow email continuation reminder', () => {
  it('shows the reminder on the email step', () => {
    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    expect(
      screen.getByText('Continuing won’t stop email scanning. Import keeps running in the background.'),
    ).toBeInTheDocument();
  });

  it('hides the reminder after advancing to barcode step', async () => {
    const user = userEvent.setup();

    render(<OnboardingFlow onComplete={vi.fn()} onSkip={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'enable-email-continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('barcode-step')).toBeInTheDocument();
    expect(
      screen.queryByText('Continuing won’t stop email scanning. Import keeps running in the background.'),
    ).not.toBeInTheDocument();
  });
});
