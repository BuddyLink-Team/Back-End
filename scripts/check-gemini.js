/**
 * Check the Gemini key: list the models it can call, then send one short request with the configured
 * model (GEMINI_MODEL) to make sure the key, the model name and the free-tier quota all work.
 * Run it locally and on the deploy server before enabling the AI assistant.
 *
 * Usage:
 *   npm run ai:check
 */
/* eslint-disable no-console -- CLI script output */
import env from '../src/config/env.js';
import geminiAdapter from '../src/integrations/ai/gemini.adapter.js';

const main = async () => {
  console.log(`Main model:     ${env.AI.GEMINI_MODEL}`);
  console.log(`Fallback model: ${env.AI.GEMINI_FALLBACK_MODEL}`);

  const models = await geminiAdapter.listModels();
  console.log(`\nModels available to this key (${models.length}):`);
  models.forEach((name) => console.log(`  - ${name.replace(/^models\//, '')}`));

  const missing = [env.AI.GEMINI_MODEL, env.AI.GEMINI_FALLBACK_MODEL].filter(
    (model) => !models.some((name) => name.replace(/^models\//, '') === model)
  );
  if (missing.length) {
    console.warn(`\nNot in the list above: ${missing.join(', ')}. Update GEMINI_MODEL / GEMINI_FALLBACK_MODEL.`);
  }

  const startedAt = Date.now();
  const result = await geminiAdapter.generateContent({
    systemInstruction: 'Reply with one short sentence in Vietnamese.',
    contents: [{ role: 'user', parts: [{ text: 'Xin chào!' }] }],
  });
  console.log(`\nPing OK with ${result.model} in ${Date.now() - startedAt} ms: "${result.text}"`);
  console.log(`Tokens: ${JSON.stringify(result.usage)}`);
};

main().catch((error) => {
  console.error(`\nGemini check failed: [${error.code || error.name}] ${error.message}`);
  process.exitCode = 1;
});
