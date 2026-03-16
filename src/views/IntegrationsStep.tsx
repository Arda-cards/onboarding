import { useCallback, useEffect, useMemo, useState } from 'react';
import { InstructionCard } from '../components/InstructionCard';
import { Icons } from '../components/Icons';
import {
  IntegrationConnection,
  IntegrationSyncRun,
  integrationsApi,
  isSessionExpiredError,
} from '../services/api';

interface Integration {
  name: string;
  category: 'erp' | 'inventory';
  description: string;
}

const INTEGRATIONS: Integration[] = [
  {
    name: 'NetSuite',
    category: 'erp',
    description: 'Cloud ERP for finance, operations, and supply chain.',
  },
  {
    name: 'Odoo',
    category: 'erp',
    description: 'Modular ERP platform for inventory, purchasing, and manufacturing.',
  },
  {
    name: 'Katana',
    category: 'inventory',
    description: 'Cloud inventory and manufacturing planning.',
  },
  {
    name: 'Fishbowl',
    category: 'inventory',
    description: 'Inventory and warehouse management with operations workflows.',
  },
  {
    name: 'Cin7',
    category: 'inventory',
    description: 'Multi-channel inventory and order orchestration.',
  },
  {
    name: 'Finale Inventory',
    category: 'inventory',
    description: 'Warehouse and inventory control with barcode operations.',
  },
  {
    name: 'SOS Inventory',
    category: 'inventory',
    description: 'Inventory and order management focused on SMB operations.',
  },
  {
    name: 'Sortly',
    category: 'inventory',
    description: 'Simple inventory tracking with mobile-first workflows.',
  },
];

const CATEGORY_CONFIG = {
  erp: {
    title: 'Cloud ERP',
    icon: Icons.Building2,
  },
  inventory: {
    title: 'Inventory Solutions',
    icon: Icons.Package,
  },
} as const;

const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
type LatestRun = IntegrationSyncRun | NonNullable<IntegrationConnection['lastRun']>;

function hasSyncCounts(run: LatestRun): run is IntegrationSyncRun {
  return 'ordersUpserted' in run && 'itemsUpserted' in run;
}

