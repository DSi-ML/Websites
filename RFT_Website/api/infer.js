const SYSTEM_PROMPT =
  'You are a helpful math assistant. You must first think about the reasoning process ' +
  'and then provide the user with the final answer.\n' +
  'Your reasoning process must be enclosed within <think> and </think> tags.\n' +
  'Your final answer must be a single mathematical expression using the provided numbers ' +
  'only once, and operators (+, -, *) that evaluates exactly to the target.\n' +
  'Enclose your final expression entirely within <answer> and </answer> tags.\n' +
  'Do not include anything else inside the answer tags.';

const ENDPOINTS = {
  base:      'https://api.runpod.ai/v2/ps3sbdamdy0eun/run',
  finetuned: 'https://api.runpod.ai/v2/lfacxikcxdh65t/run'
};

// Qwen2.5 chat template — prefill with <think> to match training format
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
  // Temporary debug — remove after confirming key is correct
  console.log('API key prefix:', apiKey.slice(0, 8), '| length:', apiKey.length);

  const userPrompt =
    `Using the numbers ${numbers.join(', ')}, create a mathematical expression ` +
    `using each number exactly once with operators (+, -, *) that equals ${target}.`;

  const startTime = Date.now();

  try {
    const response = await fetch(ENDPOINTS[model], {
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

    // /run returns {id, status} immediately — job is async, not yet complete
    if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') {
      return res.status(202).json({
        error: 'RunPod job is queued/in-progress. Use /runsync endpoint or poll for status.',
        job_id: data.id
      });
    }

    // Parse output — RunPod vLLM can return string, array, or OpenAI-style object
    const out = data.output;
    let rawOutput =
      typeof out === 'string'               ? out
      : Array.isArray(out)                  ? (out[0]?.text ?? out[0] ?? '')
      : out?.choices?.[0]?.message?.content ? out.choices[0].message.content
      : out?.text                           ? out.text
      : JSON.stringify(out);

    // Prepend <think> back since we prefilled it in the prompt
    rawOutput = '<think>' + rawOutput;

    return res.status(200).json({
      raw_output: rawOutput,
      inference_time_ms: inferenceTime,
      token_count: null
    });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach RunPod.' });
  }
};
