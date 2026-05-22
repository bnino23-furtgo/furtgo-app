export type FloatingBubbleStartOptions = {
  sizeDp?: number;
};

export interface FloatingBubbleAPI {
  hasPermission(): boolean;
  requestPermission(): Promise<void>;
  start(options?: FloatingBubbleStartOptions): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  isBatteryOptimizationIgnored(): boolean;
  requestIgnoreBatteryOptimization(): Promise<void>;
}
