import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  CustomEditorModule,
  ModuleRegistry,
  NumberEditorModule,
  NumberFilterModule,
  RowSelectionModule,
  SelectEditorModule,
  TextEditorModule,
  TextFilterModule,
  ValidationModule,
} from 'ag-grid-community';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  RowSelectionModule,
  TextFilterModule,
  NumberFilterModule,
  TextEditorModule,
  NumberEditorModule,
  SelectEditorModule,
  CustomEditorModule,
  CellStyleModule,
  ValidationModule,
]);
