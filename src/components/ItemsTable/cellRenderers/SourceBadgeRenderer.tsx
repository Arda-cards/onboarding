import type { CustomCellRendererProps } from 'ag-grid-react';
import { Icons } from '../../Icons';
import type { MasterListItem } from '../types';

const sourceConfig: Record<MasterListItem['source'], { icon: keyof typeof Icons; label: string; bg: string }> = {
  email: { icon: 'Mail', label: 'Email', bg: 'bg-arda-info-bg text-arda-info-text' },
  url: { icon: 'Link', label: 'URL', bg: 'bg-arda-bg-secondary text-arda-text-secondary' },
  barcode: { icon: 'Barcode', label: 'UPC', bg: 'bg-arda-success-bg text-arda-success-text' },
  photo: { icon: 'Camera', label: 'Photo', bg: 'bg-arda-warning-bg text-arda-warning-text' },
  csv: { icon: 'FileSpreadsheet', label: 'CSV', bg: 'bg-arda-bg-secondary text-arda-text-secondary' },
};

export const SourceBadgeRenderer = (props: CustomCellRendererProps<MasterListItem>) => {
  const source = props.value as MasterListItem['source'];
  if (!source) return null;

  const config = sourceConfig[source];
  const Icon = Icons[config.icon];

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${config.bg}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};
