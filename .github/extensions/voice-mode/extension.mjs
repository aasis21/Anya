// Extension: voice-mode
// A voice-in / voice-out "Voice mode" canvas for Anya. Spoken (or typed) turns
// are routed to the agent via session.sendAndWait and the reply is spoken back
// in the browser. No camera — audio only.
//
// Wiring only — the client renderer lives in ./renderer.mjs.

import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { renderHtml } from "./renderer.mjs";

// One loopback HTTP server per open canvas instance.
const servers = new Map(); // instanceId -> { server, url }

let sessionRef = null; // set after joinSession resolves

function readBody(req, limitBytes = 256 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > limitBytes) {
                reject(new Error("payload too large"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

// Pull plain-text reply out of the various shapes sendAndWait may return.
function extractReply(response) {
    const content = response?.data?.content ?? response?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
        return content
            .map((p) => (typeof p === "string" ? p : p?.text || ""))
            .join("")
            .trim();
    }
    if (content && typeof content.text === "string") return content.text.trim();
    return "";
}

async function handleTurn(req, res) {
    let payload;
    try {
        payload = JSON.parse(await readBody(req));
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad request." }));
        return;
    }

    const text = (payload?.text || "").toString().trim();

    // Stream the reply back as Server-Sent Events so the client can speak each
    // sentence as soon as it lands, instead of waiting for the whole answer.
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });
    const sse = (obj) => {
        try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    if (!text) { sse({ done: true }); res.end(); return; }

    const prompt =
        "[Anya voice mode] You are in a real-time spoken conversation. The user " +
        "is talking to you through a microphone, and your reply is read aloud by " +
        "text-to-speech. Reply in 1-3 short, natural spoken sentences — no " +
        "markdown, lists, headings, or code blocks.\n\n" +
        `User said: "${text}"`;

    let unsubs = [];
    let settled = false;
    let started = false;
    let gotText = false;
    const cleanup = () => { for (const u of unsubs) { try { u(); } catch {} } unsubs = []; };
    const finish = (extra) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        sse({ done: true, ...(extra || {}) });
        try { res.end(); } catch {}
    };
    const timer = setTimeout(() => finish(gotText ? {} : { error: "timeout" }), 60000);

    try {
        unsubs.push(
            sessionRef.on("assistant.turn_start", () => { started = true; }),
            sessionRef.on("assistant.message_start", () => { started = true; }),
            sessionRef.on("assistant.message_delta", (ev) => {
                const d = ev?.data?.deltaContent || "";
                if (d) { started = true; gotText = true; sse({ delta: d }); }
            }),
            // Fallback for non-streaming models: speak the whole message at once.
            sessionRef.on("assistant.message", (ev) => {
                if (gotText) return;
                const full = extractReply(ev);
                if (full) { gotText = true; sse({ delta: full }); }
            }),
            sessionRef.on("session.error", (ev) => finish({ error: ev?.data?.message || "error" })),
            sessionRef.on("session.idle", () => { if (started) finish(); }),
        );
        req.on("close", () => finish());
        sessionRef?.log?.(`voice turn: "${text}"`, { ephemeral: true });
        await sessionRef.send({ prompt });
    } catch (err) {
        finish({ error: `Agent error: ${err?.message || err}` });
    }
}

async function startServer(instanceId) {
    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/turn") {
            handleTurn(req, res).catch((err) => {
                if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err?.message || err) }));
            });
            return;
        }
        if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderHtml(instanceId));
            return;
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "voice-mode",
            displayName: "Voice mode",
            description:
                "Hands-free voice panel: talk to Anya out loud and hear it reply, with a reactive listening orb.",
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Voice mode", url: entry.url, status: "Voice in / voice out" };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});

sessionRef = session;
