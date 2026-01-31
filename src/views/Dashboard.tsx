import { InventoryItem, ExtractedOrder } from '../types';
import { Icons } from '../components/Icons';

interface DashboardProps {
  orders: ExtractedOrder[];
  inventory: InventoryItem[];
  onReorder: (item: InventoryItem) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ orders, inventory, onReorder }) => {
  const totalSpend = orders.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
  const activeSuppliers = new Set(inventory.map(i => i.supplier)).size;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-arda-text-primary">Overview</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard 
          title="Total Orders" 
          value={orders.length.toString()} 
          icon="Inbox"
          trend="+12%"
        />
        <StatsCard 
          title="Unique Items" 
          value={inventory.length.toString()} 
          icon="Package"
        />
        <StatsCard 
          title="Active Suppliers" 
          value={activeSuppliers.toString()} 
          icon="CheckCircle2"
        />
        <StatsCard 
          title="Est. Spend" 
          value={`$${totalSpend.toLocaleString()}`} 
          icon="DollarSign"
          highlight
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-arda-border rounded-xl shadow-arda p-6">
          <h3 className="text-lg font-semibold text-arda-text-primary mb-4">Recent Activity</h3>
          <div className="space-y-4">
            {orders.length === 0 ? (
               <div className="text-sm text-arda-text-muted italic">No orders processed yet.</div>
            ) : (
              orders.slice(0, 5).map((order) => (
                <div key={order.id} className="flex items-center justify-between border-b border-arda-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                      <Icons.Inbox className="w-4 h-4 text-arda-accent" />
                    </div>
                    <div>
                      <div className="text-arda-text-primary text-sm font-medium">{order.supplier}</div>
                      <div className="text-xs text-arda-text-muted">{new Date(order.orderDate).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-arda-text-primary text-sm font-mono font-semibold">${order.totalAmount?.toFixed(2)}</div>
                    <div className="text-xs text-arda-text-muted">{order.items.length} items</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white border border-arda-border rounded-xl shadow-arda p-6">
          <h3 className="text-lg font-semibold text-arda-text-primary mb-4">Reorder Alerts</h3>
          <div className="space-y-3">
             {inventory.filter(i => i.recommendedOrderQty > 5).length === 0 && (
                <div className="text-sm text-arda-text-muted">All stock levels healthy.</div>
             )}
             {inventory.filter(i => i.recommendedOrderQty > 5).slice(0, 5).map(item => (
               <div key={item.id} className="bg-red-50 p-3 rounded-lg border border-red-100 flex items-center justify-between group hover:shadow-arda transition-shadow">
                 <div className="truncate flex-1 pr-2">
                   <div className="text-sm text-arda-text-primary font-medium truncate">{item.name}</div>
                   <div className="text-xs text-arda-danger">Low Stock Alert</div>
                 </div>
                 <button 
                  onClick={() => onReorder(item)}
                  className="bg-arda-accent hover:bg-arda-accent-hover text-white w-8 h-8 rounded-lg flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-lg shadow-orange-500/20"
                  title="Quick Reorder"
                 >
                   <Icons.Send className="w-4 h-4" />
                 </button>
                 <div className="text-right group-hover:hidden">
                   <div className="text-xs text-arda-text-muted">Rec. Qty</div>
                   <div className="text-sm font-mono text-arda-accent font-semibold">{item.recommendedOrderQty}</div>
                 </div>
               </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
};

interface StatsCardProps {
  title: string;
  value: string;
  icon: keyof typeof Icons;
  trend?: string;
  highlight?: boolean;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, trend, highlight }) => {
  const Icon = Icons[icon];
  return (
    <div className={`p-6 rounded-xl border shadow-arda ${highlight ? 'bg-orange-50 border-orange-200' : 'bg-white border-arda-border'}`}>
      <div className="flex justify-between items-start mb-2">
        <span className="text-arda-text-secondary text-sm font-medium">{title}</span>
        <Icon className={`w-5 h-5 ${highlight ? 'text-arda-accent' : 'text-arda-text-muted'}`} />
      </div>
      <div className="text-2xl font-bold text-arda-text-primary tracking-tight">{value}</div>
      {trend && <div className="text-xs text-arda-success mt-1">{trend} from last month</div>}
    </div>
  );
};
