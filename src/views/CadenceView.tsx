import { InventoryItem } from '../types';
import { Icons } from '../components/Icons';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

interface CadenceViewProps {
  inventory: InventoryItem[];
}

export const CadenceView: React.FC<CadenceViewProps> = ({ inventory }) => {
  const chartData = inventory.map(item => ({
    name: item.name.substring(0, 15) + (item.name.length > 15 ? '...' : ''),
    full_name: item.name,
    cadence: Math.round(item.averageCadenceDays),
    qty: item.recommendedOrderQty
  })).sort((a, b) => a.cadence - b.cadence);

  if (inventory.length === 0) return <div className="text-arda-500 p-10 text-center">No data for analysis.</div>;

  return (
    <div className="space-y-6">
       <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Cadence Analysis</h2>
        <p className="text-arda-500 text-sm">Frequency of purchase per item (Days)</p>
      </div>

      <div className="bg-arda-800 border border-arda-700 rounded-lg p-6 h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" horizontal={false} />
            <XAxis type="number" stroke="#8b949e" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis 
              dataKey="name" 
              type="category" 
              stroke="#8b949e" 
              fontSize={11} 
              tickLine={false} 
              axisLine={false} 
              width={120}
            />
            <Tooltip 
              cursor={{fill: '#21262d'}}
              contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#fff' }}
              itemStyle={{ color: '#58a6ff' }}
            />
            <Bar dataKey="cadence" fill="#58a6ff" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.cadence < 14 ? '#f85149' : '#58a6ff'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-arda-800 p-4 rounded border border-arda-700 flex items-start gap-4">
           <div className="bg-arda-900 p-2 rounded">
             <Icons.TrendingUp className="text-arda-success w-5 h-5" />
           </div>
           <div>
             <div className="text-sm text-arda-500">Fastest Mover</div>
             <div className="text-white font-medium">{chartData[0]?.full_name || '-'}</div>
             <div className="text-xs text-arda-500 mt-1">Ordered every {chartData[0]?.cadence || 0} days</div>
           </div>
        </div>
        <div className="bg-arda-800 p-4 rounded border border-arda-700 flex items-start gap-4">
           <div className="bg-arda-900 p-2 rounded">
             <Icons.Calendar className="text-arda-accent w-5 h-5" />
           </div>
           <div>
             <div className="text-sm text-arda-500">Slowest Mover</div>
             <div className="text-white font-medium">{chartData[chartData.length - 1]?.full_name || '-'}</div>
             <div className="text-xs text-arda-500 mt-1">Ordered every {chartData[chartData.length - 1]?.cadence || 0} days</div>
           </div>
        </div>
      </div>
    </div>
  );
};
