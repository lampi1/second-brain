// Typed host outcomes shared by the writer and deployment coordinator. Only a proven pre-dispatch or HTTP refusal
// may release a creating lease; transport loss and errors after accepted writes are deliberately not this type.
export class DevOpsWriteError extends Error {}
export class NoRemoteEffect extends DevOpsWriteError {}
