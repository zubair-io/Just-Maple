import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';

/**
 * Configured Table extension with header support
 */
export const ConfiguredTable = Table.configure({
  resizable: true,
  handleWidth: 5,
  cellMinWidth: 100,
  lastColumnResizable: true,
});

/**
 * Configured Table Row
 */
export const ConfiguredTableRow = TableRow;

/**
 * Configured Table Header with styling
 */
export const ConfiguredTableHeader = TableHeader;

/**
 * Configured Table Cell
 */
export const ConfiguredTableCell = TableCell;

/**
 * Get all table extensions as an array
 */
export function getTableExtensions() {
  return [ConfiguredTable, ConfiguredTableRow, ConfiguredTableHeader, ConfiguredTableCell];
}
