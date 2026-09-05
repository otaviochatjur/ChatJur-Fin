import { readClientSheet } from "@/lib/google-client-sheet";
import { importSheetClients } from "@/lib/sheets-clients";

export async function POST() {
  try {
    return Response.json(await importSheetClients(await readClientSheet()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao sincronizar clientes." }, { status: 500 });
  }
}
