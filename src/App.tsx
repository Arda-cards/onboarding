import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { IngestionEngine } from './views/IngestionEngine';
import { Dashboard } from './views/Dashboard';
import { InventoryView } from './views/InventoryView';
import { CadenceView } from './views/CadenceView';
import { ComposeEmail } from './views/ComposeEmail';
import { ExtractedOrder, InventoryItem, GoogleUserProfile } from './types';
import { processOrdersToInventory } from './utils/inventoryLogic';

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  
  // Configuration State - Initialize from LocalStorage if available
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('arda_gemini_key') || '');
  const [clientId, setClientId] = useState(() => localStorage.getItem('arda_client_id') || '');
  
  // Connection State
  const [gmailToken, setGmailToken] = useState('');
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  const [isMockConnected, setIsMockConnected] = useState(false);

  // Data State
  const [orders, setOrders] = useState<ExtractedOrder[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
  // Email Draft State for integrated reordering
  const [emailDraft, setEmailDraft] = useState<{ to: string, subject: string, body: string } | null>(null);

  // Keyboard shortcuts for power users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      switch (e.key) {
        case '1':
          setActiveView('dashboard');
          break;
        case '2':
          setActiveView('ingest');
          break;
        case '3':
          setActiveView('inventory');
          break;
        case '4':
          setActiveView('analysis');
          break;
        case '5':
          setActiveView('compose');
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem('arda_gemini_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('arda_client_id', clientId);
  }, [clientId]);

  // When orders update, recalculate inventory stats
  useEffect(() => {
    if (orders.length > 0) {
      const inv = processOrdersToInventory(orders);
      setInventory(inv);
    }
  }, [orders]);

  const handleOrdersProcessed = (newOrders: ExtractedOrder[]) => {
    setOrders(newOrders);
  };

  const handleReorder = (item: InventoryItem) => {
    const draft = {
      to: `${item.supplier.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      subject: `Restock Request: ${item.name}`,
      body: `Hello ${item.supplier} Team,\n\nWe would like to place a restock order for the following item:\n\n- Item: ${item.name}\n- Quantity: ${item.recommendedOrderQty}\n\nPlease confirm availability and send over an updated invoice.\n\nBest regards,\n${userProfile?.name || 'Inventory Management'}`
    };
    setEmailDraft(draft);
    setActiveView('compose');
  };

  // Handler for inline editing inventory items
  const handleUpdateInventoryItem = (id: string, updates: Partial<InventoryItem>) => {
    setInventory(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard orders={orders} inventory={inventory} onReorder={handleReorder} />;
      case 'ingest':
        return (
          <IngestionEngine 
            userProfile={userProfile}
            setUserProfile={setUserProfile}
            isMockConnected={isMockConnected}
            setIsMockConnected={setIsMockConnected}
            onOrdersProcessed={handleOrdersProcessed} 
          />
        );
      case 'inventory':
        return (
          <InventoryView 
            inventory={inventory} 
            onReorder={handleReorder}
            onUpdateItem={handleUpdateInventoryItem}
          />
        );
      case 'analysis':
        return <CadenceView inventory={inventory} />;
      case 'compose':
        return (
          <ComposeEmail 
            gmailToken={gmailToken} 
            isMockConnected={isMockConnected} 
            prefill={emailDraft}
            onClearDraft={() => setEmailDraft(null)}
            apiKey={apiKey}
          />
        );
      default:
        return <Dashboard orders={orders} inventory={inventory} onReorder={handleReorder} />;
    }
  };

  return (
    <div className="min-h-screen bg-arda-bg-secondary text-arda-text-primary font-sans">
      <Sidebar activeView={activeView} onChangeView={setActiveView} />
      <main className="pl-64">
        <div className="max-w-7xl mx-auto p-8">
          {renderView()}
        </div>
      </main>
    </div>
  );
}
