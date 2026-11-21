export type AiProvider = 'openai' | 'gemini' | 'deepseek';

export interface AiProviderDefinition {
  id: AiProvider;
  labelAr: string;
  defaultModel: string;
  chatCompletionsUrl: string;
  models: Array<{ value: string; label: string }>;
  keyHintAr: string;
  keyPlaceholder: string;
  docsUrl: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderDefinition> = {
  openai: {
    id: 'openai',
    labelAr: 'OpenAI',
    defaultModel: process.env.DEFAULT_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    chatCompletionsUrl: 'https://api.openai.com/v1/chat/completions',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
    ],
    keyHintAr: 'مفتاح OpenAI يبدأ بـ sk-',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    id: 'gemini',
    labelAr: 'Google Gemini',
    defaultModel: process.env.DEFAULT_GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    chatCompletionsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      { value: 'gemini-flash-latest', label: 'Gemini Flash (الأحدث تلقائياً — موصى به)' },
      { value: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite (الأحدث تلقائياً)' },
      { value: 'gemini-pro-latest', label: 'Gemini Pro (الأحدث تلقائياً)' },
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    ],
    keyHintAr: 'مفتاح Gemini من Google AI Studio — يبدأ بـ AIza أو AQ.',
    keyPlaceholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  deepseek: {
    id: 'deepseek',
    labelAr: 'DeepSeek',
    defaultModel: process.env.DEFAULT_DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    chatCompletionsUrl: 'https://api.deepseek.com/chat/completions',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat (V4 Flash)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    keyHintAr: 'مفتاح DeepSeek يبدأ بـ sk-',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
};

export function normalizeAiProvider(value: string | null | undefined): AiProvider {
  if (value === 'gemini' || value === 'deepseek' || value === 'openai') return value;
  return 'openai';
}

export function getProviderDefinition(provider: AiProvider): AiProviderDefinition {
  return AI_PROVIDERS[provider];
}

/** نماذج Gemini القديمة (1.x/2.x) أوقفتها Google؛ أي إعداد محفوظ بها يُحوَّل للنموذج الافتراضي الحالي. */
export function effectiveModel(provider: AiProvider, model: string | null | undefined): string {
  const m = (model ?? '').trim();
  const def = getProviderDefinition(provider).defaultModel;
  if (!m) return def;
  if (provider === 'gemini' && /^gemini-(1|2)(\.|-)/.test(m)) return def;
  return m;
}
