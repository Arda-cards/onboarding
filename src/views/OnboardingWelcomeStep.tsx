import { Icons } from '../components/Icons';
import { API_BASE_URL } from '../services/api';

interface WelcomeStepItem {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Icons;
  group: 'required' | 'optional';
  estimatedTime: string;
  bestFor: string;
  valueLabel: string;
  status: 'not_started' | 'in_progress' | 'ready' | 'optional' | 'done';
}

interface OnboardingWelcomeStepProps {
  steps: WelcomeStepItem[];
  userProfile?: { name?: string; email?: string };
  onStartEmailSync: () => void;
  onSkipEmail: () => void;
  isGmailConnected: boolean;
}

export const OnboardingWelcomeStep: React.FC<OnboardingWelcomeStepProps> = ({
  steps,
  userProfile,
  onStartEmailSync,
  onSkipEmail,
  isGmailConnected,
}) => {
  const firstName = userProfile?.name?.split(' ')[0];
  const requiredSteps = steps.filter(step => step.group === 'required');
  const optionalSteps = steps.filter(step => step.group === 'optional');

  const renderStepGroup = (
    title: string,
    subtitle: string,
    items: WelcomeStepItem[],
  ) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-arda-text-primary">{title}</h3>
          <p className="text-xs text-arda-text-secondary mt-1">{subtitle}</p>
        </div>
        <span className="text-xs text-arda-text-muted">{items.length} step{items.length === 1 ? '' : 's'}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((step) => {
          const Icon = Icons[step.icon] || Icons.Circle;
          const statusTone = step.status === 'done'
            ? 'bg-arda-success-bg text-arda-success-text border-arda-success-border'
            : step.status === 'ready' || step.status === 'in_progress'
              ? 'bg-arda-warning-bg text-arda-warning-text border-arda-warning-border'
              : 'bg-arda-bg-secondary text-arda-text-secondary border-arda-border';

          return (
            <div key={step.id} className="card-arda p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-arda-bg-tertiary border border-arda-border flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-arda-text-secondary" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-base font-semibold text-arda-text-primary">{step.title}</h4>
                    <p className="text-sm text-arda-text-secondary mt-1">{step.description}</p>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[11px] font-medium whitespace-nowrap ${statusTone}`}>
                  {step.group === 'required' ? 'Required' : 'Optional'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-arda-bg-secondary px-3 py-2">
                  <div className="text-arda-text-muted uppercase tracking-wide">Time</div>
                  <div className="mt-1 font-medium text-arda-text-primary">{step.estimatedTime}</div>
                </div>
                <div className="rounded-lg bg-arda-bg-secondary px-3 py-2">
                  <div className="text-arda-text-muted uppercase tracking-wide">Best for</div>
                  <div className="mt-1 font-medium text-arda-text-primary">{step.bestFor}</div>
                </div>
                <div className="rounded-lg bg-arda-bg-secondary px-3 py-2">
                  <div className="text-arda-text-muted uppercase tracking-wide">Outcome</div>
                  <div className="mt-1 font-medium text-arda-text-primary">{step.valueLabel}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const handleStartEmailSync = () => {
    if (isGmailConnected) {
      onStartEmailSync();
    } else {
      // Link Gmail via Google OAuth, then return to start email sync
      window.location.href = `${API_BASE_URL}/auth/google?returnTo=email`;
    }
  };

  return (
    <div className="space-y-6">
      <div className="card-arda p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-arda-warning-bg border border-arda-warning-border flex items-center justify-center flex-shrink-0">
            <Icons.Sparkles className="w-6 h-6 text-arda-accent" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-arda-text-primary">
              {firstName ? `${firstName}, import your first items from email in a few minutes.` : 'Import your first items from email in a few minutes.'}
            </h2>
            <p className="text-sm text-arda-text-secondary mt-2 max-w-2xl">
              Start with the required email flow, then add more items from purchase orders, product URLs, barcodes, photos, or CSV only if you need them.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-arda-warning-border bg-arda-warning-bg px-3 py-1 text-xs font-medium text-arda-warning-text">
              <Icons.Mail className="w-3.5 h-3.5" />
              Fastest path: Gmail import first
            </div>
          </div>
        </div>
      </div>

      {renderStepGroup(
        'Required to get started',
        'These steps get your first usable inventory data into Arda.',
        requiredSteps,
      )}

      {renderStepGroup(
        'Optional ways to add more items',
        'Use any of these when email import misses items or you want more sources.',
        optionalSteps,
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleStartEmailSync}
          className="btn-arda-primary flex items-center justify-center gap-2 px-6 py-3"
        >
          <Icons.Mail className="w-4 h-4" />
          {isGmailConnected ? 'Start with email import' : 'Connect Gmail and start email import'}
        </button>
        <button
          type="button"
          onClick={onSkipEmail}
          className="btn-arda-outline flex items-center justify-center gap-2 px-6 py-3 text-arda-text-secondary"
        >
          <Icons.ArrowRight className="w-4 h-4" />
          Skip to manual import options
        </button>
      </div>
    </div>
  );
};
