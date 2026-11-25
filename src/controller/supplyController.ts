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
