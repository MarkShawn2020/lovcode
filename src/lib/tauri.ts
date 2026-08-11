import {
  Channel,
  convertFileSrc,
  invoke as tauriInvoke,
  isTauri,
  type InvokeArgs,
  type InvokeOptions,
} from "@tauri-apps/api/core";

export { Channel, convertFileSrc, isTauri };

export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  return tauriInvoke<T>(cmd, args, options);
}
