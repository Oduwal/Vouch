import { checkAccount, isAccountId } from "../../../lib/signals";

export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account")?.trim().toLowerCase() ?? "";

  if (!isAccountId(account)) {
    return Response.json(
      { error: "Enter a NEAR account name, like wrap.near, or a 64-character implicit account." },
      { status: 400 },
    );
  }

  try {
    return Response.json(await checkAccount(account), {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return Response.json({ error: "The NEAR RPC didn't answer in time. Try again in a moment." }, { status: 502 });
  }
}
