#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-V")) {
  console.log("ataru-agent-chat-harness 1.0.0");
  process.exit(0);
}

const readFlag = (name, fallback = null) => {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const provider = readFlag("--provider", "claude");
const sessionId = readFlag("--session-id", "dev-session");
const resumeId = readFlag("--resume");
const prompt = args[args.length - 1] && !args[args.length - 1].startsWith("--")
  ? args[args.length - 1]
  : "hello";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const writeJson = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const writeErrJson = (value) => process.stderr.write(`${JSON.stringify(value)}\n`);

async function runClaude() {
  writeJson({ type: "system", subtype: "init", session_id: sessionId, resume_id: resumeId });
  await wait(120);
  writeJson({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "收到，" }],
    },
  });
  await wait(120);
  writeJson({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: `我会处理：${prompt}` }],
    },
  });
  await wait(120);
  writeJson({ type: "result", result: "已完成模拟执行。" });
}

async function runCodex() {
  writeJson({ type: "session.started", id: sessionId, resume_id: resumeId });
  for (const text of ["收到，", "我会处理：", prompt, "\n\n已完成模拟执行。"]) {
    await wait(100);
    writeJson({ type: "agent_message_delta", delta: text });
  }
}

if (prompt.includes("harness-error")) {
  writeErrJson({ type: "error", message: "Simulated harness error" });
  process.exit(2);
}

if (prompt.includes("harness-stderr")) {
  process.stderr.write("Simulated stderr line\n");
}

try {
  if (provider === "codex") {
    await runCodex();
  } else {
    await runClaude();
  }
} catch (error) {
  writeErrJson({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
