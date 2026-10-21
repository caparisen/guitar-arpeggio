import type { EngineHost } from "./types.js";

/** 浏览器里的默认实现 */
export const browserHost: EngineHost = {
  createContext: () => new AudioContext(),
  createOffline: (channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate),
};
