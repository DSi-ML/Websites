const SYSTEM_PROMPT =
  'You are a helpful math assistant. You must first think about the reasoning process ' +
  'and then provide the user with the final answer.\n' +
  'Your reasoning process must be enclosed within <think> and </think> tags.\n' +
  'Your final answer must be a single mathematical expression using the provided numbers ' +
  'only once, and operators (+, -, *) that evaluates exactly to the target.\n' +
  'Enclose your final expression entirely within <answer> and </answer> tags.\n' +
  'Do not include anything else inside the answer tags.';

module.exports = async function handler(req, res) {
  // CORS headers for local dev / cross-origin calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { numbers, target, model } = req.body || {};

  if (!numbers || numbers.length !== 3 || target === undefined) {
    return res.status(400).json({ error: 'Provide numbers (array of 3) and target.' });
  }
  if (!['base', 'finetuned'].includes(model)) {
    return res.status(400).json({ error: 'model must be "base" or "finetuned".' });
  }

  const baseUrl = model === 'base'
    ? process.env.RUNPOD_BASE_URL
    : process.env.RUNPOD_FT_URL;

  const apiKey = process.env.RUNPOD_API_KEY || '';

  if (!baseUrl) {
    return res.status(500).json({
      error: `RunPod URL not configured. Set ${model === 'base' ? 'RUNPOD_BASE_URL' : 'RUNPOD_FT_URL'} in Vercel environment variables.`
    });
  }

  const userPrompt =
    `Using the numbers ${numbers.join(', ')}, create a mathematical expression ` +
    `using each number exactly once with operators (+, -, *) that equals ${target}.`;

  const startTime = Date.now();

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt }
        ],
        max_tokens: 600,
        temperature: 0.7,
        stream: false
      }),
      // Vercel Edge timeout handled by vercel.json; native fetch has no timeout param
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `RunPod returned ${response.status}: ${errText}` });
    }

    const data = await response.json();
    const inferenceTime = Date.now() - startTime;

    const rawOutput = data?.choices?.[0]?.message?.content ?? '';
    const tokenCount = data?.usage?.completion_tokens ?? null;

    return res.status(200).json({
      raw_output: rawOutput,
      inference_time_ms: inferenceTime,
      token_count: tokenCount
    });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to reach RunPod endpoint.' });
  }
};
