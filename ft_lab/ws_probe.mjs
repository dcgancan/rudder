// Freqtrade WebSocket probe — Node 24 native WebSocket, no deps.
const URL = "ws://127.0.0.1:8080/api/v1/message/ws?token=ftlab_local_dev_ws_token";
const ws = new WebSocket(URL);
let count = 0;

const done = (reason) => {
  console.log(`\n[done] ${reason} — ${count} message(s) received`);
  try { ws.close(); } catch {}
  process.exit(0);
};

ws.addEventListener("open", () => {
  console.log("[open] connected");
  ws.send(JSON.stringify({
    type: "subscribe",
    data: ["white_list", "entry", "entry_fill", "exit", "exit_fill", "new_candle"],
  }));
  console.log("[sent] subscribe");
  ws.send(JSON.stringify({ type: "whitelist", data: "" }));
  console.log("[sent] whitelist request");
});

ws.addEventListener("message", (ev) => {
  count++;
  const msg = JSON.parse(ev.data);
  const body = JSON.stringify(msg.data);
  console.log(`[msg ${count}] type=${msg.type} data=${body.slice(0, 200)}`);
});

ws.addEventListener("error", (e) => done(`error: ${e.message ?? e}`));
ws.addEventListener("close", (e) => done(`closed code=${e.code}`));

setTimeout(() => done("timeout"), 20000);
