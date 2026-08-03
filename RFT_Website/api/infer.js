const SYSTEM_PROMPT =
  'You are a helpful math assistant. You must first think about the reasoning process ' +
  'and then provide the user with the final answer.\n' +
  'Your reasoning process must be enclosed within <think> and </think> tags.\n' +
  'Your final answer must be a single mathematical expression using the provided numbers ' +
  'only once, and operators (+, -, *) that evaluates exactly to the target.\n' +
  'Enclose your final expression entirely within <answer> and </answer> tags.\n' +
  'Do not include anything else inside the answer tags.';

const ENDPOINTS = {
  base:      'https://api.runpod.ai/v2/yhuyaliahjacz3',
  finetuned: 'https://api.runpod.ai/v2/lrbbfw05fncwfy'
};

function buildMessages(userPrompt) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userPrompt    }
  ];
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const base = ENDPOINTS[model];
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const userPrompt =
    `Using the numbers [${numbers.join(', ')}], create an equation using +, -, and * ` +
    `that evaluates exactly to the target ${target}.`;

  const startTime = Date.now();

  try {
    // Step 1 — submit job
    const submitRes = await fetch(`${base}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: {
          openai_route: '/v1/chat/completions',
          openai_input: {
            messages:    buildMessages(userPrompt),
            max_tokens:  400,
            temperature: 0       // greedy — matches do_sample=False in eval
          }
        }
      })
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      return res.status(502).json({ error: `RunPod submit failed ${submitRes.status}: ${errText}` });
    }

    const { id: jobId } = await submitRes.json();

    // Step 2 — poll until COMPLETED (max ~100s)
    let output = null;
    for (let i = 0; i < 33; i++) {
      await sleep(3000);
      const pollRes = await fetch(`${base}/status/${jobId}`, { headers });
      const pollData = await pollRes.json();

      if (pollData.status === 'COMPLETED') {
        output = pollData.output;
        break;
      }
      if (pollData.status === 'FAILED') {
        return res.status(502).json({ error: `RunPod job failed: ${JSON.stringify(pollData.error)}` });
      }
    }

    if (!output) {
      return res.status(504).json({ error: 'RunPod job timed out (>100s). Try again.' });
    }

    const inferenceTime = Date.now() - startTime;

    // output is an array: [{ choices: [{ message: { content: "..." } }], usage: {...} }]
    const rawOutput  = output[0]?.choices?.[0]?.message?.content ?? '';
    const tokenCount = output[0]?.usage?.completion_tokens ?? null;

    return res.status(200).json({
      raw_output:        rawOutput,
      inference_time_ms: inferenceTime,
      token_count:       tokenCount
    });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach RunPod.' });
  }
};
