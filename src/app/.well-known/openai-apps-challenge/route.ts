// OpenAI's domain verification for the ChatGPT plugin: the plugin
// submission portal shows a token to host here (OPENAI_APPS_CHALLENGE).
export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
