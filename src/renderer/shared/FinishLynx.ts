export interface LynxState {
  connected: boolean;
  remoteAddress: string;
  error: string;
}

export const LynxStateKey = 'flstate';
export const LynxFolderOK = 'fl-folder-ok';
export const N_LYNX_FOLDER = 'lynxFolder';
export const N_LYNX_PORT = 'lynxPort';
