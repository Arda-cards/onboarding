import { InventoryItem, ExtractedOrder } from '../types';
import { Icons } from '../components/Icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, LineChart, Line, Legend } from 'recharts';

interface CadenceViewProps {
  inventory: InventoryItem[];
  orders?: ExtractedOrder[];
}

export const CadenceView: React.FC<CadenceViewProps> = ({ inventory, orders = [] }) => {
  // Cadence chart data (days between orders)
  const cadenceData = inventory
    .map(item => ({
      name: item.name.substring(0, 15) + (item.name.length > 15 ? '...' : ''),
      fullName: item.name,
      cadence: Math.round(item.averageCadenceDays),
      orderCount: item.orderCount,
    }))
    .sort((a, b) => a.cadence - b.cadence)
    .slice(0, 10); // Top 10

  // Velocity chart data (units per day - consumption rate)
  const velocityData = inventory
    .map(item => ({
      name: item.name.substring(0, 15) + (item.name.length > 15 ? '...' : ''),
      fullName: item.name,
      velocity: parseFloat(item.dailyBurnRate.toFixed(2)),
      supplier: item.supplier,
    }))
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 10); // Top 10 fastest movers

  // Build complete line item history from inventory
  const lineItemHistory = inventory
    .flatMap(item =>
      item.history.map(h => ({
        date: h.date,
        itemName: item.name,
        supplier: item.supplier,
        quantity: h.quantity,
        unitPrice: item.lastPrice,
      }))
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 50); // Last 50 transactions

  // Summary stats
  const totalItems = inventory.length;
  const avgCadence = inventory.length > 0
    ? Math.round(inventory.reduce((sum, i) => sum + i.averageCadenceDays, 0) / inventory.length)
    : 0;
  const totalOrders = inventory.reduce((sum, i) => sum + i.orderCount, 0);
  const fastestMover = velocityData[0];

  if (inventory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-arda-500">
        <Icons.TrendingUp className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-lg">No order data for analysis</p>
        <p className="text-sm mt-2">Process emails from the Ingestion Engine to see analytics</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Cadence & Velocity Analysis</h2>
          <p className="text-arda-500 text-sm">Purchase patterns and consumption rates</p>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-arda-800 p-4 rounded-lg border border-arda-700">
          <div className="flex items-center gap-3">
            <div className="bg-arda-900 p-2 rounded">
              <Icons.Package className="text-arda-accent w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{totalItems}</div>
              <div className="text-xs text-arda-500">Unique Items Tracked</div>
            </div>
          </div>
        </div>
        <div className="bg-arda-800 p-4 rounded-lg border border-arda-700">
          <div className="flex items-center gap-3">
            <div className="bg-arda-900 p-2 rounded">
              <Icons.Calendar className="text-blue-400 w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{avgCadence} days</div>
              <div className="text-xs text-arda-500">Avg Order Cadence</div>
            </div>
          </div>
        </div>
        <div className="bg-arda-800 p-4 rounded-lg border border-arda-700">
          <div className="flex items-center gap-3">
            <div className="bg-arda-900 p-2 rounded">
              <Icons.Inbox className="text-green-400 w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{totalOrders}</div>
              <div className="text-xs text-arda-500">Total Line Items</div>
            </div>
          </div>
        </div>
        <div className="bg-arda-800 p-4 rounded-lg border border-arda-700">
          <div className="flex items-center gap-3">
            <div className="bg-arda-900 p-2 rounded">
              <Icons.TrendingUp className="text-orange-400 w-5 h-5" />
            </div>
            <div>
              <div className="text-lg font-bold text-white truncate max-w-[150px]" title={fastestMover?.fullName}>
                {fastestMover?.fullName.substring(0, 16) || '-'}
              </div>
              <div className="text-xs text-arda-500">Fastest Mover ({fastestMover?.velocity}/day)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cadence Chart */}
        <div className="bg-arda-800 border border-arda-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Order Cadence (Days)</h3>
          <p className="text-arda-500 text-xs mb-4">Average days between orders per item</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cadenceData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" horizontal={false} />
                <XAxis type="number" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#8b949e"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  cursor={{ fill: '#21262d' }}
                  contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#fff' }}
                  formatter={(value, name, props) => [
                    `${value} days (${(props.payload as any).orderCount} orders)`,
                    (props.payload as any).fullName
                  ]}
                />
                <Bar dataKey="cadence" fill="#58a6ff" radius={[0, 4, 4, 0]} barSize={18}>
                  {cadenceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.cadence < 14 ? '#f85149' : '#58a6ff'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Velocity Chart */}
        <div className="bg-arda-800 border border-arda-700 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Consumption Velocity</h3>
          <p className="text-arda-500 text-xs mb-4">Units consumed per day (burn rate)</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocityData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" horizontal={false} />
                <XAxis type="number" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#8b949e"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip
                  cursor={{ fill: '#21262d' }}
                  contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#fff' }}
                  formatter={(value, name, props) => [
                    `${value} units/day`,
                    (props.payload as any).fullName
                  ]}
                />
                <Bar dataKey="velocity" fill="#3fb950" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Order Line Item History Table */}
      <div className="bg-arda-800 border border-arda-700 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-arda-700">
          <h3 className="text-lg font-semibold text-white">Order Line Item History</h3>
          <p className="text-arda-500 text-xs">Complete history of ordered items from emails</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-arda-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-arda-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-arda-500 uppercase tracking-wider">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-arda-500 uppercase tracking-wider">Item Name</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-arda-500 uppercase tracking-wider">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-arda-500 uppercase tracking-wider">Unit Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arda-700">
              {lineItemHistory.map((item, idx) => (
                <tr key={idx} className="hover:bg-arda-700/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-arda-400">
                    {new Date(item.date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{item.supplier}</td>
                  <td className="px-4 py-3 text-sm text-white font-medium">{item.itemName}</td>
                  <td className="px-4 py-3 text-sm text-arda-400 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-sm text-arda-400 text-right">
                    {item.unitPrice > 0 ? `$${item.unitPrice.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
              {lineItemHistory.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-arda-500">
                    No order history yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
