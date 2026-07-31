const SYSTEM_PROMPT =
  'You are a helpful math assistant. You must first think about the reasoning process ' +
  'and then provide the user with the final answer.\n' +
  'Your reasoning process must be enclosed within <think> and </think> tags.\n' +
  'Your final answer must be a single mathematical expression using the provided numbers ' +
  'only once, and operators (+, -, *) that evaluates exactly to the target.\n' +
  'Enclose your final expression entirely within <answer> and </answer> tags.\n' +
  'Do not include anything else inside the answer tags.';

// RunPod endpoint IDs
const ENDPOINTS = {
  base:      'ps3sbdamdy0eun',
  finetuned: 'lfacxikcxdh65t'
};

// Qwen2.5 chat template format
function buildPrompt(userPrompt) {
  return (
    `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n` +
    `<|im_start|>user\n${userPrompt}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>`
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { numbers, target, model } = req.body || {};

  if (!numbers || numbers.length !== 3 || target === undefined) {
    return res.status(400).json({ error: 'Provide numbers (array of 3) and target.' });
  }
  if (!['base', 'finetuned'].includes(model)) {
    return res.status(400).json({ error: 'model must be "base" or "finetuned".' });
  }

  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RUNPOD_API_KEY not set in environment variables.' });
  }

  const endpointId = ENDPOINTS[model];
  const url = `https://api.runpod.ai/v2/${endpointId}/runsync`;

  const userPrompt =
    `Using the numbers ${numbers.join(', ')}, create a mathematical expression ` +
    `using each number exactly once with operators (+, -, *) that equals ${target}.`;

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        input: {
          prompt: buildPrompt(userPrompt),
          max_new_tokens: 600,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `RunPod returned ${response.status}: ${errText}` });
    }

    const data = await response.json();
    const inferenceTime = Date.now() - startTime;

    if (data.status === 'FAILED') {
      return res.status(502).json({ error: `RunPod job failed: ${JSON.stringify(data.error)}` });
    }

    // Parse output — RunPod vLLM can return string, array, or object
    const out = data.output;
    let rawOutput =
      typeof out === 'string'                        ? out
      : Array.isArray(out)                           ? (out[0]?.text ?? out[0] ?? '')
      : out?.choices?.[0]?.message?.content          ? out.choices[0].message.content
      : out?.text                                    ? out.text
      : JSON.stringify(out);

    // The prompt was prefilled with <think>, prepend it back so parsing works
    rawOutput = '<think>' + rawOutput;

    const tokenCount = out?.usage?.completion_tokens ?? null;

    return res.status(200).json({
      raw_output: rawOutput,
      inference_time_ms: inferenceTime,
      token_count: tokenCount
    });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach RunPod.' });
  }
};
