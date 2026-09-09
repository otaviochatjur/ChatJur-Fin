import { syncClientsFromSheet } from "@/lib/client-sheet-sync";

export async function POST() {
  try {
    return Response.json(await syncClientsFromSheet());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível sincronizar a Base de Clientes." }, { status: 500 });
  }
}
