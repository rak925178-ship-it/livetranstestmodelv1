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

export enum Persona {
  NONE = 'none',
  SAMURAI = 'samurai',
  TSUNDERE = 'tsundere',
  CAT = 'cat',
  BUTLER = 'butler'
}

export interface TranslationConfig {
  sourceLang: string;
  targetLang: string;
  persona: Persona;
}

export interface LiveState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  currentText: string;
  history: string[];
}