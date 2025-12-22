export enum BackgroundMode {
  NORMAL = 'normal',
  GREEN = 'green',
  BLUE = 'blue',
  MAGENTA = 'magenta'
}

export enum TextStyle {
  SIMPLE = 'simple',
  OUTLINE = 'outline',
  BOX = 'box'
}

export interface TranslationConfig {
  sourceLang: string;
  targetLang: string;
}

export interface LiveState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  currentText: string;
  history: string[];
}