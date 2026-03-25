// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import { z } from "zod";

// const NWS_API_BASE = "https://api.weather.gov";
// const USER_AGENT = "weather-app/1.0";

// // Create server instance
// const server = new McpServer({
//     name: "weather",
//     version: "1.0.0",
// });


import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function sanitiseTarget(raw) {
    return raw.replace(/[^\w.\-/]/g, "").slice(0, 253); // 253 = max domain length
}

async function runNmap(args, timeoutMs = 60_000) {
    const cmd = `nmap ${args.join(" ")}`;

    process.stderr.write(`[nmap-mcp] running: ${cmd}\n`);

    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });

        const output = [stdout, stderr].filter(Boolean).join("\n").trim();

        return output || "nmap ran but produced no output.";

    } catch (err) {
        if (err.killed) {
            return `Error: nmap timed out after ${timeoutMs / 1000}s. Try a smaller target or faster scan.`;
        }
        return `Error running nmap: ${err.message}`;
    }
}

const server = new McpServer({
    name: "nmap-mcp-server",
    version: "1.0.0",
});

// ── TOOL 1: ping_scan ─────────────────────────────────────────────────────────
//
// server.tool() registers one tool. It takes 4 arguments:
//   1. Tool name     — what the LLM writes when it wants to call this
//   2. Description   — what the LLM reads to decide WHEN to call this (very important!)
//   3. Parameters    — a zod schema describing what arguments this tool accepts
//   4. Handler       — the async function that actually does the work
//
// The LLM only calls this tool if its description matches the user's intent.
// Write good descriptions! Think of it as the LLM's instruction manual.

server.tool(
    "ping_scan",

    // Description shown to the LLM. Be specific about when to use this.
    "Check which hosts are alive on a network using nmap ping scan (-sn). " +
    "Use this when the user asks 'what devices are on my network', 'scan for hosts', " +
    "or 'which IPs are active'. Accepts single IP (192.168.1.1), " +
    "range (192.168.1.0/24), or hostname.",

    // Parameters: one field called "target", must be a non-empty string.
    // .describe() tells the LLM what value to put here.
    {
        target: z.string().min(1).describe(
            "IP address, hostname, or CIDR range to scan. Examples: " +
            "192.168.1.1  |  192.168.1.0/24  |  scanme.nmap.org"
        ),
    },

    // Handler: called when the LLM triggers this tool.
    // The { target } argument is whatever the LLM passed in, already validated by zod.
    async ({ target }) => {
        const safe = sanitiseTarget(target);

        // -sn = ping scan only (no port scan), much faster
        const output = await runNmap(["-sn", safe]);

        // We must return { content: [ { type: "text", text: "..." } ] }
        // That's the MCP spec format. The LLM receives this text.
        return {
            content: [{ type: "text", text: output }],
        };
    }
);


// ── TOOL 2: quick_scan ────────────────────────────────────────────────────────

server.tool(
    "quick_scan",

    "Perform a fast port scan on the most common 1000 ports using nmap (-F flag). " +
    "Use when user asks 'scan ports', 'what ports are open', or 'quick scan'. " +
    "Returns open ports and their services. Good for a first look at a host.",

    {
        target: z.string().min(1).describe(
            "IP address or hostname to scan. Example: 192.168.1.1 or scanme.nmap.org"
        ),
    },

    async ({ target }) => {
        const safe = sanitiseTarget(target);

        // -F = fast mode, scans top 1000 ports instead of all 65535
        // -T4 = faster timing (T0=paranoid, T5=insane) — T4 is a good balance
        const output = await runNmap(["-F", "-T4", safe], 90_000);

        return {
            content: [{ type: "text", text: output }],
        };
    }
);


// ── TOOL 3: port_scan ─────────────────────────────────────────────────────────

server.tool(
    "port_scan",

    "Scan specific port(s) or port ranges on a host, with service version detection. " +
    "Use when the user asks about a specific port, like 'is port 22 open', " +
    "'scan ports 80 and 443', or 'check ports 1-1024'. " +
    "Returns port state, service name, and version.",

    {
        target: z.string().min(1).describe(
            "IP address or hostname. Example: 192.168.1.1"
        ),
        ports: z.string().min(1).describe(
            "Port specification. Examples: '22'  |  '80,443'  |  '1-1024'  |  '22,80,443,8080'"
        ),
    },

    async ({ target, ports }) => {
        const safe = sanitiseTarget(target);

        // Sanitise ports too — only allow digits, commas, hyphens
        const safePorts = ports.replace(/[^\d,\-]/g, "").slice(0, 100);

        // -sV = version detection (identifies what software is on each port)
        // -p  = which ports to scan
        const output = await runNmap(["-sV", "-p", safePorts, safe], 120_000);

        return {
            content: [{ type: "text", text: output }],
        };
    }
);


// ── TOOL 4: os_detect ─────────────────────────────────────────────────────────
//
// NOTE: OS detection (-O) requires root/sudo on Linux.
// The server will still work but nmap will warn you if not root.

server.tool(
    "os_detect",

    "Attempt to detect the operating system of a host using nmap OS fingerprinting (-O). " +
    "Use when the user asks 'what OS is running', 'detect operating system', " +
    "or 'what system is at this IP'. Requires sudo/root on Linux for best results.",

    {
        target: z.string().min(1).describe(
            "IP address or hostname to fingerprint. Example: 192.168.1.1"
        ),
    },

    async ({ target }) => {
        const safe = sanitiseTarget(target);

        // -O  = OS detection
        // -sV = also grab service versions while we're at it
        // --osscan-guess = be more aggressive about guessing when nmap isn't sure
        const output = await runNmap(["-O", "-sV", "--osscan-guess", safe], 120_000);

        return {
            content: [{ type: "text", text: output }],
        };
    }
);


// ── CONNECT TRANSPORT AND START ───────────────────────────────────────────────
//
// StdioServerTransport is the "pipe" between this process and mcphost.
// mcphost spawns this script as a child process and talks to it via:
//   - stdin  → mcphost sends JSON-RPC requests to us
//   - stdout → we send JSON-RPC responses back
//
// server.connect() starts the server and begins listening.
// After this line the process stays alive, waiting for tool calls.

const transport = new StdioServerTransport();
await server.connect(transport);

// This goes to stderr (visible in mcphost logs, not JSON traffic)
process.stderr.write("[nmap-mcp] server started and waiting for tool calls\n");