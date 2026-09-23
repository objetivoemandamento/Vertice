import { strict as assert } from "node:assert";
import { runSandbox } from "../src/sandbox/codeRunner";

async function main(){
  const network=await runSandbox({language:"javascript",code:"fetch('https://example.com').then(()=>process.exit(0)).catch(()=>process.exit(7));",timeoutMs:5000});
  assert.equal(network.timedOut,false);
  assert.notEqual(network.exitCode,0);

  const filesystem=await runSandbox({language:"javascript",code:"require('node:fs').writeFileSync('/host-escape','owned');",timeoutMs:5000});
  assert.notEqual(filesystem.exitCode,0);

  const started=Date.now();
  const cpu=await runSandbox({language:"javascript",code:"for(;;){}",timeoutMs:1000,cpuSeconds:1});
  assert.ok(cpu.timedOut || cpu.exitCode !== 0);
  assert.ok(Date.now()-started < 10000);

  console.log("PASS sandbox: network-none, read-only containment, timeout");
}
main().catch(err=>{console.error(err);process.exit(1);});