export const IntegrationsStep: React.FC = () => {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [runsByConnection, setRunsByConnection] = useState<Record<string, IntegrationSyncRun | undefined>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const getErrorMessage = useCallback((input: unknown, fallback: string): string => {
    if (isSessionExpiredError(input)) {
      return SESSION_EXPIRED_MESSAGE;
    }
    return input instanceof Error && input.message ? input.message : fallback;
  }, []);

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { connections: loadedConnections } = await integrationsApi.listConnections();
      setConnections(loadedConnections);

      const runPairs = await Promise.all(
        loadedConnections.map(async (connection) => {
          try {
            const { runs } = await integrationsApi.getConnectionRuns(connection.id);
            return [connection.id, runs[0]] as const;
          } catch {
            return [connection.id, undefined] as const;
          }
        }),
      );

      const nextRuns: Record<string, IntegrationSyncRun | undefined> = {};
      runPairs.forEach(([connectionId, run]) => {
        nextRuns[connectionId] = run;
      });
      setRunsByConnection(nextRuns);
    } catch (loadError) {
      const message = getErrorMessage(loadError, 'Failed to load accounting integrations.');
      if (!message.toLowerCase().includes('disabled')) {
        setError(message);
      }
      setConnections([]);
      setRunsByConnection({});
    } finally {
      setIsLoading(false);
    }
  }, [getErrorMessage]);

  const handleConnect = useCallback(async (provider: 'quickbooks' | 'xero') => {
    setActionKey(`connect:${provider}`);
    setError(null);
    setNotice(null);
    try {
      const { authUrl } = await integrationsApi.connectProvider(provider);
      window.location.assign(authUrl);
    } catch (connectError) {
      setError(getErrorMessage(connectError, `Failed to connect ${provider}.`));
    } finally {
      setActionKey(null);
    }
  }, [getErrorMessage]);

  const handleSync = useCallback(async (connectionId: string) => {
    setActionKey(`sync:${connectionId}`);
    setError(null);
    try {
      await integrationsApi.syncConnection(connectionId);
      setNotice('Sync started. Refreshing status shortly...');
      window.setTimeout(() => {
        void loadConnections();
      }, 2500);
    } catch (syncError) {
      setError(getErrorMessage(syncError, 'Failed to start provider sync.'));
    } finally {
      setActionKey(null);
    }
  }, [getErrorMessage, loadConnections]);

  const handleDisconnect = useCallback(async (connectionId: string) => {
    setActionKey(`disconnect:${connectionId}`);
    setError(null);
    try {
      await integrationsApi.disconnectConnection(connectionId);
      setNotice('Integration disconnected.');
      await loadConnections();
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError, 'Failed to disconnect integration.'));
    } finally {
      setActionKey(null);
    }
  }, [getErrorMessage, loadConnections]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration_provider');
    const status = params.get('integration_status');
    const reason = params.get('integration_reason');

    if (!provider || !status) return;

    if (status === 'connected') {
      setNotice(`${provider === 'quickbooks' ? 'QuickBooks' : 'Xero'} connected. Initial backfill started.`);
    } else {
      setError(reason || `Failed to connect ${provider}.`);
    }

    params.delete('integration_provider');
    params.delete('integration_status');
    params.delete('integration_reason');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, nextUrl);
  }, []);

  const connectionByProvider = useMemo(() => {
    const map = new Map<'quickbooks' | 'xero', IntegrationConnection>();
    for (const connection of connections) {
      if (connection.provider === 'quickbooks' || connection.provider === 'xero') {
        map.set(connection.provider, connection);
      }
    }
    return map;
  }, [connections]);

  const grouped = useMemo(() => ({
    erp: INTEGRATIONS.filter(integration => integration.category === 'erp'),
    inventory: INTEGRATIONS.filter(integration => integration.category === 'inventory'),
  }), []);

  return (
    <div className="space-y-6">
      <InstructionCard
        title="What to do"
        icon="Building2"
        steps={[
          'Connect QuickBooks or Xero if you want PO data.',
          'Start a sync to pull history.',
          'Continue when ready.',
        ]}
      />

      <section className="arda-glass rounded-2xl border border-arda-border/80 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-arda-warning-border bg-arda-warning-bg text-arda-accent">
            <Icons.Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-arda-text-primary">Integrations</h2>
            <p className="mt-1 max-w-3xl text-sm text-arda-text-secondary">
              Connect accounting platforms here. Step 1 now focuses only on email discovery.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border-2 border-arda-success-border bg-arda-success-bg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-arda-success-border bg-white px-3 py-1 text-xs font-medium text-arda-success-text">
              <Icons.Clock className="w-3.5 h-3.5" />
              Optional
            </div>
            <h3 className="text-xl font-bold text-arda-text-primary">Accounting Integrations</h3>
            <p className="text-sm text-arda-text-secondary">
              Import purchase orders from QuickBooks or Xero if email is not your only source.
            </p>
          </div>
          {isLoading && (
            <div className="flex items-center gap-2 text-arda-success-text text-sm">
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
              Refreshing
            </div>
          )}
        </div>

        {notice && (
          <div className="bg-arda-success-soft border border-arda-success-border rounded-lg px-3 py-2 text-sm text-arda-success-text">
            {notice}
          </div>
        )}

        {error && (
          <div className="bg-arda-danger-bg border border-arda-danger-border rounded-lg px-3 py-2 text-sm text-arda-danger-text">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['quickbooks', 'xero'] as const).map(provider => {
            const connection = connectionByProvider.get(provider);
            const latestRun: LatestRun | undefined = connection
              ? (runsByConnection[connection.id] || connection.lastRun)
              : undefined;
            const providerLabel = provider === 'quickbooks' ? 'QuickBooks' : 'Xero';
            const isConnected = Boolean(connection && connection.status === 'connected');
            const statusText = !connection
              ? 'Not connected'
              : connection.status === 'connected'
                ? `Connected${connection.tenantName ? ` • ${connection.tenantName}` : ''}`
                : connection.status === 'reauth_required'
                  ? 'Reconnect required'
                  : connection.status;
            const runSummary = latestRun
              ? latestRun.status === 'failed'
                ? latestRun.error || 'Last sync failed'
                : latestRun.status === 'running'
                  ? 'Sync in progress'
                  : (() => {
                    if (hasSyncCounts(latestRun)) {
                      return `Last sync: ${latestRun.ordersUpserted} orders, ${latestRun.itemsUpserted} items`;
                    }
                    return 'Last sync completed';
                  })()
              : 'No sync runs yet';

            const connectActionKey = `connect:${provider}`;
            const syncActionKey = connection ? `sync:${connection.id}` : '';
            const disconnectActionKey = connection ? `disconnect:${connection.id}` : '';

            return (
              <div key={provider} className="bg-white border border-arda-success-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icons.Link className="w-4 h-4 text-arda-success-text" />
                    <span className="font-semibold text-arda-text-primary">{providerLabel}</span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    isConnected ? 'bg-arda-success-soft text-arda-success-text' : 'bg-arda-bg-tertiary text-arda-text-secondary'
                  }`}>
                    {statusText}
                  </span>
                </div>

                <p className="text-sm font-medium text-arda-text-primary">Import purchase orders</p>
                <p className="text-xs text-arda-text-secondary">{runSummary}</p>

                <div className="flex items-center gap-2">
                  {!isConnected ? (
                    <button
                      type="button"
                      onClick={() => void handleConnect(provider)}
                      disabled={actionKey !== null}
                      className="btn-arda-primary !px-3 !py-2 !rounded-lg text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {actionKey === connectActionKey ? 'Connecting...' : connection?.status === 'reauth_required' ? `Reconnect ${providerLabel}` : `Connect ${providerLabel}`}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => connection && void handleSync(connection.id)}
                        disabled={actionKey !== null}
                        className="btn-arda-primary !px-3 !py-2 !rounded-lg text-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        <Icons.RefreshCw className={`w-3.5 h-3.5 ${actionKey === syncActionKey ? 'animate-spin' : ''}`} />
                        {actionKey === syncActionKey ? 'Syncing...' : 'Sync now'}
                      </button>
                      <button
                        type="button"
                        onClick={() => connection && void handleDisconnect(connection.id)}
                        disabled={actionKey !== null}
                        className="btn-arda-outline !px-3 !py-2 !rounded-lg text-sm text-arda-text-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {actionKey === disconnectActionKey ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-white border border-arda-border rounded-2xl p-5 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-semibold text-arda-text-primary">Coming soon</h3>
          <p className="mt-1 text-sm text-arda-text-secondary">
            These integrations are planned, but they are not actionable in onboarding yet.
          </p>
        </div>

        {(Object.keys(grouped) as Array<keyof typeof grouped>).map(category => {
          const config = CATEGORY_CONFIG[category];
          const CategoryIcon = config.icon;

          return (
            <section key={category} className="rounded-2xl border border-arda-border bg-arda-bg-secondary/20 p-5">
              <div className="mb-4 flex items-center gap-2">
                <CategoryIcon className="w-4 h-4 text-arda-accent" />
                <h3 className="text-sm font-semibold text-arda-text-primary">{config.title}</h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {grouped[category].map(integration => (
                  <article
                    key={integration.name}
                    className="rounded-xl border border-arda-border bg-white p-3 opacity-80"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-arda-text-primary">{integration.name}</p>
                      <span className="rounded-full border border-arda-border px-2 py-0.5 text-[11px] font-medium text-arda-text-muted">
                        Coming soon
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-arda-text-secondary">
                      {integration.description}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </section>
    </div>
  );
};
