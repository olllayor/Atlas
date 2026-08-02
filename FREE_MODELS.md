# Free Models Available to Atlas

> Auto-generated from the @opencode-ai/models snapshot (models.dev database).
> Generated at: unknown

## How Atlas detects free models

Atlas uses two signals to mark a model as free:

1. **models.dev pricing** — a model is free when 
   (zeroed pricing = the provider genuinely does not charge per token;
   absent pricing = subscription-only, NOT free).
   Source:  → 

2. **Gateway  suffix** — OpenRouter and other OpenAI-compatible gateways
   advertise a free tier with an id suffix ( or ).
   Source:  → 

## Summary

- **Total models in catalog:** 5751
- **Total free models:** 507
- **Providers with free models:** 59

## Free models by provider

| Provider | Free models | Base URL |
|---|---|---|
| Nvidia | 80 | https://integrate.api.nvidia.com/v1 |
| GitHub Models | 55 | https://models.github.ai/inference |
| Kenari | 38 | https://kenari.id/v1 |
| OpenCode Zen | 24 | https://opencode.ai/zen/v1 |
| Alibaba Token Plan | 22 | https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 |
| Alibaba Token Plan (China) | 22 | https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 |
| GitLab Duo | 22 | none |
| OpenRouter | 18 | https://openrouter.ai/api/v1 |
| iFlow | 14 | https://apis.iflow.cn/v1 |
| Kilo Gateway | 13 | https://api.kilo.ai/api/gateway |
| UnoRouter | 11 | https://api.unorouter.com/v1 |
| Alibaba Coding Plan | 10 | https://coding-intl.dashscope.aliyuncs.com/v1 |
| Alibaba Coding Plan (China) | 10 | https://coding.dashscope.aliyuncs.com/v1 |
| Tencent Coding Plan (China) | 8 | https://api.lkeap.cloud.tencent.com/coding/v3 |
| Llama | 7 | https://api.llama.com/compat/v1/ |
| MiniMax Token Plan (minimaxi.com) | 7 | https://api.minimaxi.com/anthropic/v1 |
| MiniMax Token Plan (minimax.io) | 7 | https://api.minimax.io/anthropic/v1 |
| ModelScope | 7 | https://api-inference.modelscope.cn/v1 |
| Xiaomi Token Plan (Europe) | 7 | https://token-plan-ams.xiaomimimo.com/v1 |
| Xiaomi Token Plan (China) | 7 | https://token-plan-cn.xiaomimimo.com/v1 |
| Xiaomi Token Plan (Singapore) | 7 | https://token-plan-sgp.xiaomimimo.com/v1 |
| ZenMux | 7 | https://zenmux.ai/api/v1 |
| Cloudflare AI Gateway | 6 | none |
| InferX | 6 | https://model.inferx.net/endpoints/v1 |
| Umans AI Coding Plan | 6 | https://api.code.umans.ai/v1 |
| Z.AI Coding Plan | 6 | https://api.z.ai/api/coding/paas/v4 |
| Zhipu AI Coding Plan | 6 | https://open.bigmodel.cn/api/coding/paas/v4 |
| Atomic Chat | 5 | http://127.0.0.1:1337/v1 |
| Privatemode AI | 5 | http://localhost:8080/v1 |
| Vercel AI Gateway | 5 | none |
| AIHubMix | 4 | none |
| Kimi For Coding | 4 | https://api.kimi.com/coding/v1 |
| Cortecs | 3 | https://api.cortecs.ai/v1 |
| EmpirioLabs AI | 3 | https://api.empiriolabs.ai/v1 |
| LLM Gateway | 3 | https://api.llmgateway.io/v1 |
| LLMTR | 3 | https://llmtr.com/v1 |
| LMStudio | 3 | http://127.0.0.1:1234/v1 |
| NanoGPT | 3 | https://nano-gpt.com/api/v1 |
| Poe | 3 | https://api.poe.com/v1 |
| Poolside | 3 | https://inference.poolside.ai/v1 |
| SiliconFlow (China) | 3 | https://api.siliconflow.cn/v1 |
| Alibaba (China) | 2 | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| Google | 2 | none |
| Nova | 2 | https://api.nova.amazon.com/v1 |
| Tencent TokenHub | 2 | https://tokenhub.tencentmaas.com/v1 |
| Z.AI | 2 | https://api.z.ai/api/paas/v4 |
| Zhipu AI | 2 | https://open.bigmodel.cn/api/paas/v4 |
| ai& | 1 | https://api.aiand.com/v1 |
| Cohere | 1 | none |
| Hetzner | 1 | https://inference.hetzner.com/api/v1 |
| Hugging Face | 1 | https://router.huggingface.co/v1 |
| Jiekou.AI | 1 | https://api.jiekou.ai/openai |
| KUAE Cloud Coding Plan | 1 | https://coding-plan-endpoint.kuaecloud.net/v1 |
| Lynkr | 1 | http://127.0.0.1:8081/v1 |
| Meganova | 1 | https://api.meganova.ai/v1 |
| Mistral | 1 | none |
| OrcaRouter | 1 | https://api.orcarouter.ai/v1 |
| Tencent Token Plan | 1 | https://api.lkeap.cloud.tencent.com/plan/v3 |
| Zeldoc | 1 | https://api.zeldoc.ai/v1 |

## All free models (sorted by provider then model id)

