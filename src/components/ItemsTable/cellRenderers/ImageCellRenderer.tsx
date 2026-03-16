import type { CustomCellRendererProps } from 'ag-grid-react';
import { Icons } from '../../Icons';
import type { MasterListItem } from '../types';

export const ImageCellRenderer = (props: CustomCellRendererProps<MasterListItem>) => {
  const url = props.value as string | undefined;

  if (url?.trim()) {
    return (
      <img
        src={url}
        alt=""
        className="w-8 h-8 rounded object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded bg-arda-bg-secondary">
      <Icons.Package className="w-4 h-4 text-arda-text-muted" />
    </div>
  );
};
