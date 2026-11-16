// A tiny OpenAI-compatible chat-completions server for end-to-end tests of live mode, tool calling and errors.
//   node e2e/mock-openai.mjs 3901
// Behaviour, decided from each request (stateless):
//   - message contains "FAIL401"           -> HTTP 401 (bad key)
//   - tools offered and the last turn is the user's -> call the first offered tool with sensible arguments
//   - otherwise                             -> stream "Final answer: <last tool result or echo>" and report usage
// Orchestration roles (checked first):
//   - the planner                           -> a 3-task plan; T2 asks for url_fetch (needs approval) unless the goal says NOTOOLS
//   - a task ("Your task (T<n>)")           -> "Result of T<n> from <agent>." (no tool calls, so runs are deterministic)
//   - the synthesizer                       -> an answer citing [T1] and [T3]
import http from 'node:http';

const port = Number(process.argv[2] || 3901);
const ARGS = { calculator: { expression: '6*7' }, current_time: { timezone: 'UTC' }, url_fetch: { url: 'https://example.com' } };

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
  const r = JSON.parse(body);
  const last = r.messages.at(-1);
  const text = JSON.stringify(r.messages);
  if (text.includes('FAIL401')) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"Incorrect API key"}}'); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const system = String(r.messages[0]?.content ?? '');
  const stream = (t, usage) => { for (const word of t.split(' ')) send({ choices: [{ delta: { content: word + ' ' } }] }); send({ choices: [], usage }); res.end('data: [DONE]\n\n'); };
  if (system.includes('You are the planner')) {
    const tools = last.content.includes('NOTOOLS') ? [] : ['url_fetch'];
    return stream(JSON.stringify({ summary: 'Research and review in parallel, then recommend.', tasks: [
      { id: 'T1', title: 'Gather key facts', agentId: 'research-agent', instruction: 'List the key facts.', dependsOn: [], tools: [] },
      { id: 'T2', title: 'Check the reference page', agentId: 'seo-specialist', instruction: 'Review https://example.com.', dependsOn: [], tools },
      { id: 'T3', title: 'Write recommendations', agentId: 'project-manager', instruction: 'Recommend next steps.', dependsOn: ['T1', 'T2'], tools: [] }
    ] }), { prompt_tokens: 300, completion_tokens: 80 });
  }
  if (system.includes('You combine the results')) return stream('## Recommendation\n\nThe facts point one way [T1]. Next, do the recommended steps [T3].', { prompt_tokens: 200, completion_tokens: 30 });
  const task = /Your task \((T\d+)\)/.exec(String(last.content))?.[1];
  if (task) return stream(`Result of ${task} from ${r.model}.`, { prompt_tokens: 50, completion_tokens: 8 });
  if (r.tools?.length && last.role === 'user') {
    const name = r.tools[0].function.name;
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, function: { name, arguments: JSON.stringify(ARGS[name] ?? {}) } }] } }] });
    send({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 6 } });
  } else {
    const answer = last.role === 'tool' ? `Final answer: ${last.content}` : `Final answer from ${r.model}.`;
    for (const word of answer.split(' ')) send({ choices: [{ delta: { content: word + ' ' } }] });
    send({ choices: [], usage: { prompt_tokens: 60, completion_tokens: 9 } });
  }
  res.end('data: [DONE]\n\n');
}).listen(port, () => console.log(`mock OpenAI on :${port}`));
