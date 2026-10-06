import { PROTOCOL_VERSION } from "@morph/protocol";

/** Versão do protocolo que este engine sabe aplicar. */
export const ENGINE_PROTOCOL_VERSION: number = PROTOCOL_VERSION;

export type { Issue, IssueCode } from "./issues.ts";
export { validateSpec } from "./validate.ts";
export { applyChangeset, restoreVersion, type ApplyResult, type ApplyStage, type RestoreResult } from "./apply.ts";
export { OPERATION_LEVEL, RECORD_WRITE_LEVEL, actionLevel, changesetLevel, maxLevel } from "./permissions.ts";
export { RecordId, computeFields, evaluate, recordSchema, type RecordData } from "./records.ts";
export {
  RecordIndex,
  aggregate,
  chartBuckets,
  fieldValue,
  localDateString,
  periodRange,
  resolveOperand,
  resolveValue,
  runQuery,
  titleOf,
  toDate,
  type ChartBucket,
  type EvalContext,
  type Resolved,
  type StoredRecord,
} from "./query.ts";
export { formatDate, formatDuration, formatNumber, formatRelativeDate, formatResolved } from "./format.ts";
export { diffScreen, diffSpecs, type ScreenDiff, type SpecDiff } from "./diff.ts";
