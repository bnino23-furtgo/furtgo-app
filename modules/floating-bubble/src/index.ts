import { Platform, requireOptionalNativeModule } from 'expo-modules-core';

import type { FloatingBubbleAPI, FloatingBubbleStartOptions } from './FloatingBubble.types';

const native = requireOptionalNativeModule('FloatingBubble');

const noop: FloatingBubbleAPI = {
  hasPermission: () => false,
  requestPermission: async () => {},
  start: async (_options?: FloatingBubbleStartOptions) => {},
  stop: async () => {},
  isRunning: () => false,
  isBatteryOptimizationIgnored: () => true,
  requestIgnoreBatteryOptimization: async () => {},
};

const FloatingBubble: FloatingBubbleAPI =
  Platform.OS === 'android' && native
    ? {
        hasPermission: () => Boolean(native.hasPermission()),
        requestPermission: () => native.requestPermission(),
        start: (options?: FloatingBubbleStartOptions) => native.start(options ?? {}),
        stop: () => native.stop(),
        isRunning: () => Boolean(native.isRunning()),
        isBatteryOptimizationIgnored: () => Boolean(native.isBatteryOptimizationIgnored()),
        requestIgnoreBatteryOptimization: () => native.requestIgnoreBatteryOptimization(),
      }
    : noop;

export default FloatingBubble;
export type { FloatingBubbleAPI, FloatingBubbleStartOptions };
