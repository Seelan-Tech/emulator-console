// Shared by the server (audit "mutating" flag) and the browser (what the recorder captures).
const READ_ONLY = /^(Get|List|Describe|Head|Query|Scan|BatchGet|Receive|Check|Lookup|Select|Validate|Search)/;

export const isMutating = (operation: string) => !READ_ONLY.test(operation);

// Calls worth replaying: state-changing, and not just running code (Invoke changes nothing durable).
export const isRecordable = (operation: string) => isMutating(operation) && !/^Invoke/.test(operation);
