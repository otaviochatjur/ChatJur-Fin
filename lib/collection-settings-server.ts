import { supabaseRequest } from "./supabase-server";
import { DEFAULT_COLLECTION_SETTINGS, type CollectionSettings } from "./collection-rules";
export async function readCollectionSettings() {
  const [row] = await supabaseRequest<{ config: CollectionSettings }[]>("/rest/v1/collection_settings?select=config&limit=1");
  return row?.config ?? structuredClone(DEFAULT_COLLECTION_SETTINGS);
}