- **qwen/qwen3.6-27b** (Qwen3.6 27B) — provider: ai& | context: 262.144K | output: 65.536K | caps: tools, reasoning
- **coding-glm-5.1-free** (Coding GLM 5.1 (free)) — provider: AIHubMix | context: 200K | output: 128K | caps: tools, reasoning
- **coding-minimax-m2.7-free** (Coding MiniMax M2.7 (Free)) — provider: AIHubMix | context: 204.8K | output: 128.1K | caps: tools, reasoning
- **xiaomi-mimo-v2.5-free** (Xiaomi MiMo-V2.5 (free)) — provider: AIHubMix | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **xiaomi-mimo-v2.5-pro-free** (Xiaomi MiMo-V2.5-Pro (free)) — provider: AIHubMix | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **deepseek-r1-distill-llama-8b** (DeepSeek R1 Distill Llama 8B) — provider: Alibaba (China) | context: 32.768K | output: 16.384K | caps: tools, reasoning
- **deepseek-r1-distill-qwen-1-5b** (DeepSeek R1 Distill Qwen 1.5B) — provider: Alibaba (China) | context: 32.768K | output: 16.384K | caps: tools, reasoning
- **glm-4.7** (GLM-4.7) — provider: Alibaba Coding Plan (China) | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **glm-5** (GLM-5) — provider: Alibaba Coding Plan (China) | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **kimi-k2.5** (Kimi K2.5) — provider: Alibaba Coding Plan (China) | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **MiniMax-M2.5** (MiniMax-M2.5) — provider: Alibaba Coding Plan (China) | context: 196.608K | output: 24.576K | caps: tools, reasoning
- **qwen3-coder-next** (Qwen3 Coder Next) — provider: Alibaba Coding Plan (China) | context: 262.144K | output: 65.536K | caps: tools
- **qwen3-coder-plus** (Qwen3 Coder Plus) — provider: Alibaba Coding Plan (China) | context: 1M | output: 65.536K | caps: tools
- **qwen3-max-2026-01-23** (Qwen3 Max) — provider: Alibaba Coding Plan (China) | context: 262.144K | output: 32.768K | caps: tools
- **qwen3.5-plus** (Qwen3.5 Plus) — provider: Alibaba Coding Plan (China) | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.6-plus** (Qwen3.6 Plus) — provider: Alibaba Coding Plan (China) | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.7-plus** (Qwen3.7 Plus) — provider: Alibaba Coding Plan (China) | context: 1M | output: 64K | caps: tools, vision, reasoning
- **glm-4.7** (GLM-4.7) — provider: Alibaba Coding Plan | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **glm-5** (GLM-5) — provider: Alibaba Coding Plan | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **kimi-k2.5** (Kimi K2.5) — provider: Alibaba Coding Plan | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **MiniMax-M2.5** (MiniMax-M2.5) — provider: Alibaba Coding Plan | context: 196.608K | output: 24.576K | caps: tools, reasoning
- **qwen3-coder-next** (Qwen3 Coder Next) — provider: Alibaba Coding Plan | context: 262.144K | output: 65.536K | caps: tools
- **qwen3-coder-plus** (Qwen3 Coder Plus) — provider: Alibaba Coding Plan | context: 1M | output: 65.536K | caps: tools
- **qwen3-max-2026-01-23** (Qwen3 Max) — provider: Alibaba Coding Plan | context: 262.144K | output: 32.768K | caps: tools
- **qwen3.5-plus** (Qwen3.5 Plus) — provider: Alibaba Coding Plan | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.6-plus** (Qwen3.6 Plus) — provider: Alibaba Coding Plan | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.7-plus** (Qwen3.7 Plus) — provider: Alibaba Coding Plan | context: 1M | output: 64K | caps: tools, vision, reasoning
- **deepseek-v3.2** (DeepSeek V3.2) — provider: Alibaba Token Plan (China) | context: 131.072K | output: 65.536K | caps: tools, reasoning
- **deepseek-v4-flash** (DeepSeek V4 Flash) — provider: Alibaba Token Plan (China) | context: 1M | output: 384K | caps: tools, reasoning
- **deepseek-v4-pro** (DeepSeek V4 Pro) — provider: Alibaba Token Plan (China) | context: 1M | output: 384K | caps: tools, reasoning
- **glm-5** (GLM-5) — provider: Alibaba Token Plan (China) | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **glm-5.1** (GLM-5.1) — provider: Alibaba Token Plan (China) | context: 202.752K | output: 128K | caps: tools, reasoning
- **glm-5.2** (GLM-5.2) — provider: Alibaba Token Plan (China) | context: 1M | output: 131.072K | caps: tools, reasoning
- **happyhorse-1.1-i2v** (HappyHorse 1.1 Image-to-Video) — provider: Alibaba Token Plan (China) | context: ? | output: ? | caps: vision
- **happyhorse-1.1-r2v** (HappyHorse 1.1 Reference-to-Video) — provider: Alibaba Token Plan (China) | context: ? | output: ? | caps: vision
- **happyhorse-1.1-t2v** (HappyHorse 1.1 Text-to-Video) — provider: Alibaba Token Plan (China) | context: ? | output: ? | caps: none
- **kimi-k2.5** (Kimi K2.5) — provider: Alibaba Token Plan (China) | context: 262.144K | output: 98.304K | caps: tools, vision, reasoning
- **kimi-k2.6** (Kimi K2.6) — provider: Alibaba Token Plan (China) | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **kimi-k2.7-code** (Kimi K2.7 Code) — provider: Alibaba Token Plan (China) | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **MiniMax-M2.5** (MiniMax-M2.5) — provider: Alibaba Token Plan (China) | context: 196.608K | output: 32.768K | caps: tools, reasoning
- **qwen-image-2.0** (Qwen Image 2.0) — provider: Alibaba Token Plan (China) | context: 8.192K | output: ? | caps: none
- **qwen-image-2.0-pro** (Qwen Image 2.0 Pro) — provider: Alibaba Token Plan (China) | context: 8.192K | output: ? | caps: none
- **qwen3.6-flash** (Qwen3.6 Flash) — provider: Alibaba Token Plan (China) | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.6-plus** (Qwen3.6 Plus) — provider: Alibaba Token Plan (China) | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.7-max** (Qwen3.7 Max) — provider: Alibaba Token Plan (China) | context: 1M | output: 131.072K | caps: tools, reasoning
- **qwen3.7-plus** (Qwen3.7 Plus) — provider: Alibaba Token Plan (China) | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.8-max-preview** (Qwen3.8 Max Preview) — provider: Alibaba Token Plan (China) | context: 1M | output: 131.072K | caps: tools, vision, reasoning
- **wan2.7-image** (Wan2.7 Image) — provider: Alibaba Token Plan (China) | context: 8.192K | output: ? | caps: none
- **wan2.7-image-pro** (Wan2.7 Image Pro) — provider: Alibaba Token Plan (China) | context: 8.192K | output: ? | caps: none
- **deepseek-v3.2** (DeepSeek V3.2) — provider: Alibaba Token Plan | context: 131.072K | output: 65.536K | caps: tools, reasoning
- **deepseek-v4-flash** (DeepSeek V4 Flash) — provider: Alibaba Token Plan | context: 1M | output: 384K | caps: tools, reasoning
- **deepseek-v4-pro** (DeepSeek V4 Pro) — provider: Alibaba Token Plan | context: 1M | output: 384K | caps: tools, reasoning
- **glm-5** (GLM-5) — provider: Alibaba Token Plan | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **glm-5.1** (GLM-5.1) — provider: Alibaba Token Plan | context: 202.752K | output: 128K | caps: tools, reasoning
- **glm-5.2** (GLM-5.2) — provider: Alibaba Token Plan | context: 1M | output: 131.072K | caps: tools, reasoning
- **happyhorse-1.1-i2v** (HappyHorse 1.1 Image-to-Video) — provider: Alibaba Token Plan | context: ? | output: ? | caps: vision
- **happyhorse-1.1-r2v** (HappyHorse 1.1 Reference-to-Video) — provider: Alibaba Token Plan | context: ? | output: ? | caps: vision
- **happyhorse-1.1-t2v** (HappyHorse 1.1 Text-to-Video) — provider: Alibaba Token Plan | context: ? | output: ? | caps: none
- **kimi-k2.5** (Kimi K2.5) — provider: Alibaba Token Plan | context: 262.144K | output: 98.304K | caps: tools, vision, reasoning
- **kimi-k2.6** (Kimi K2.6) — provider: Alibaba Token Plan | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **kimi-k2.7-code** (Kimi K2.7 Code) — provider: Alibaba Token Plan | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **MiniMax-M2.5** (MiniMax-M2.5) — provider: Alibaba Token Plan | context: 196.608K | output: 32.768K | caps: tools, reasoning
- **qwen-image-2.0** (Qwen Image 2.0) — provider: Alibaba Token Plan | context: 8.192K | output: ? | caps: none
- **qwen-image-2.0-pro** (Qwen Image 2.0 Pro) — provider: Alibaba Token Plan | context: 8.192K | output: ? | caps: none
- **qwen3.6-flash** (Qwen3.6 Flash) — provider: Alibaba Token Plan | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.6-plus** (Qwen3.6 Plus) — provider: Alibaba Token Plan | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.7-max** (Qwen3.7 Max) — provider: Alibaba Token Plan | context: 1M | output: 131.072K | caps: tools, reasoning
- **qwen3.7-plus** (Qwen3.7 Plus) — provider: Alibaba Token Plan | context: 1M | output: 65.536K | caps: tools, vision, reasoning
- **qwen3.8-max-preview** (Qwen3.8 Max Preview) — provider: Alibaba Token Plan | context: 1M | output: 131.072K | caps: tools, vision, reasoning
- **wan2.7-image** (Wan2.7 Image) — provider: Alibaba Token Plan | context: 8.192K | output: ? | caps: none
- **wan2.7-image-pro** (Wan2.7 Image Pro) — provider: Alibaba Token Plan | context: 8.192K | output: ? | caps: none
- **gemma-4-E4B-it-IQ4_XS** (Gemma 4 E4B Instruct (IQ4_XS)) — provider: Atomic Chat | context: 32.768K | output: 8.192K | caps: none
- **gemma-4-E4B-it-MLX-4bit** (Gemma 4 E4B Instruct (MLX 4-bit)) — provider: Atomic Chat | context: 32.768K | output: 8.192K | caps: none
- **Meta-Llama-3_1-8B-Instruct-GGUF** (Meta Llama 3.1 8B Instruct (GGUF)) — provider: Atomic Chat | context: 131.072K | output: 4.096K | caps: tools
- **Qwen3_5-9B-MLX-4bit** (Qwen 3.5 9B (MLX 4-bit)) — provider: Atomic Chat | context: 32.768K | output: 8.192K | caps: tools, vision
- **Qwen3_5-9B-Q4_K_M** (Qwen 3.5 9B (Q4_K_M)) — provider: Atomic Chat | context: 32.768K | output: 8.192K | caps: tools, vision
- **workers-ai/@cf/deepgram/aura-2-en** (Deepgram Aura 2 (EN)) — provider: Cloudflare AI Gateway | context: 128K | output: 16.384K | caps: none
- **workers-ai/@cf/deepgram/aura-2-es** (Deepgram Aura 2 (ES)) — provider: Cloudflare AI Gateway | context: 128K | output: 16.384K | caps: none
- **workers-ai/@cf/deepgram/nova-3** (Deepgram Nova 3) — provider: Cloudflare AI Gateway | context: 128K | output: 16.384K | caps: none
- **workers-ai/@cf/facebook/bart-large-cnn** (BART Large CNN) — provider: Cloudflare AI Gateway | context: 128K | output: 16.384K | caps: none
- **workers-ai/@cf/myshell-ai/melotts** (MyShell MeloTTS) — provider: Cloudflare AI Gateway | context: 128K | output: 16.384K | caps: none
- **workers-ai/@cf/pipecat-ai/smart-turn-v2** (Pipecat Smart Turn v2) — provider: Cloudflare AI Gateway | context: 128K | output: 16.384K | caps: none
- **north-mini-code-1-0** (North Mini Code) — provider: Cohere | context: 256K | output: 64K | caps: tools, reasoning
- **devstral-2512** (Devstral 2 2512) — provider: Cortecs | context: 262K | output: 262K | caps: tools
- **gpt-oss-120b** (GPT Oss 120b) — provider: Cortecs | context: 128K | output: 128K | caps: tools, reasoning
- **llama-3.1-405b-instruct** (Llama 3.1 405B Instruct) — provider: Cortecs | context: 128K | output: 128K | caps: tools
- **glm-4-5-flash** (GLM 4.5 Flash) — provider: EmpirioLabs AI | context: 200K | output: 98.304K | caps: tools, reasoning
- **glm-4-7-flash** (GLM 4.7 Flash) — provider: EmpirioLabs AI | context: 200K | output: 131.072K | caps: tools, reasoning
- **mistral-medium-3** (Mistral Medium 3) — provider: EmpirioLabs AI | context: 130K | output: 40K | caps: tools, vision
- **ai21-labs/ai21-jamba-1.5-large** (AI21 Jamba 1.5 Large) — provider: GitHub Models | context: 256K | output: 4.096K | caps: tools, reasoning
- **ai21-labs/ai21-jamba-1.5-mini** (AI21 Jamba 1.5 Mini) — provider: GitHub Models | context: 256K | output: 4.096K | caps: tools, reasoning
- **cohere/cohere-command-a** (Cohere Command A) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **cohere/cohere-command-r** (Cohere Command R) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **cohere/cohere-command-r-08-2024** (Cohere Command R 08-2024) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools
- **cohere/cohere-command-r-plus** (Cohere Command R+) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools
- **cohere/cohere-command-r-plus-08-2024** (Cohere Command R+ 08-2024) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools
- **core42/jais-30b-chat** (JAIS 30b Chat) — provider: GitHub Models | context: 8.192K | output: 2.048K | caps: tools, reasoning
- **deepseek/deepseek-r1** (DeepSeek-R1) — provider: GitHub Models | context: 65.536K | output: 8.192K | caps: tools, reasoning
- **deepseek/deepseek-r1-0528** (DeepSeek-R1-0528) — provider: GitHub Models | context: 65.536K | output: 8.192K | caps: tools, reasoning
- **deepseek/deepseek-v3-0324** (DeepSeek-V3-0324) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, reasoning
- **meta/llama-3.2-11b-vision-instruct** (Llama-3.2-11B-Vision-Instruct) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, vision, reasoning
- **meta/llama-3.2-90b-vision-instruct** (Llama-3.2-90B-Vision-Instruct) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, vision, reasoning
- **meta/llama-3.3-70b-instruct** (Llama-3.3-70B-Instruct) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, reasoning
- **meta/llama-4-maverick-17b-128e-instruct-fp8** (Llama 4 Maverick 17B 128E Instruct FP8) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, vision, reasoning
- **meta/llama-4-scout-17b-16e-instruct** (Llama 4 Scout 17B 16E Instruct) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, vision, reasoning
- **meta/meta-llama-3-70b-instruct** (Meta-Llama-3-70B-Instruct) — provider: GitHub Models | context: 8.192K | output: 2.048K | caps: tools, reasoning
- **meta/meta-llama-3-8b-instruct** (Meta-Llama-3-8B-Instruct) — provider: GitHub Models | context: 8.192K | output: 2.048K | caps: tools, reasoning
- **meta/meta-llama-3.1-405b-instruct** (Meta-Llama-3.1-405B-Instruct) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, reasoning
- **meta/meta-llama-3.1-70b-instruct** (Meta-Llama-3.1-70B-Instruct) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, reasoning
- **meta/meta-llama-3.1-8b-instruct** (Meta-Llama-3.1-8B-Instruct) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, reasoning
- **microsoft/mai-ds-r1** (MAI-DS-R1) — provider: GitHub Models | context: 65.536K | output: 8.192K | caps: tools, reasoning
- **microsoft/phi-3-medium-128k-instruct** (Phi-3-medium instruct (128k)) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-3-medium-4k-instruct** (Phi-3-medium instruct (4k)) — provider: GitHub Models | context: 4.096K | output: 1.024K | caps: tools, reasoning
- **microsoft/phi-3-mini-128k-instruct** (Phi-3-mini instruct (128k)) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-3-mini-4k-instruct** (Phi-3-mini instruct (4k)) — provider: GitHub Models | context: 4.096K | output: 1.024K | caps: tools, reasoning
- **microsoft/phi-3-small-128k-instruct** (Phi-3-small instruct (128k)) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-3-small-8k-instruct** (Phi-3-small instruct (8k)) — provider: GitHub Models | context: 8.192K | output: 2.048K | caps: tools, reasoning
- **microsoft/phi-3.5-mini-instruct** (Phi-3.5-mini instruct (128k)) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-3.5-moe-instruct** (Phi-3.5-MoE instruct (128k)) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-3.5-vision-instruct** (Phi-3.5-vision instruct (128k)) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, vision, reasoning
- **microsoft/phi-4** (Phi-4) — provider: GitHub Models | context: 16K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-4-mini-instruct** (Phi-4-mini-instruct) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-4-mini-reasoning** (Phi-4-mini-reasoning) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **microsoft/phi-4-multimodal-instruct** (Phi-4-multimodal-instruct) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, vision, reasoning
- **microsoft/phi-4-reasoning** (Phi-4-Reasoning) — provider: GitHub Models | context: 128K | output: 4.096K | caps: tools, reasoning
- **mistral-ai/codestral-2501** (Codestral 25.01) — provider: GitHub Models | context: 32K | output: 8.192K | caps: tools, reasoning
- **mistral-ai/ministral-3b** (Ministral 3B) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, reasoning
- **mistral-ai/mistral-large-2411** (Mistral Large 24.11) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, reasoning
- **mistral-ai/mistral-medium-2505** (Mistral Medium 3 (25.05)) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, vision, reasoning
- **mistral-ai/mistral-nemo** (Mistral Nemo) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, reasoning
- **mistral-ai/mistral-small-2503** (Mistral Small 3.1) — provider: GitHub Models | context: 128K | output: 32.768K | caps: tools, vision, reasoning
- **openai/gpt-4.1** (GPT-4.1) — provider: GitHub Models | context: 128K | output: 16.384K | caps: tools, vision
- **openai/gpt-4.1-mini** (GPT-4.1-mini) — provider: GitHub Models | context: 128K | output: 16.384K | caps: tools, vision
- **openai/gpt-4.1-nano** (GPT-4.1-nano) — provider: GitHub Models | context: 128K | output: 16.384K | caps: tools, vision
- **openai/gpt-4o** (GPT-4o) — provider: GitHub Models | context: 128K | output: 16.384K | caps: tools, vision
- **openai/gpt-4o-mini** (GPT-4o mini) — provider: GitHub Models | context: 128K | output: 16.384K | caps: tools, vision
- **openai/o1** (OpenAI o1) — provider: GitHub Models | context: 200K | output: 100K | caps: vision, reasoning
- **openai/o1-mini** (OpenAI o1-mini) — provider: GitHub Models | context: 128K | output: 65.536K | caps: reasoning
- **openai/o1-preview** (OpenAI o1-preview) — provider: GitHub Models | context: 128K | output: 32.768K | caps: reasoning
- **openai/o3** (OpenAI o3) — provider: GitHub Models | context: 200K | output: 100K | caps: vision, reasoning
- **openai/o3-mini** (OpenAI o3-mini) — provider: GitHub Models | context: 200K | output: 100K | caps: reasoning
- **openai/o4-mini** (OpenAI o4-mini) — provider: GitHub Models | context: 200K | output: 100K | caps: vision, reasoning
- **xai/grok-3** (Grok 3) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, reasoning
- **xai/grok-3-mini** (Grok 3 Mini) — provider: GitHub Models | context: 128K | output: 8.192K | caps: tools, reasoning
- **duo-chat-fable-5** (Agentic Chat (Claude Fable 5)) — provider: GitLab Duo | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-1** (Agentic Chat (GPT-5.1)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning
- **duo-chat-gpt-5-2** (Agentic Chat (GPT-5.2)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning
- **duo-chat-gpt-5-2-codex** (Agentic Chat (GPT-5.2 Codex)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-3-codex** (Agentic Chat (GPT-5.3 Codex)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-4** (Agentic Chat (GPT-5.4)) — provider: GitLab Duo | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-4-mini** (Agentic Chat (GPT-5.4 Mini)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning
- **duo-chat-gpt-5-4-nano** (Agentic Chat (GPT-5.4 Nano)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning
- **duo-chat-gpt-5-5** (Agentic Chat (GPT-5.5)) — provider: GitLab Duo | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-6-luna** (Agentic Chat (GPT-5.6 Luna)) — provider: GitLab Duo | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-6-sol** (Agentic Chat (GPT-5.6 Sol)) — provider: GitLab Duo | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-6-terra** (Agentic Chat (GPT-5.6 Terra)) — provider: GitLab Duo | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-gpt-5-codex** (Agentic Chat (GPT-5 Codex)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning
- **duo-chat-gpt-5-mini** (Agentic Chat (GPT-5 Mini)) — provider: GitLab Duo | context: 400K | output: 128K | caps: tools, vision, reasoning
- **duo-chat-haiku-4-5** (Agentic Chat (Claude Haiku 4.5)) — provider: GitLab Duo | context: 200K | output: 64K | caps: tools, vision, reasoning, pdf
- **duo-chat-opus-4-5** (Agentic Chat (Claude Opus 4.5)) — provider: GitLab Duo | context: 200K | output: 64K | caps: tools, vision, reasoning, pdf
- **duo-chat-opus-4-6** (Agentic Chat (Claude Opus 4.6)) — provider: GitLab Duo | context: 1M | output: 64K | caps: tools, vision, reasoning, pdf
- **duo-chat-opus-4-7** (Agentic Chat (Claude Opus 4.7)) — provider: GitLab Duo | context: 1M | output: 64K | caps: tools, vision, reasoning, pdf
- **duo-chat-opus-4-8** (Agentic Chat (Claude Opus 4.8)) — provider: GitLab Duo | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **duo-chat-sonnet-4-5** (Agentic Chat (Claude Sonnet 4.5)) — provider: GitLab Duo | context: 200K | output: 64K | caps: tools, vision, reasoning, pdf
- **duo-chat-sonnet-4-6** (Agentic Chat (Claude Sonnet 4.6)) — provider: GitLab Duo | context: 1M | output: 64K | caps: tools, vision, reasoning, pdf
- **duo-chat-sonnet-5** (Agentic Chat (Claude Sonnet 5)) — provider: GitLab Duo | context: 1M | output: 64K | caps: tools, vision, reasoning, pdf
- **lyria-3-clip-preview** (Lyria 3 Clip Preview) — provider: Google | context: 1.048576M | output: 65.536K | caps: vision
- **lyria-3-pro-preview** (Lyria 3 Pro Preview) — provider: Google | context: 1.048576M | output: 65.536K | caps: vision
- **Qwen/Qwen3.6-35B-A3B-FP8** (Qwen3.6 35B A3B FP8) — provider: Hetzner | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **zai-org/GLM-4.7-Flash** (GLM-4.7-Flash) — provider: Hugging Face | context: 200K | output: 128K | caps: tools, reasoning
- **deepseek-r1** (DeepSeek-R1) — provider: iFlow | context: 128K | output: 32K | caps: tools, reasoning
- **deepseek-v3** (DeepSeek-V3) — provider: iFlow | context: 128K | output: 32K | caps: tools
- **deepseek-v3.2** (DeepSeek-V3.2-Exp) — provider: iFlow | context: 128K | output: 64K | caps: tools
- **glm-4.6** (GLM-4.6) — provider: iFlow | context: 200K | output: 128K | caps: tools, reasoning
- **kimi-k2** (Kimi-K2) — provider: iFlow | context: 128K | output: 64K | caps: tools
- **kimi-k2-0905** (Kimi-K2-0905) — provider: iFlow | context: 256K | output: 64K | caps: tools
- **qwen3-235b** (Qwen3-235B-A22B) — provider: iFlow | context: 128K | output: 32K | caps: tools, reasoning
- **qwen3-235b-a22b-instruct** (Qwen3-235B-A22B-Instruct) — provider: iFlow | context: 256K | output: 64K | caps: tools
- **qwen3-235b-a22b-thinking-2507** (Qwen3-235B-A22B-Thinking) — provider: iFlow | context: 256K | output: 64K | caps: tools, reasoning
- **qwen3-32b** (Qwen3-32B) — provider: iFlow | context: 128K | output: 32K | caps: tools
- **qwen3-coder-plus** (Qwen3-Coder-Plus) — provider: iFlow | context: 256K | output: 64K | caps: tools
- **qwen3-max** (Qwen3-Max) — provider: iFlow | context: 256K | output: 32K | caps: tools
- **qwen3-max-preview** (Qwen3-Max-Preview) — provider: iFlow | context: 256K | output: 32K | caps: tools
- **qwen3-vl-plus** (Qwen3-VL-Plus) — provider: iFlow | context: 256K | output: 32K | caps: tools, vision
- **google/gemma-4-31b-it-fp8** (Gemma 4 31B IT FP8) — provider: InferX | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **qwen/qwen3.5-122b-a10b-nvfp4** (Qwen3.5 122B A10B NVFP4) — provider: InferX | context: 256.144K | output: 65.536K | caps: tools, vision, reasoning
- **qwen/qwen3.6-27b-fp8** (Qwen3.6 27B FP8) — provider: InferX | context: 262.144K | output: 65.536K | caps: tools, vision, reasoning
- **qwen/qwen3.6-35b-a3b-fp8** (Qwen3.6 35B A3B FP8) — provider: InferX | context: 262K | output: 65.536K | caps: tools, vision, reasoning
- **qwen3-coder-next-fp8** (Qwen3 Coder Next FP8) — provider: InferX | context: 256.144K | output: 65.536K | caps: tools
- **qwen3-coder-next-fp8-1m** (Qwen3 Coder Next FP8 1M) — provider: InferX | context: 1.024M | output: 65.536K | caps: tools
- **xiaomimimo/mimo-v2-flash** (XiaomiMiMo/MiMo-V2-Flash) — provider: Jiekou.AI | context: 262.144K | output: 131.072K | caps: tools, reasoning
- **claude-fable-5** (Claude Fable 5) — provider: Kenari | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **claude-opus-4-7** (Claude Opus 4.7) — provider: Kenari | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **claude-opus-4-8** (Claude Opus 4.8) — provider: Kenari | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **claude-sonnet-5** (Claude Sonnet 5) — provider: Kenari | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **deepseek-v4-flash** (DeepSeek V4 Flash) — provider: Kenari | context: 1M | output: 384K | caps: tools, reasoning
- **deepseek-v4-flash:free** (DeepSeek V4 Flash (Free)) — provider: Kenari | context: 1M | output: 384K | caps: tools, reasoning
- **deepseek-v4-pro** (DeepSeek V4 Pro) — provider: Kenari | context: 1M | output: 384K | caps: tools, reasoning
- **gemini-2-5-flash** (Gemini 2.5 Flash) — provider: Kenari | context: 1.048576M | output: 65.536K | caps: tools, vision, reasoning, pdf
- **gemini-2-5-flash-lite** (Gemini 2.5 Flash-Lite) — provider: Kenari | context: 1.048576M | output: 65.536K | caps: tools, vision, reasoning, pdf
- **gemini-3-1-flash-lite** (Gemini 3.1 Flash Lite) — provider: Kenari | context: 1.048576M | output: 65.536K | caps: tools, vision, reasoning, pdf
- **gemma-4-31b-it** (Gemma 4 31B IT) — provider: Kenari | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **glm-4-7-flash:free** (GLM-4.7-Flash (Free)) — provider: Kenari | context: 200K | output: 131.072K | caps: tools, reasoning
- **glm-5-1** (GLM-5.1) — provider: Kenari | context: 200K | output: 131.072K | caps: tools, reasoning
- **glm-5-2** (GLM-5.2) — provider: Kenari | context: 1M | output: 131.072K | caps: tools, reasoning
- **gpt-5-4-mini** (GPT-5.4 mini) — provider: Kenari | context: 400K | output: 128K | caps: tools, vision, reasoning
- **gpt-5-5** (GPT-5.5) — provider: Kenari | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **gpt-5-6-luna** (GPT-5.6 Luna) — provider: Kenari | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **gpt-5-6-sol** (GPT-5.6 Sol) — provider: Kenari | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **gpt-5-6-terra** (GPT-5.6 Terra) — provider: Kenari | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **gpt-image-2** (GPT-Image-2) — provider: Kenari | context: 272K | output: 16.384K | caps: vision
- **gpt-oss-120b** (GPT OSS 120B) — provider: Kenari | context: 131.072K | output: 32.768K | caps: tools, reasoning
- **gpt-oss-20b** (GPT OSS 20B) — provider: Kenari | context: 131.072K | output: 32.768K | caps: tools, reasoning
- **grok-4-5** (Grok 4.5) — provider: Kenari | context: 500K | output: 500K | caps: tools, vision, reasoning
- **grok-build-0-1** (Grok Build 0.1) — provider: Kenari | context: 256K | output: 256K | caps: tools, vision, reasoning, pdf
- **kimi-k2-6** (Kimi K2.6) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **kimi-k2-6:free** (Kimi K2.6 (Free)) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **kimi-k2-7-code** (Kimi K2.7 Code) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **kimi-k2-7-code:free** (Kimi K2.7 Code (Free)) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **kimi-k3** (Kimi K3) — provider: Kenari | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **mimo-v2-5** (MiMo-V2.5) — provider: Kenari | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **mimo-v2-5-pro** (MiMo-V2.5-Pro) — provider: Kenari | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2-5:free** (MiMo-V2.5 (Free)) — provider: Kenari | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **minimax-m3** (MiniMax-M3) — provider: Kenari | context: 512K | output: 128K | caps: tools, vision, reasoning
- **nemotron-3-nano-30b-a3b** (Nemotron 3 Nano 30B A3B) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, reasoning
- **nemotron-3-super-120b-a12b** (Nemotron 3 Super 120B A12B) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, reasoning
- **nemotron-3-super-120b-a12b:free** (Nemotron 3 Super 120B A12B (Free)) — provider: Kenari | context: 262.144K | output: 262.144K | caps: tools, reasoning
- **nemotron-3-ultra-550b-a55b** (Nemotron 3 Ultra 550B A55B) — provider: Kenari | context: 1M | output: 128K | caps: tools, reasoning
- **qwen3-7-plus** (Qwen3.7 Plus) — provider: Kenari | context: 1M | output: 64K | caps: tools, vision, reasoning
- **baidu/cobuddy:free** (Baidu: CoBuddy (free)) — provider: Kilo Gateway | context: 131.072K | output: 65.536K | caps: tools, reasoning
- **google/lyria-3-clip-preview** (Google: Lyria 3 Clip Preview) — provider: Kilo Gateway | context: 1.048576M | output: 65.536K | caps: vision
- **google/lyria-3-pro-preview** (Google: Lyria 3 Pro Preview) — provider: Kilo Gateway | context: 1.048576M | output: 65.536K | caps: vision
- **kilo-auto/free** (Kilo Auto Free) — provider: Kilo Gateway | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free** (NVIDIA: Nemotron 3 Nano Omni (free)) — provider: Kilo Gateway | context: 256K | output: 65.536K | caps: tools, vision, reasoning
- **nvidia/nemotron-3-super-120b-a12b:free** (NVIDIA: Nemotron 3 Super (free)) — provider: Kilo Gateway | context: 262.144K | output: 262.144K | caps: tools, reasoning
- **openrouter/auto** (Auto Router) — provider: Kilo Gateway | context: 2M | output: 32.768K | caps: tools, vision, reasoning, pdf
- **openrouter/bodybuilder** (Body Builder (beta)) — provider: Kilo Gateway | context: 128K | output: 32.768K | caps: none
- **openrouter/free** (Free Models Router) — provider: Kilo Gateway | context: 200K | output: 32.768K | caps: tools, vision, reasoning
- **openrouter/owl-alpha** (Owl Alpha) — provider: Kilo Gateway | context: 1.048756M | output: 262.144K | caps: tools, reasoning
- **openrouter/pareto-code** (Pareto Code Router) — provider: Kilo Gateway | context: 200K | output: 65.536K | caps: none
- **poolside/laguna-m.1:free** (Poolside: Laguna M.1 (free)) — provider: Kilo Gateway | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **poolside/laguna-xs.2:free** (Poolside: Laguna XS.2 (free)) — provider: Kilo Gateway | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **k3** (Kimi K3) — provider: Kimi For Coding | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **k3-256k** (Kimi K3-256K) — provider: Kimi For Coding | context: 262.144K | output: 131.072K | caps: tools, vision, reasoning
- **kimi-for-coding** (Kimi K2.7 Code) — provider: Kimi For Coding | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **kimi-for-coding-highspeed** (Kimi For Coding HighSpeed) — provider: Kimi For Coding | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **GLM-4.7** (GLM-4.7) — provider: KUAE Cloud Coding Plan | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **cerebras-llama-4-maverick-17b-128e-instruct** (Cerebras-Llama-4-Maverick-17B-128E-Instruct) — provider: Llama | context: 128K | output: 4.096K | caps: tools
- **cerebras-llama-4-scout-17b-16e-instruct** (Cerebras-Llama-4-Scout-17B-16E-Instruct) — provider: Llama | context: 128K | output: 4.096K | caps: tools
- **groq-llama-4-maverick-17b-128e-instruct** (Groq-Llama-4-Maverick-17B-128E-Instruct) — provider: Llama | context: 128K | output: 4.096K | caps: tools
- **llama-3.3-70b-instruct** (Llama-3.3-70B-Instruct) — provider: Llama | context: 128K | output: 4.096K | caps: tools
- **llama-3.3-8b-instruct** (Llama-3.3-8B-Instruct) — provider: Llama | context: 128K | output: 4.096K | caps: tools
- **llama-4-maverick-17b-128e-instruct-fp8** (Llama-4-Maverick-17B-128E-Instruct-FP8) — provider: Llama | context: 128K | output: 4.096K | caps: tools, vision
- **llama-4-scout-17b-16e-instruct-fp8** (Llama-4-Scout-17B-16E-Instruct-FP8) — provider: Llama | context: 128K | output: 4.096K | caps: tools, vision
- **auto** (Auto Route) — provider: LLM Gateway | context: 128K | output: 16.384K | caps: tools, vision
- **claude-haiku-4-5-free** (Claude Haiku 4.5 (latest)) — provider: LLM Gateway | context: 200K | output: 200K | caps: tools, vision
- **custom** (Custom Model) — provider: LLM Gateway | context: 128K | output: 16.384K | caps: tools, vision
- **magibu-11b-v8** (Magibu 11B v8) — provider: LLMTR | context: 8.192K | output: 4.096K | caps: none
- **sincap** (Sincap) — provider: LLMTR | context: 128K | output: 8.192K | caps: none
- **trendyol-7b** (Trendyol 7B) — provider: LLMTR | context: 32.768K | output: 8.192K | caps: none
- **openai/gpt-oss-20b** (GPT OSS 20B) — provider: LMStudio | context: 131.072K | output: 32.768K | caps: tools, reasoning
- **qwen/qwen3-30b-a3b-2507** (Qwen3 30B A3B 2507) — provider: LMStudio | context: 262.144K | output: 16.384K | caps: tools
- **qwen/qwen3-coder-30b** (Qwen3 Coder 30B) — provider: LMStudio | context: 262.144K | output: 65.536K | caps: tools
- **lynkr-auto** (Lynkr Auto (complexity routing)) — provider: Lynkr | context: 128K | output: 8.192K | caps: tools
- **mistralai/Mistral-Small-3.2-24B-Instruct-2506** (Mistral Small 3.2 24B Instruct) — provider: Meganova | context: 32.768K | output: 8.192K | caps: tools, vision
- **MiniMax-M2** (MiniMax-M2) — provider: MiniMax Token Plan (minimax.io) | context: 196.608K | output: 128K | caps: tools, reasoning
- **MiniMax-M2.1** (MiniMax-M2.1) — provider: MiniMax Token Plan (minimax.io) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.5** (MiniMax-M2.5) — provider: MiniMax Token Plan (minimax.io) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.5-highspeed** (MiniMax-M2.5-highspeed) — provider: MiniMax Token Plan (minimax.io) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.7** (MiniMax-M2.7) — provider: MiniMax Token Plan (minimax.io) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.7-highspeed** (MiniMax-M2.7-highspeed) — provider: MiniMax Token Plan (minimax.io) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M3** (MiniMax-M3) — provider: MiniMax Token Plan (minimax.io) | context: 1M | output: 128K | caps: tools, vision, reasoning
- **MiniMax-M2** (MiniMax-M2) — provider: MiniMax Token Plan (minimaxi.com) | context: 196.608K | output: 128K | caps: tools, reasoning
- **MiniMax-M2.1** (MiniMax-M2.1) — provider: MiniMax Token Plan (minimaxi.com) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.5** (MiniMax-M2.5) — provider: MiniMax Token Plan (minimaxi.com) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.5-highspeed** (MiniMax-M2.5-highspeed) — provider: MiniMax Token Plan (minimaxi.com) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.7** (MiniMax-M2.7) — provider: MiniMax Token Plan (minimaxi.com) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M2.7-highspeed** (MiniMax-M2.7-highspeed) — provider: MiniMax Token Plan (minimaxi.com) | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **MiniMax-M3** (MiniMax-M3) — provider: MiniMax Token Plan (minimaxi.com) | context: 1M | output: 128K | caps: tools, vision, reasoning
- **labs-devstral-small-2512** (Devstral Small 2) — provider: Mistral | context: 256K | output: 256K | caps: tools, vision
- **Qwen/Qwen3-235B-A22B-Instruct-2507** (Qwen3 235B A22B Instruct 2507) — provider: ModelScope | context: 262.144K | output: 131.072K | caps: tools
- **Qwen/Qwen3-235B-A22B-Thinking-2507** (Qwen3-235B-A22B-Thinking-2507) — provider: ModelScope | context: 262.144K | output: 131.072K | caps: tools, reasoning
- **Qwen/Qwen3-30B-A3B-Instruct-2507** (Qwen3 30B A3B Instruct 2507) — provider: ModelScope | context: 262.144K | output: 16.384K | caps: tools
- **Qwen/Qwen3-30B-A3B-Thinking-2507** (Qwen3 30B A3B Thinking 2507) — provider: ModelScope | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **Qwen/Qwen3-Coder-30B-A3B-Instruct** (Qwen3 Coder 30B A3B Instruct) — provider: ModelScope | context: 262.144K | output: 65.536K | caps: tools
- **ZhipuAI/GLM-4.5** (GLM-4.5) — provider: ModelScope | context: 131.072K | output: 98.304K | caps: tools, reasoning
- **ZhipuAI/GLM-4.6** (GLM-4.6) — provider: ModelScope | context: 202.752K | output: 98.304K | caps: tools, reasoning
- **auto-model** (Auto model) — provider: NanoGPT | context: 1M | output: 1M | caps: none
- **qwen3.5-omni-flash** (Qwen3.5 Omni Flash) — provider: NanoGPT | context: 49.152K | output: 16.384K | caps: vision
- **qwen3.5-omni-plus** (Qwen3.5 Omni Plus) — provider: NanoGPT | context: 983.616K | output: 65.536K | caps: vision
- **nova-2-lite-v1** (Nova 2 Lite) — provider: Nova | context: 1M | output: 64K | caps: tools, vision, reasoning, pdf
- **nova-2-pro-v1** (Nova 2 Pro) — provider: Nova | context: 1M | output: 64K | caps: tools, vision, reasoning, pdf
- **abacusai/dracarys-llama-3_1-70b-instruct** (dracarys-llama-3.1-70b-instruct) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools
- **baai/bge-m3** (BGE M3) — provider: Nvidia | context: 8.192K | output: 1.024K | caps: none
- **black-forest-labs/flux_1-kontext-dev** (FLUX.1-Kontext-dev) — provider: Nvidia | context: 40.96K | output: 40.96K | caps: vision
- **black-forest-labs/flux_1-schnell** (FLUX.1-schnell) — provider: Nvidia | context: 0.077K | output: ? | caps: none
- **black-forest-labs/flux_2-klein-4b** (FLUX.2 Klein 4B) — provider: Nvidia | context: 40.96K | output: 40.96K | caps: vision
- **black-forest-labs/flux.1-dev** (FLUX.1-dev) — provider: Nvidia | context: 4.096K | output: ? | caps: none
- **bytedance/seed-oss-36b-instruct** (ByteDance-Seed/Seed-OSS-36B-Instruct) — provider: Nvidia | context: 262K | output: 262K | caps: tools
- **google/gemma-2-2b-it** (Gemma 2 2b It) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools
- **google/gemma-3n-e2b-it** (Gemma 3n E2b It) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools, vision
- **google/gemma-3n-e4b-it** (Gemma 3n E4b It) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools, vision
- **google/gemma-4-31b-it** (Gemma-4-31B-IT) — provider: Nvidia | context: 256K | output: 16.384K | caps: tools, vision, reasoning
- **google/google-paligemma** (paligemma) — provider: Nvidia | context: 128K | output: 8.192K | caps: vision
- **meta/esm2-650m** (esm2-650m) — provider: Nvidia | context: 128K | output: 8.192K | caps: none
- **meta/esmfold** (esmfold) — provider: Nvidia | context: 128K | output: 8.192K | caps: none
- **meta/llama-3.1-70b-instruct** (Llama 3.1 70b Instruct) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools
- **meta/llama-3.1-8b-instruct** (Llama 3.1 8B Instruct) — provider: Nvidia | context: 16K | output: 4.096K | caps: tools
- **meta/llama-3.2-11b-vision-instruct** (Llama 3.2 11b Vision Instruct) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools, vision
- **meta/llama-3.2-1b-instruct** (Llama 3.2 1b Instruct) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools
- **meta/llama-3.2-3b-instruct** (Llama 3.2 3B Instruct) — provider: Nvidia | context: 32.768K | output: 32K | caps: none
- **meta/llama-3.2-90b-vision-instruct** (Llama-3.2-90B-Vision-Instruct) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools, vision
- **meta/llama-3.3-70b-instruct** (Llama 3.3 70b Instruct) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools
- **meta/llama-4-maverick-17b-128e-instruct** (Llama 4 Maverick 17b 128e Instruct) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools, vision
- **meta/llama-guard-4-12b** (Llama Guard 4 12B) — provider: Nvidia | context: 128K | output: 16.384K | caps: vision
- **microsoft/phi-4-mini-instruct** (Phi-4-Mini) — provider: Nvidia | context: 131.072K | output: 8.192K | caps: tools
- **microsoft/phi-4-multimodal-instruct** (Phi 4 Multimodal) — provider: Nvidia | context: 128K | output: 16.384K | caps: none
- **minimaxai/minimax-m2.7** (MiniMax-M2.7) — provider: Nvidia | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **minimaxai/minimax-m3** (MiniMax-M3) — provider: Nvidia | context: 1M | output: 16.384K | caps: tools, vision, reasoning
- **mistralai/magistral-small-2506** (Magistral Small 2506) — provider: Nvidia | context: 32.768K | output: 32.768K | caps: none
- **mistralai/mistral-7b-instruct-v03** (Mistral-7B-Instruct-v0.3) — provider: Nvidia | context: 65.536K | output: 65.536K | caps: tools
- **mistralai/mistral-large-3-675b-instruct-2512** (Mistral Large 3 675B Instruct 2512) — provider: Nvidia | context: 262.144K | output: 262.144K | caps: tools, vision
- **mistralai/mistral-medium-3-instruct** (Mistral Medium 3) — provider: Nvidia | context: 131.072K | output: 32.768K | caps: vision
- **mistralai/mistral-nemotron** (mistral-nemotron) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools
- **mistralai/mistral-small-4-119b-2603** (mistral-small-4-119b-2603) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools, vision, reasoning
- **mistralai/mixtral-8x22b-instruct** (Mistral: Mixtral 8x22B Instruct) — provider: Nvidia | context: 65.536K | output: 13.108K | caps: tools
- **mistralai/mixtral-8x7b-instruct** (Mistral: Mixtral 8x7B Instruct) — provider: Nvidia | context: 32.768K | output: 16.384K | caps: tools
- **moonshotai/kimi-k2-instruct-0905** (Kimi K2 0905) — provider: Nvidia | context: 262.144K | output: 262.144K | caps: tools
- **moonshotai/kimi-k2.6** (Kimi K2.6) — provider: Nvidia | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **nvidia/active-speaker-detection** (Active Speaker Detection) — provider: Nvidia | context: ? | output: 4.096K | caps: none
- **nvidia/bevformer** (bevformer) — provider: Nvidia | context: 128K | output: 8.192K | caps: none
- **nvidia/cosmos-predict1-5b** (cosmos-predict1-5b) — provider: Nvidia | context: ? | output: 4.096K | caps: vision
- **nvidia/cosmos-transfer1-7b** (cosmos-transfer1-7b) — provider: Nvidia | context: ? | output: 4.096K | caps: vision
- **nvidia/cosmos-transfer2_5-2b** (cosmos-transfer2.5-2b) — provider: Nvidia | context: ? | output: 4.096K | caps: vision
- **nvidia/gliner-pii** (gliner-pii) — provider: Nvidia | context: 128K | output: 4.096K | caps: none
- **nvidia/llama-3_1-nemotron-safety-guard-8b-v3** (llama-3.1-nemotron-safety-guard-8b-v3) — provider: Nvidia | context: 128K | output: 4.096K | caps: none
- **nvidia/llama-3_2-nemoretriever-300m-embed-v1** (llama-3_2-nemoretriever-300m-embed-v1) — provider: Nvidia | context: 32.768K | output: 2.048K | caps: none
- **nvidia/llama-nemotron-embed-vl-1b-v2** (llama-nemotron-embed-vl-1b-v2) — provider: Nvidia | context: 32.768K | output: 2.048K | caps: vision
- **nvidia/llama-nemotron-rerank-vl-1b-v2** (llama-nemotron-rerank-vl-1b-v2) — provider: Nvidia | context: 128K | output: 4.096K | caps: vision
- **nvidia/magpie-tts-zeroshot** (magpie-tts-zeroshot) — provider: Nvidia | context: ? | output: 4.096K | caps: none
- **nvidia/nemotron-3-content-safety** (nemotron-3-content-safety) — provider: Nvidia | context: 128K | output: 4.096K | caps: none
- **nvidia/nemotron-3-nano-30b-a3b** (nemotron-3-nano-30b-a3b) — provider: Nvidia | context: 131.072K | output: 131.072K | caps: tools, reasoning
- **nvidia/nemotron-3-nano-omni-30b-a3b-reasoning** (Nemotron 3 Nano Omni) — provider: Nvidia | context: 256K | output: 65.536K | caps: tools, vision, reasoning
- **nvidia/nemotron-content-safety-reasoning-4b** (nemotron-content-safety-reasoning-4b) — provider: Nvidia | context: 128K | output: 4.096K | caps: reasoning
- **nvidia/nemotron-mini-4b-instruct** (nemotron-mini-4b-instruct) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools
- **nvidia/nemotron-voicechat** (nemotron-voicechat) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools
- **nvidia/nv-embed-v1** (nv-embed-v1) — provider: Nvidia | context: 32.768K | output: 2.048K | caps: none
- **nvidia/nv-embedcode-7b-v1** (nv-embedcode-7b-v1) — provider: Nvidia | context: 32.768K | output: 2.048K | caps: none
- **nvidia/nvidia-nemotron-nano-9b-v2** (nvidia-nemotron-nano-9b-v2) — provider: Nvidia | context: 131.072K | output: 131.072K | caps: tools, reasoning
- **nvidia/rerank-qa-mistral-4b** (rerank-qa-mistral-4b) — provider: Nvidia | context: 128K | output: 4.096K | caps: none
- **nvidia/riva-translate-4b-instruct-v1_1** (riva-translate-4b-instruct-v1_1) — provider: Nvidia | context: 128K | output: 4.096K | caps: none
- **nvidia/sparsedrive** (sparsedrive) — provider: Nvidia | context: 128K | output: 8.192K | caps: none
- **nvidia/streampetr** (streampetr) — provider: Nvidia | context: 128K | output: 8.192K | caps: none
- **nvidia/studiovoice** (studiovoice) — provider: Nvidia | context: 128K | output: 8.192K | caps: none
- **nvidia/synthetic-video-detector** (synthetic-video-detector) — provider: Nvidia | context: ? | output: 4.096K | caps: none
- **nvidia/usdcode** (usdcode) — provider: Nvidia | context: 128K | output: 4.096K | caps: none
- **nvidia/usdvalidate** (usdvalidate) — provider: Nvidia | context: ? | output: 4.096K | caps: none
- **openai/gpt-oss-120b** (GPT-OSS-120B) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools, reasoning
- **openai/gpt-oss-20b** (GPT OSS 20B) — provider: Nvidia | context: 131.072K | output: 32.768K | caps: tools, reasoning
- **openai/whisper-large-v3** (Whisper Large v3) — provider: Nvidia | context: ? | output: 4.096K | caps: none
- **qwen/qwen-image** (Qwen Image) — provider: Nvidia | context: ? | output: ? | caps: vision
- **qwen/qwen-image-edit** (Qwen Image Edit) — provider: Nvidia | context: ? | output: ? | caps: vision
- **qwen/qwen2.5-coder-32b-instruct** (Qwen2.5 Coder 32b Instruct) — provider: Nvidia | context: 128K | output: 4.096K | caps: tools
- **qwen/qwen3-coder-480b-a35b-instruct** (Qwen3 Coder 480B A35B Instruct) — provider: Nvidia | context: 262.144K | output: 66.536K | caps: tools
- **qwen/qwen3-next-80b-a3b-instruct** (Qwen3-Next-80B-A3B-Instruct) — provider: Nvidia | context: 262.144K | output: 16.384K | caps: tools
- **qwen/qwen3.5-122b-a10b** (Qwen3.5 122B-A10B) — provider: Nvidia | context: 262.144K | output: 65.536K | caps: tools, vision, reasoning
- **qwen/qwen3.5-397b-a17b** (Qwen3.5-397B-A17B) — provider: Nvidia | context: 262.144K | output: 8.192K | caps: tools, vision, reasoning
- **sarvamai/sarvam-m** (sarvam-m) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools
- **stepfun-ai/step-3.5-flash** (Step 3.5 Flash) — provider: Nvidia | context: 256K | output: 16.384K | caps: tools, reasoning
- **stepfun-ai/step-3.7-flash** (Step 3.7 Flash) — provider: Nvidia | context: 256K | output: 16.384K | caps: tools, vision, reasoning
- **upstage/solar-10_7b-instruct** (solar-10.7b-instruct) — provider: Nvidia | context: 128K | output: 8.192K | caps: tools
- **z-ai/glm-5.2** (GLM-5.2) — provider: Nvidia | context: 1M | output: 131.072K | caps: tools, reasoning
- **big-pickle** (Big Pickle) — provider: OpenCode Zen | context: 200K | output: 32K | caps: tools, reasoning
- **deepseek-v4-flash-free** (DeepSeek V4 Flash Free) — provider: OpenCode Zen | context: 200K | output: 128K | caps: tools, reasoning
- **glm-4.7-free** (GLM-4.7 Free) — provider: OpenCode Zen | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **glm-5-free** (GLM-5 Free) — provider: OpenCode Zen | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **grok-code** (Grok Code Fast 1) — provider: OpenCode Zen | context: 256K | output: 256K | caps: tools, reasoning
- **hy3-free** (Hy3 Free) — provider: OpenCode Zen | context: 190K | output: 64K | caps: tools, reasoning
- **hy3-preview-free** (Hy3 preview Free) — provider: OpenCode Zen | context: 256K | output: 64K | caps: tools, reasoning
- **kimi-k2.5-free** (Kimi K2.5 Free) — provider: OpenCode Zen | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **laguna-s-2.1-free** (Laguna S 2.1 Free) — provider: OpenCode Zen | context: 256K | output: 32K | caps: tools, reasoning
- **ling-2.6-flash-free** (Ling 2.6 Flash Free) — provider: OpenCode Zen | context: 262.1K | output: 32.8K | caps: tools
- **ling-3.0-flash-free** (Ling-3.0-flash Free) — provider: OpenCode Zen | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **mimo-v2-flash-free** (MiMo V2 Flash Free) — provider: OpenCode Zen | context: 262.144K | output: 65.536K | caps: tools, reasoning
- **mimo-v2-omni-free** (MiMo V2 Omni Free) — provider: OpenCode Zen | context: 262.144K | output: 64K | caps: tools, vision, reasoning, pdf
- **mimo-v2-pro-free** (MiMo V2 Pro Free) — provider: OpenCode Zen | context: 1.048576M | output: 64K | caps: tools, reasoning
- **mimo-v2.5-free** (MiMo V2.5 Free) — provider: OpenCode Zen | context: 200K | output: 32K | caps: tools, vision, reasoning
- **minimax-m2.1-free** (MiniMax-M2.1 Free) — provider: OpenCode Zen | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **minimax-m2.5-free** (MiniMax-M2.5 Free) — provider: OpenCode Zen | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **minimax-m3-free** (MiniMax-M3 Free) — provider: OpenCode Zen | context: 200K | output: 32K | caps: tools, vision, reasoning
- **nemotron-3-super-free** (Nemotron 3 Super Free) — provider: OpenCode Zen | context: 204.8K | output: 128K | caps: tools, reasoning
- **nemotron-3-ultra-free** (Nemotron 3 Ultra Free) — provider: OpenCode Zen | context: 1M | output: 128K | caps: tools, reasoning
- **north-mini-code-free** (North Mini Code Free) — provider: OpenCode Zen | context: 256K | output: 64K | caps: tools, reasoning
- **qwen3.6-plus-free** (Qwen3.6 Plus Free) — provider: OpenCode Zen | context: 262.144K | output: 65.536K | caps: tools, vision, reasoning
- **ring-2.6-1t-free** (Ring 2.6 1T Free) — provider: OpenCode Zen | context: 262K | output: 66K | caps: tools, reasoning
- **trinity-large-preview-free** (Trinity Large Preview) — provider: OpenCode Zen | context: 131.072K | output: 131.072K | caps: tools
- **cohere/north-mini-code:free** (North Mini Code (free)) — provider: OpenRouter | context: 256K | output: 64K | caps: tools, reasoning
- **google/gemma-4-26b-a4b-it:free** (Gemma 4 26B A4B  (free)) — provider: OpenRouter | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **google/gemma-4-31b-it:free** (Gemma 4 31B (free)) — provider: OpenRouter | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **google/lyria-3-clip-preview** (Lyria 3 Clip Preview) — provider: OpenRouter | context: 1.048576M | output: 65.536K | caps: vision
- **google/lyria-3-pro-preview** (Lyria 3 Pro Preview) — provider: OpenRouter | context: 1.048576M | output: 65.536K | caps: vision
- **inclusionai/ling-3.0-flash:free** (Ling-3.0-flash (free)) — provider: OpenRouter | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **nvidia/nemotron-3-nano-30b-a3b:free** (Nemotron 3 Nano 30B A3B (free)) — provider: OpenRouter | context: 256K | output: 256K | caps: tools, reasoning
- **nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free** (Nemotron 3 Nano Omni (free)) — provider: OpenRouter | context: 256K | output: 65.536K | caps: tools, vision, reasoning
- **nvidia/nemotron-3-super-120b-a12b:free** (Nemotron 3 Super (free)) — provider: OpenRouter | context: 262.144K | output: 262.144K | caps: tools, reasoning
- **nvidia/nemotron-3-ultra-550b-a55b:free** (Nemotron 3 Ultra (free)) — provider: OpenRouter | context: 1M | output: 65.536K | caps: tools, reasoning
- **nvidia/nemotron-3.5-content-safety:free** (Nemotron 3.5 Content Safety (free)) — provider: OpenRouter | context: 128K | output: 8.192K | caps: vision, reasoning
- **nvidia/nemotron-nano-12b-v2-vl:free** (Nemotron Nano 12B 2 VL (free)) — provider: OpenRouter | context: 128K | output: 128K | caps: tools, vision, reasoning
- **nvidia/nemotron-nano-9b-v2:free** (Nemotron Nano 9B V2 (free)) — provider: OpenRouter | context: 128K | output: 128K | caps: tools, reasoning
- **openai/gpt-oss-20b:free** (gpt-oss-20b (free)) — provider: OpenRouter | context: 131.072K | output: 32.768K | caps: tools, reasoning
- **openrouter/free** (Free Models Router) — provider: OpenRouter | context: 200K | output: 8K | caps: tools, vision, reasoning
- **poolside/laguna-m.1:free** (Laguna M.1 (free)) — provider: OpenRouter | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **poolside/laguna-s-2.1:free** (Laguna S 2.1 (free)) — provider: OpenRouter | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **poolside/laguna-xs-2.1:free** (Laguna XS 2.1 (free)) — provider: OpenRouter | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **orcarouter/auto** (OrcaRouter Auto) — provider: OrcaRouter | context: 128K | output: 16.384K | caps: tools, vision
- **fireworks-ai/kimi-k2.5-fw** (Kimi-K2.5-FW) — provider: Poe | context: 262.144K | output: 16.384K | caps: tools, vision
- **google/gemma-4-31b** (Gemma-4-31B) — provider: Poe | context: 262.144K | output: 8.192K | caps: tools, vision
- **openai/gpt-5.3-codex-spark** (GPT-5.3-Codex-Spark) — provider: Poe | context: 128K | output: 16.384K | caps: tools, reasoning
- **poolside/laguna-m.1** (Laguna M.1) — provider: Poolside | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **poolside/laguna-s-2.1** (Laguna S 2.1) — provider: Poolside | context: 1.048576M | output: 32.768K | caps: tools, reasoning
- **poolside/laguna-xs-2.1** (Laguna XS 2.1) — provider: Poolside | context: 262.144K | output: 32.768K | caps: tools, reasoning
- **gpt-oss-120b** (gpt-oss-120b) — provider: Privatemode AI | context: 128K | output: 128K | caps: tools, reasoning
- **kimi-k2.6** (Kimi K2.6) — provider: Privatemode AI | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **qwen3-embedding-4b** (Qwen3-Embedding 4B) — provider: Privatemode AI | context: 32K | output: 2.56K | caps: none
- **voxtral-mini-3b** (Voxtral Mini 3B) — provider: Privatemode AI | context: 32K | output: 32K | caps: none
- **whisper-large-v3** (Whisper large-v3) — provider: Privatemode AI | context: ? | output: 4.096K | caps: none
- **deepseek-ai/DeepSeek-OCR** (deepseek-ai/DeepSeek-OCR) — provider: SiliconFlow (China) | context: 8.192K | output: 8.192K | caps: vision
- **PaddlePaddle/PaddleOCR-VL-1.5** (PaddlePaddle/PaddleOCR-VL-1.5) — provider: SiliconFlow (China) | context: 16.384K | output: 16.384K | caps: vision
- **Qwen/Qwen3.5-4B** (Qwen/Qwen3.5-4B) — provider: SiliconFlow (China) | context: 262.144K | output: 65.536K | caps: tools, vision, reasoning
- **glm-5** (GLM-5) — provider: Tencent Coding Plan (China) | context: 202.752K | output: 16.384K | caps: tools, reasoning
- **hunyuan-2.0-instruct** (Tencent HY 2.0 Instruct) — provider: Tencent Coding Plan (China) | context: 131.072K | output: 16.384K | caps: tools
- **hunyuan-2.0-thinking** (Tencent HY 2.0 Think) — provider: Tencent Coding Plan (China) | context: 131.072K | output: 16.384K | caps: tools, reasoning
- **hunyuan-t1** (Hunyuan-T1) — provider: Tencent Coding Plan (China) | context: 131.072K | output: 16.384K | caps: tools, reasoning
- **hunyuan-turbos** (Hunyuan-TurboS) — provider: Tencent Coding Plan (China) | context: 131.072K | output: 16.384K | caps: tools
- **kimi-k2.5** (Kimi-K2.5) — provider: Tencent Coding Plan (China) | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **minimax-m2.5** (MiniMax-M2.5) — provider: Tencent Coding Plan (China) | context: 204.8K | output: 32.768K | caps: tools, reasoning
- **tc-code-latest** (Auto) — provider: Tencent Coding Plan (China) | context: 131.072K | output: 16.384K | caps: tools
- **hy3** (Hy3) — provider: Tencent Token Plan | context: 256K | output: 64K | caps: tools, reasoning
- **hy3** (Hy3) — provider: Tencent TokenHub | context: 256K | output: 64K | caps: tools, reasoning
- **hy3-preview** (Hy3 preview) — provider: Tencent TokenHub | context: 256K | output: 64K | caps: tools, reasoning
- **umans-coder** (Umans Coder) — provider: Umans AI Coding Plan | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **umans-flash** (Umans Flash) — provider: Umans AI Coding Plan | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **umans-glm-5.1** (GLM 5.1) — provider: Umans AI Coding Plan | context: 204.8K | output: 131.072K | caps: tools, vision, reasoning
- **umans-glm-5.2** (GLM 5.2) — provider: Umans AI Coding Plan | context: 405.504K | output: 131.072K | caps: tools, vision, reasoning
- **umans-kimi-k2.7** (Kimi K2.7 Code) — provider: Umans AI Coding Plan | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **umans-qwen3.6-35b-a3b** (Qwen3.6 35B A3B) — provider: Umans AI Coding Plan | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **deepseek-v4-flash:free** (DeepSeek V4 Flash) — provider: UnoRouter | context: 1M | output: 384K | caps: tools, reasoning
- **deepseek-v4-pro:free** (DeepSeek V4 Pro) — provider: UnoRouter | context: 1M | output: 384K | caps: tools, reasoning
- **gemma-4-31b-it:free** (Gemma 4 31B IT) — provider: UnoRouter | context: 262.144K | output: 32.768K | caps: tools, vision, reasoning
- **glm-4.5-flash:free** (GLM-4.5-Flash) — provider: UnoRouter | context: 131.072K | output: 98.304K | caps: tools, reasoning
- **glm-5.2:free** (GLM-5.2) — provider: UnoRouter | context: 1M | output: 131.072K | caps: tools, reasoning
- **gpt-5.4:free** (GPT-5.4) — provider: UnoRouter | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **gpt-5.5:free** (GPT-5.5) — provider: UnoRouter | context: 1.05M | output: 128K | caps: tools, vision, reasoning, pdf
- **minimax-m2.7:free** (MiniMax-M2.7) — provider: UnoRouter | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **nemotron-3-ultra-550b-a55b:free** (Nemotron 3 Ultra 550B A55B) — provider: UnoRouter | context: 1M | output: 128K | caps: tools, reasoning
- **qwen3.5-397b-a17b:free** (Qwen3.5 397B-A17B) — provider: UnoRouter | context: 262.144K | output: 65.536K | caps: tools, vision, reasoning
- **step-3.7-flash:free** (Step 3.7 Flash) — provider: UnoRouter | context: 256K | output: 256K | caps: tools, vision, reasoning
- **inclusionai/ling-3.0-flash-free** (Ling 3.0 Flash) — provider: Vercel AI Gateway | context: 256K | output: 256K | caps: tools, reasoning
- **meta/llama-3.3-70b** (Llama-3.3-70B-Instruct) — provider: Vercel AI Gateway | context: 128K | output: 4.096K | caps: tools
- **meta/llama-4-maverick** (Llama-4-Maverick-17B-128E-Instruct-FP8) — provider: Vercel AI Gateway | context: 128K | output: 4.096K | caps: tools, vision
- **meta/llama-4-scout** (Llama-4-Scout-17B-16E-Instruct-FP8) — provider: Vercel AI Gateway | context: 128K | output: 4.096K | caps: tools, vision
- **poolside/laguna-s-2.1-free** (Laguna S 2.1 Free) — provider: Vercel AI Gateway | context: 256K | output: 32.768K | caps: tools, reasoning
- **mimo-v2-pro** (MiMo-V2-Pro) — provider: Xiaomi Token Plan (China) | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2-tts** (MiMo-V2-TTS) — provider: Xiaomi Token Plan (China) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5** (MiMo-V2.5) — provider: Xiaomi Token Plan (China) | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **mimo-v2.5-pro** (MiMo-V2.5-Pro) — provider: Xiaomi Token Plan (China) | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2.5-tts** (MiMo-V2.5-TTS) — provider: Xiaomi Token Plan (China) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5-tts-voiceclone** (MiMo-V2.5-TTS-VoiceClone) — provider: Xiaomi Token Plan (China) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5-tts-voicedesign** (MiMo-V2.5-TTS-VoiceDesign) — provider: Xiaomi Token Plan (China) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2-pro** (MiMo-V2-Pro) — provider: Xiaomi Token Plan (Europe) | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2-tts** (MiMo-V2-TTS) — provider: Xiaomi Token Plan (Europe) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5** (MiMo-V2.5) — provider: Xiaomi Token Plan (Europe) | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **mimo-v2.5-pro** (MiMo-V2.5-Pro) — provider: Xiaomi Token Plan (Europe) | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2.5-tts** (MiMo-V2.5-TTS) — provider: Xiaomi Token Plan (Europe) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5-tts-voiceclone** (MiMo-V2.5-TTS-VoiceClone) — provider: Xiaomi Token Plan (Europe) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5-tts-voicedesign** (MiMo-V2.5-TTS-VoiceDesign) — provider: Xiaomi Token Plan (Europe) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2-pro** (MiMo-V2-Pro) — provider: Xiaomi Token Plan (Singapore) | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2-tts** (MiMo-V2-TTS) — provider: Xiaomi Token Plan (Singapore) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5** (MiMo-V2.5) — provider: Xiaomi Token Plan (Singapore) | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **mimo-v2.5-pro** (MiMo-V2.5-Pro) — provider: Xiaomi Token Plan (Singapore) | context: 1.048576M | output: 131.072K | caps: tools, reasoning
- **mimo-v2.5-tts** (MiMo-V2.5-TTS) — provider: Xiaomi Token Plan (Singapore) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5-tts-voiceclone** (MiMo-V2.5-TTS-VoiceClone) — provider: Xiaomi Token Plan (Singapore) | context: 8.192K | output: 8.192K | caps: none
- **mimo-v2.5-tts-voicedesign** (MiMo-V2.5-TTS-VoiceDesign) — provider: Xiaomi Token Plan (Singapore) | context: 8.192K | output: 8.192K | caps: none
- **glm-4.5-air** (GLM-4.5-Air) — provider: Z.AI Coding Plan | context: 131.072K | output: 98.304K | caps: tools, reasoning
- **glm-4.7** (GLM-4.7) — provider: Z.AI Coding Plan | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **glm-5-turbo** (GLM-5-Turbo) — provider: Z.AI Coding Plan | context: 200K | output: 131.072K | caps: tools, reasoning
- **glm-5.1** (GLM-5.1) — provider: Z.AI Coding Plan | context: 200K | output: 131.072K | caps: tools, reasoning
- **glm-5.2** (GLM-5.2) — provider: Z.AI Coding Plan | context: 1M | output: 131.072K | caps: tools, reasoning
- **glm-5v-turbo** (GLM-5V-Turbo) — provider: Z.AI Coding Plan | context: 200K | output: 131.072K | caps: tools, vision, reasoning, pdf
- **glm-4.5-flash** (GLM-4.5-Flash) — provider: Z.AI | context: 131.072K | output: 98.304K | caps: tools, reasoning
- **glm-4.7-flash** (GLM-4.7-Flash) — provider: Z.AI | context: 200K | output: 131.072K | caps: tools, reasoning
- **z-code** (Z-Code) — provider: Zeldoc | context: 1M | output: 131.072K | caps: tools, reasoning
- **anthropic/claude-sonnet-5-free** (Claude Sonnet 5 (Free)) — provider: ZenMux | context: 1M | output: 128K | caps: tools, vision, reasoning, pdf
- **moonshotai/kimi-k2.7-code-free** (Kimi K2.7 Code (Free)) — provider: ZenMux | context: 262.144K | output: 262.144K | caps: tools, vision, reasoning
- **moonshotai/kimi-k3-free** (Kimi K3 (Free)) — provider: ZenMux | context: 1.048576M | output: 131.072K | caps: tools, vision, reasoning
- **stepfun/step-3.7-flash-free** (Step 3.7 Flash (Free)) — provider: ZenMux | context: 256K | output: 256K | caps: tools, vision, reasoning
- **z-ai/glm-4.6v-flash-free** (GLM 4.6V Flash (Free)) — provider: ZenMux | context: 200K | output: 64K | caps: tools, vision, reasoning
- **z-ai/glm-4.7-flash-free** (GLM 4.7 Flash (Free)) — provider: ZenMux | context: 200K | output: 64K | caps: tools, reasoning
- **z-ai/glm-5.2-free** (GLM 5.2 (Free)) — provider: ZenMux | context: 1M | output: 131.072K | caps: tools, reasoning
- **glm-4.5-air** (GLM-4.5-Air) — provider: Zhipu AI Coding Plan | context: 131.072K | output: 98.304K | caps: tools, reasoning
- **glm-4.7** (GLM-4.7) — provider: Zhipu AI Coding Plan | context: 204.8K | output: 131.072K | caps: tools, reasoning
- **glm-5-turbo** (GLM-5-Turbo) — provider: Zhipu AI Coding Plan | context: 200K | output: 131.072K | caps: tools, reasoning
- **glm-5.1** (GLM-5.1) — provider: Zhipu AI Coding Plan | context: 200K | output: 131.072K | caps: tools, reasoning
- **glm-5.2** (GLM-5.2) — provider: Zhipu AI Coding Plan | context: 1M | output: 131.072K | caps: tools, reasoning
- **glm-5v-turbo** (GLM-5V-Turbo) — provider: Zhipu AI Coding Plan | context: 200K | output: 131.072K | caps: tools, vision, reasoning, pdf
- **glm-4.5-flash** (GLM-4.5-Flash) — provider: Zhipu AI | context: 131.072K | output: 98.304K | caps: tools, reasoning
- **glm-4.7-flash** (GLM-4.7-Flash) — provider: Zhipu AI | context: 200K | output: 131.072K | caps: tools, reasoning

## OpenRouter free models (Atlas is OpenRouter-first)

Base URL: https://openrouter.ai/api/v1 (use as custom provider: https://openrouter.ai/api/v1)

- **cohere/north-mini-code:free** (North Mini Code (free)) | ctx 256K | out 64K | tools, reasoning
- **google/gemma-4-26b-a4b-it:free** (Gemma 4 26B A4B  (free)) | ctx 262.144K | out 32.768K | tools, vision, reasoning
- **google/gemma-4-31b-it:free** (Gemma 4 31B (free)) | ctx 262.144K | out 32.768K | tools, vision, reasoning
- **google/lyria-3-clip-preview** (Lyria 3 Clip Preview) | ctx 1.048576M | out 65.536K | vision
- **google/lyria-3-pro-preview** (Lyria 3 Pro Preview) | ctx 1.048576M | out 65.536K | vision
- **inclusionai/ling-3.0-flash:free** (Ling-3.0-flash (free)) | ctx 262.144K | out 32.768K | tools, reasoning
- **nvidia/nemotron-3-nano-30b-a3b:free** (Nemotron 3 Nano 30B A3B (free)) | ctx 256K | out 256K | tools, reasoning
- **nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free** (Nemotron 3 Nano Omni (free)) | ctx 256K | out 65.536K | tools, vision, reasoning
- **nvidia/nemotron-3-super-120b-a12b:free** (Nemotron 3 Super (free)) | ctx 262.144K | out 262.144K | tools, reasoning
- **nvidia/nemotron-3-ultra-550b-a55b:free** (Nemotron 3 Ultra (free)) | ctx 1M | out 65.536K | tools, reasoning
- **nvidia/nemotron-3.5-content-safety:free** (Nemotron 3.5 Content Safety (free)) | ctx 128K | out 8.192K | vision, reasoning
- **nvidia/nemotron-nano-12b-v2-vl:free** (Nemotron Nano 12B 2 VL (free)) | ctx 128K | out 128K | tools, vision, reasoning
- **nvidia/nemotron-nano-9b-v2:free** (Nemotron Nano 9B V2 (free)) | ctx 128K | out 128K | tools, reasoning
- **openai/gpt-oss-20b:free** (gpt-oss-20b (free)) | ctx 131.072K | out 32.768K | tools, reasoning
- **openrouter/free** (Free Models Router) | ctx 200K | out 8K | tools, vision, reasoning
- **poolside/laguna-m.1:free** (Laguna M.1 (free)) | ctx 262.144K | out 32.768K | tools, reasoning
- **poolside/laguna-s-2.1:free** (Laguna S 2.1 (free)) | ctx 262.144K | out 32.768K | tools, reasoning
- **poolside/laguna-xs-2.1:free** (Laguna XS 2.1 (free)) | ctx 262.144K | out 32.768K | tools, reasoning

## ClinePass (cline.bot) models — NONE are free

Base URL: https://api.cline.bot/api/v1 | env: ["CLINE_API_KEY"]
All 11 models are PAID (none have zero pricing):

- cline-pass/deepseek-v4-flash — $0.14/$0.28 per 1M tokens
- cline-pass/deepseek-v4-pro — $1.74/$3.48 per 1M tokens
- cline-pass/glm-5.2 — $1.4/$4.4 per 1M tokens
- cline-pass/kimi-k2.6 — $0.95/$4 per 1M tokens
- cline-pass/kimi-k2.7-code — $0.95/$4 per 1M tokens
- cline-pass/kimi-k3 — $3/$15 per 1M tokens
- cline-pass/mimo-v2.5 — $0.14/$0.28 per 1M tokens
- cline-pass/mimo-v2.5-pro — $1.74/$3.48 per 1M tokens
- cline-pass/minimax-m3 — $0.3/$1.2 per 1M tokens
- cline-pass/qwen3.7-max — $2.5/$7.5 per 1M tokens
- cline-pass/qwen3.7-plus — $0.4/$1.6 per 1M tokens