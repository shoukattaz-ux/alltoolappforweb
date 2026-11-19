/** Carries files from one screen to the next (for example from the dashboard's "Start with a file" box into a tool), in memory only. */
let pending: File[] = [];
export const setHandoff = (files: File[]) => { pending = files; };
/** Returns the waiting files once; a second call gets nothing, so a dialog opened later cannot grab them. */
export const takeHandoff = (): File[] => { const f = pending; pending = []; return f; };
export const clearHandoff = () => { pending = []; };
