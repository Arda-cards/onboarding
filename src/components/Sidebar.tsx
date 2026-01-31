import { NAV_ITEMS, APP_NAME } from '../constants';
import { Icons } from './Icons';

interface SidebarProps {
  activeView: string;
  onChangeView: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onChangeView }) => {
  return (
    <div className="w-64 h-screen bg-white border-r border-arda-border flex flex-col fixed left-0 top-0 z-20">
      <div className="p-6 border-b border-arda-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-arda-accent rounded-lg flex items-center justify-center">
            <Icons.Package className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-arda-text-primary tracking-tight">{APP_NAME}</h1>
        </div>
        <p className="text-xs text-arda-text-muted mt-2 font-mono">v1.0.4-alpha</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = Icons[item.icon as keyof typeof Icons];
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-orange-50 text-arda-accent'
                  : 'text-arda-text-secondary hover:text-arda-text-primary hover:bg-arda-bg-tertiary'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-arda-accent' : ''}`} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-arda-border">
        <button className="flex items-center gap-3 text-arda-text-secondary hover:text-arda-text-primary text-sm font-medium w-full px-4 py-2 rounded-lg hover:bg-arda-bg-tertiary transition-colors">
          <Icons.Settings className="w-5 h-5" />
          Settings
        </button>
      </div>
    </div>
  );
};
