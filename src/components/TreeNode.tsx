import React from 'react';
import { Icons } from './Icons';
import { VelocityBadge } from './VelocityBadge';
import { ReorderSparkline } from './ReorderSparkline';
import { 
  JourneyNode, 
  JourneyNodeType, 
  VelocityNodeData,
  LineItemNodeData,
  OrderNodeData,
  EmailNodeData,
  ItemVelocityProfile
} from '../types';

interface TreeNodeProps {
  node: JourneyNode;
  level: number;
  velocityProfiles?: Map<string, ItemVelocityProfile>;
  onNodeClick?: (node: JourneyNode) => void;
  onExpandToggle?: (nodeId: string, isExpanded: boolean) => void;
  expandedNodes?: Set<string>;
  focusedNodeId?: string | null;
  onFocusChange?: (nodeId: string) => void;
}

const getNodeIcon = (type: JourneyNodeType) => {
  switch (type) {
    case 'email':
      return Icons.Mail;
    case 'order':
      return Icons.Package;
    case 'lineItem':
      return Icons.Box;
    case 'velocity':
      return Icons.Activity;
    default:
      return Icons.FileText;
  }
};

const getNodeColors = (type: JourneyNodeType) => {
  switch (type) {
    case 'email':
      return {
        iconBg: 'bg-blue-500/20',
        iconColor: 'text-blue-400',
        border: 'border-blue-500/30',
      };
    case 'order':
      return {
        iconBg: 'bg-green-500/20',
        iconColor: 'text-green-400',
        border: 'border-green-500/30',
      };
    case 'lineItem':
      return {
        iconBg: 'bg-purple-500/20',
        iconColor: 'text-purple-400',
        border: 'border-purple-500/30',
      };
    case 'velocity':
      return {
        iconBg: 'bg-orange-500/20',
        iconColor: 'text-orange-400',
        border: 'border-orange-500/30',
      };
    default:
      return {
        iconBg: 'bg-slate-500/20',
        iconColor: 'text-slate-400',
        border: 'border-slate-500/30',
      };
  }
};

export const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level,
  velocityProfiles,
  onNodeClick,
  onExpandToggle,
  expandedNodes,
  focusedNodeId,
  onFocusChange,
}) => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes?.has(node.id) ?? (node.isExpanded ?? level < 2);
  const isFocused = focusedNodeId === node.id;
  
  const Icon = getNodeIcon(node.type);
  const colors = getNodeColors(node.type);
  
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = !isExpanded;
    onExpandToggle?.(node.id, newExpanded);
  };
  
  const handleClick = () => {
    onFocusChange?.(node.id);
    onNodeClick?.(node);
  };

  const handleMouseEnter = () => {
    onFocusChange?.(node.id);
  };

  // Get velocity profile for line items
  const getVelocityProfileForNode = (): ItemVelocityProfile | undefined => {
    if (node.type === 'lineItem' && velocityProfiles) {
      const data = node.data as LineItemNodeData;
      return velocityProfiles.get(data.normalizedName);
    }
    return undefined;
  };

  const velocityProfile = getVelocityProfileForNode();

  return (
    <div className="select-none">
      {/* Node Row */}
      <div 
        data-node-id={node.id}
        className={`
          flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer
          hover:bg-slate-800/50 transition-colors group
          ${level === 0 ? 'bg-slate-800/30' : ''}
          ${isFocused ? 'ring-2 ring-arda-accent ring-offset-2 ring-offset-slate-900 bg-slate-800/70' : ''}
        `}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
      >
        {/* Expand/Collapse Button */}
        <button
          onClick={handleToggle}
          className={`
            w-5 h-5 flex items-center justify-center rounded
            hover:bg-slate-700 transition-colors
            ${hasChildren ? 'visible' : 'invisible'}
          `}
        >
          {isExpanded ? (
            <Icons.ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <Icons.ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </button>
        
        {/* Node Icon */}
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colors.iconBg}`}>
          <Icon className={`w-4 h-4 ${colors.iconColor}`} />
        </div>
        
        {/* Node Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-200 truncate">
              {node.label}
            </span>
            
            {/* Inline velocity badge for line items */}
            {node.type === 'lineItem' && velocityProfile && (
              <VelocityBadge
                dailyBurnRate={velocityProfile.dailyBurnRate}
                averageCadenceDays={velocityProfile.averageCadenceDays}
                orderCount={velocityProfile.orderCount}
                compact
              />
            )}
          </div>
          
          {node.subtitle && (
            <div className="text-xs text-slate-500 truncate">
              {node.subtitle}
            </div>
          )}
        </div>
        
        {/* Sparkline for line items */}
        {node.type === 'lineItem' && velocityProfile && velocityProfile.orders.length >= 2 && (
          <div className="hidden group-hover:block">
            <ReorderSparkline
              orders={velocityProfile.orders.map(o => ({
                date: o.date,
                quantity: o.quantity,
              }))}
              width={80}
              height={20}
            />
          </div>
        )}
        
        {/* Order amount badge */}
        {node.type === 'order' && (node.data as OrderNodeData)?.totalAmount && (
          <span className="text-sm font-medium text-green-400">
            ${((node.data as OrderNodeData).totalAmount || 0).toFixed(2)}
          </span>
        )}
        
        {/* Date for emails */}
        {node.type === 'email' && (node.data as EmailNodeData)?.date && (
          <span className="text-xs text-slate-500">
            {new Date((node.data as EmailNodeData).date).toLocaleDateString()}
          </span>
        )}
      </div>
      
      {/* Velocity Detail Node (special rendering) */}
      {node.type === 'velocity' && (
        <div 
          className="ml-4 py-2 px-3"
          style={{ paddingLeft: `${level * 20 + 28}px` }}
        >
          <VelocityBadge
            dailyBurnRate={(node.data as VelocityNodeData).dailyBurnRate}
            averageCadenceDays={(node.data as VelocityNodeData).averageCadenceDays}
            orderCount={(node.data as VelocityNodeData).orderCount}
            nextPredictedOrder={(node.data as VelocityNodeData).nextPredictedOrder}
          />
        </div>
      )}
      
      {/* Children */}
      {hasChildren && isExpanded && (
        <div className={`relative ${level > 0 ? 'ml-3' : ''}`}>
          {/* Connecting line */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-px bg-slate-700"
            style={{ left: `${level * 20 + 18}px` }}
          />
          
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              velocityProfiles={velocityProfiles}
              onNodeClick={onNodeClick}
              onExpandToggle={onExpandToggle}
              expandedNodes={expandedNodes}
              focusedNodeId={focusedNodeId}
              onFocusChange={onFocusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeNode;
