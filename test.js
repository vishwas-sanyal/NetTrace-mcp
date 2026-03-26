#!/usr/bin/env node
//
// test.js  —  manually test the nmap server without mcphost
//
// This spawns server.js as a subprocess, sends a raw JSON-RPC message,
// and prints the response. Great for debugging.
//
// Run: node test.js

import { spawn } from "child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "index.js");

// ── Start the MCP server as a child process ───────────────────────────────────
const server = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "inherit"],  // pipe stdin/stdout, pass through stderr
});

// ── Set up line-by-line reading of server stdout ──────────────────────────────
const rl = createInterface({ input: server.stdout });

rl.on("line", (line) => {
    try {
        const msg = JSON.parse(line);
        console.log("\n── Server response ──────────────────────────────");
        console.log(JSON.stringify(msg, null, 2));
    } catch {
        console.log("Raw line:", line);
    }
});

// ── Helper: send a JSON-RPC message to the server ────────────────────────────
function send(obj) {
    const json = JSON.stringify(obj);
    console.log("\n── Sending ──────────────────────────────────────");
    console.log(json);
    server.stdin.write(json + "\n");
}

// ── Run the test sequence ─────────────────────────────────────────────────────
setTimeout(() => {
    // Step 1: Initialize the MCP session (required handshake)
    send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
        },
    });
}, 500);

setTimeout(() => {
    // Step 2: List available tools
    send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
    });
}, 1000);

setTimeout(() => {
    // Step 3: Call the ping_scan tool on scanme.nmap.org (nmap's test server)
    send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
            name: "ping_scan",
            arguments: { target: "scanme.nmap.org" },
        },
    });
}, 1500);

// Give it 30 seconds then exit
setTimeout(() => {
    console.log("\n── Test complete ─────────────────────────────────");
    server.kill();
    process.exit(0);
}, 30_000);