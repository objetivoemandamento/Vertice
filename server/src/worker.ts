import "./queue/executionWorker";
console.log("[vertice-worker] execution worker started");
process.on("SIGTERM", async () => {
  const { executionWorker } = await import("./queue/executionWorker");
  await executionWorker.close();
  process.exit(0);
});
process.on("SIGINT", async () => {
  const { executionWorker } = await import("./queue/executionWorker");
  await executionWorker.close();
  process.exit(0);
});
