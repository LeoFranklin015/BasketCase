// meme.cooking's top graduated memes, with whether NEAR Intents 1Click can route each one.
// Never a 500: any failure answers { memes: [] }. Logic and caching: src/lib/server/memecooking.ts.
import { loadMemes } from "@/lib/server/memecooking";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memes = await loadMemes();
    return Response.json({ memes }, { headers: { "cache-control": "public, max-age=60, s-maxage=300" } });
  } catch {
    return Response.json({ memes: [] });
  }
}
