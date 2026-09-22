import "./queue/executionWorker";
import { publishPendingOutbox } from "./outbox/publisher";
console.log("[vertice-worker] execution worker started");
const timer=setInterval(()=>publishPendingOutbox(100).catch(error=>console.error("[vertice-outbox]",error instanceof Error?error.message:"publish failed")),1000);
const shutdown=async(signal:string)=>{clearInterval(timer);console.log("[vertice-worker] "+signal);const {executionWorker}=await import("./queue/executionWorker.js");await executionWorker.close();process.exit(0);};
process.once("SIGTERM",()=>shutdown("SIGTERM"));process.once("SIGINT",()=>shutdown("SIGINT"));
