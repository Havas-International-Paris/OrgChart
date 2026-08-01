import { createAnthropicProvider, MODEL as ANTHROPIC_MODEL } from './anthropicProvider.js';
import { createGeminiProvider, MODEL as GEMINI_MODEL } from './geminiProvider.js';
import { createGlmProvider, MODEL as GLM_MODEL } from './glmProvider.js';
import { createNemotronProvider, MODEL as NEMOTRON_MODEL } from './nemotronProvider.js';
import type { LlmProvider } from './types.js';

export type ProviderId = 'anthropic' | 'nemotron' | 'glm' | 'gemini';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  model: string;
  envVar: string;
  create: (key: string) => LlmProvider;
}

// Single source of truth for both chatHandler.ts's provider resolution and
// the GET /api/chat listing the frontend's model-picker dropdown reads —
// added 2026-08-01 alongside the dropdown, replacing the local
// PROVIDER_FACTORIES map that only chatHandler.ts used to know about (each
// provider's display label/model id previously lived only in that
// provider's own file, invisible to the frontend).
export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'nemotron', 'glm', 'gemini'];

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    model: ANTHROPIC_MODEL,
    envVar: 'ANTHROPIC_API_KEY',
    create: createAnthropicProvider,
  },
  nemotron: {
    id: 'nemotron',
    label: 'Nemotron (NVIDIA, free)',
    model: NEMOTRON_MODEL,
    envVar: 'NVIDIA_API_KEY',
    create: createNemotronProvider,
  },
  glm: {
    id: 'glm',
    label: 'GLM-5.2 (Zhipu, via NVIDIA NIM, free)',
    model: GLM_MODEL,
    envVar: 'NVIDIA_API_KEY',
    create: createGlmProvider,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google, free)',
    model: GEMINI_MODEL,
    envVar: 'GEMINI_API_KEY',
    create: createGeminiProvider,
  },
};
