/*
  dispenseItem lived here and was deleted on 2026-11-25.

  It was never routed, never imported and no client referenced it,
  but it carried a THIRD and incompatible model of the stock columns:
  it decremented `perQuantity` — the pieces-per-box ratio, which is a
  constant property of the packaging — and then derived `stock` from
  boxes times that mutated ratio. Wiring it up would have corrupted
  stock levels quietly. Dead code that is merely unused is clutter;
  dead code that is WRONG is a trap, so it is gone rather than fixed.

  dispenseSupply is the live dispense path.
*/

/**
 * The supplies module's handlers.
 *
 * This file was 3,034 lines holding twenty handlers with little in
 * common: catalogue edits, dispensing, re-stocking, transaction reads,
 * period reports and a spreadsheet importer. They now live in
 * ./supply/, grouped by what they are for.
 *
 * It stays as a re-export so every existing import — the two route files,
 * and anything added since — resolves exactly as before. Nothing about
 * the split can therefore change behaviour. New code is better off
 * importing from ./supply/<module> directly.
 */
export {
  addSupply,
  updateSupply,
  deleteSupply,
  supplyList,
  categories,
  containerDatasets,
} from "./supply/items";
export {
  dispenseSupply,
  updateSupplyDispense,
  removeStockInList,
} from "./supply/dispense";
export {
  restockSupply,
  newOrder,
} from "./supply/restock";
export {
  supplyDispenseTransaction,
  supplyTransactionInfo,
  userSupplyDispenseRecords,
  unitSupplyDispenseRecords,
} from "./supply/records";
export {
  timebaseSupplyReport,
  supplyTimeBaseReport,
  timebaseReport,
  timebaseReportExport,
} from "./supply/reports";
export {
  uploadBulkExcel,
} from "./supply/bulkImport";
