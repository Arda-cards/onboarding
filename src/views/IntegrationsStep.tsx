import { Icons } from '../components/Icons';

interface Integration {
  name: string;
  category: 'erp' | 'inventory' | 'accounting';
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
  {
    name: 'QuickBooks',
    category: 'accounting',
    description: 'Accounting, bookkeeping, and financial reporting.',
  },
  {
    name: 'Xero',
    category: 'accounting',
    description: 'Cloud accounting and reconciliation platform.',
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
  accounting: {
    title: 'Accounting Platforms',
    icon: Icons.FileSpreadsheet,
  },
} as const;

export const IntegrationsStep: React.FC = () => {
  const grouped = {
    erp: INTEGRATIONS.filter(integration => integration.category === 'erp'),
    inventory: INTEGRATIONS.filter(integration => integration.category === 'inventory'),
    accounting: INTEGRATIONS.filter(integration => integration.category === 'accounting'),
  };

  return (
    <div className="space-y-6">
      <section className="arda-glass rounded-2xl p-6 border border-arda-border/80">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-arda-accent">
            <Icons.Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-arda-text-primary">Integrations</h2>
            <p className="text-sm text-arda-text-secondary mt-1 max-w-3xl">
              Integrations are managed on this page. Connect cloud ERPs, inventory point solutions,
              and accounting platforms to centralize item, vendor, and purchasing data.
            </p>
          </div>
        </div>
      </section>

      {(Object.keys(grouped) as Array<keyof typeof grouped>).map(category => {
        const config = CATEGORY_CONFIG[category];
        const CategoryIcon = config.icon;

        return (
          <section key={category} className="bg-white border border-arda-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <CategoryIcon className="w-4 h-4 text-arda-accent" />
              <h3 className="text-sm font-semibold text-arda-text-primary">{config.title}</h3>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[category].map(integration => (
                <article
                  key={integration.name}
                  className="rounded-xl border border-arda-border bg-arda-bg-secondary/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm text-arda-text-primary">{integration.name}</p>
                    <span className="text-[11px] font-medium rounded-full border border-arda-border px-2 py-0.5 text-arda-text-muted">
                      Coming soon
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-arda-text-secondary leading-relaxed">
                    {integration.description}
                  </p>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
