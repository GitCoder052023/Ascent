import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { csvCell } from "../csv";
import { RAW_CSV_COLUMNS } from "../rawTypes";
import { getAllRawObservations } from "./rawStore";
import { getAllRecordingSessions } from "./sessionStore";

export async function exportDatasetFromDb(format: "csv" | "json"): Promise<void> {
  const [items, sessions] = await Promise.all([
    getAllRawObservations(),
    getAllRecordingSessions(),
  ]);
  const filename = `raw-sensor-dataset-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
  const file = new File(Paths.cache, filename);

  const contents =
    format === "json"
      ? JSON.stringify(
          {
            sessions,
            observations: items,
          },
          null,
          2
        )
      : [
          RAW_CSV_COLUMNS.join(","),
          ...items.map((item) =>
            RAW_CSV_COLUMNS.map((key) => csvCell(item[key])).join(",")
          ),
        ].join("\n");

  file.write(contents);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is unavailable on this device.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: format === "csv" ? "text/csv" : "application/json",
    dialogTitle: "Export raw sensor dataset",
  });
}
