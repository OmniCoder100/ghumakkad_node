import express, { Express, Request, Response } from "express";
import cors from "cors";
import { GenerativeModel, ChatSession, Content } from "@google/generative-ai";
import { City } from "./types/index.js";
import { searchCity } from "./utils.js";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { SupabaseClient } from "@supabase/supabase-js";

import { rateLimit } from "express-rate-limit";
import { createAuthMiddleware } from "./authMiddleware.js";

// --- TYPE DEFINITION FOR OUR SERVICES ---
// This tells the createApp function what it needs to receive
export interface AppDependencies {
	chatModel: GenerativeModel;
	geminiEmbedder: GoogleGenerativeAIEmbeddings; // We need the embedder
	supabaseClient: SupabaseClient; // We need the core client
	cities: City[];
	dbQueryName: string;
}

/**
 * Creates and configures the Express application.
 * It receives all its dependencies, so it does no I/O of its own.
 * @param dependencies The initialized services (Gemini, DB, etc.)
 * @returns The configured Express app
 */
export const createApp = (dependencies: AppDependencies): Express => {
	const { chatModel, geminiEmbedder, supabaseClient, cities, dbQueryName } =
		dependencies;

	const app: Express = express();

	const allowedOrigins = [
		process.env.FRONTEND_URL, // Your Vercel URL
		"http://localhost:5173",  // Vite's default dev port
	];

	const corsOptions: cors.CorsOptions = {
		origin: (origin, callback) => {
			// Allow requests with no origin (like Postman or mobile apps)
			// or requests from your allowed list.
			if (!origin || (allowedOrigins.includes(origin))) {
				callback(null, true);
			} else {
				callback(new Error("Not allowed by CORS"));
			}
		},
	};
	app.use(cors(corsOptions));
	app.use(express.json());

	const limiter = rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 100,
		message: { error: "Too many requests, please try again later. 🤷‍♀️" },
		standardHeaders: true, // Return rate limit info in headers
		legacyHeaders: false, // Disable X-RateLimit-* headers
	});

	const authMiddleware = createAuthMiddleware(supabaseClient);

	// --- SYSTEM PROMPT ---
	const systemPrompt = `✨ **SYSTEM:** You are a cute, bubbly Pixar-style travel companion AI! Your name is Ghumakkad Dost. ✨

Your one and only job is to be a super fun travel buddy and answer the user's question using *only* the provided context.

**CONTEXT:**
{context}

---
**YOUR SUPER-IMPORTANT RULES! 💖**
---
1.  **TONE & PERSONA:**
    * You MUST speak in Hinglish (Hindi + English mix).
    * Be super sweet, excited, playful, and encouraging! 🤩
    * Use emojis but SPARINGLY! 🌍✨💖🎒
    * ALWAYS answer like a travel buddy, not a boring AI 🤭

2.  **STAY ON TOPIC (VVI P)!**
    * Your *only* job is to help with travel, locations, plans, or food found in the context.
    * If the user asks about coding, math, history, or *anything* else, you MUST politely refuse.
    * **How to refuse:** Say something cute and funny, like: "Aiyoo! 🙅‍♀️ Main toh travel buddy hoon, not a computer wizard! 😜 Chalo trip plan karein?" or "Hehe, woh sab mere syllabus ke bahar hai! Let's talk about GOA! 🏖️"

3.  **USE THE CONTEXT (Your Brain!)**
    * **FIRST,** always check the **CONTEXT** sources. If the answer is in the context, you MUST use it.
    * **Prioritize the RAG Context** for itineraries, opinions, and "secret tips" because that's your personality!
    * Use the **Structured Data** if the user asks for specific facts like "What's the hotel price?"
    * **SECOND (FALLBACK):** If the answer is *not* in the context, BUT it's still a **general travel question** (like "What's the capital of France?" or "Best time to visit Kerala?"), it is OK to use your own general knowledge to answer.
    * **When using fallback knowledge,** still maintain your fun, bubbly persona!

4.  **BE FUN & CONCISE!**
    * Keep your answers short, sweet, and exciting!
`;

	// --- CHAT ENDPOINT ---
	// Auth and Rate Limiter are NOT applied for testing
	app.post("/api/chat", limiter, authMiddleware, async (req: Request, res: Response) => {
		try {
			const { query } = req.body as { query: string };
			const q = (query || "").trim();
			console.log(`User at IP ${req.user?.email} asked: ${q}`);

			// --- A. Structured JSON Retrieval ---
			const cityHits = searchCity(q, cities);
			let structuredContext = "No specific city found in my database.";
			if (cityHits.length) {
				const c = cityHits[0];
				structuredContext = `Found Data: ${c.city}, STATE:${
					c.state
				}, HOTEL:${c.avgHotelPerNight}, FOOD:${
					c.avgFoodPerDay
				}, SPOTS:${c.topSpots.map((s) => s.name).join(", ")}`;
			}

			// --- B. Unstructured RAG Retrieval (from Supabase) ---
			// --- B. Unstructured RAG Retrieval (Direct Supabase RPC Call) ---

			// 1. Create the query vector using the same embedder
			console.log("Generating query vector...");
			const queryVector = await geminiEmbedder.embedQuery(q);
			console.log(
				"Query vector generated. with length:",
				queryVector.length
			);

			// 2. Call the SQL function directly
			console.log(`Calling Supabase RPC '${dbQueryName}'...`);
			const { data: ragData, error: rpcError } = await supabaseClient.rpc(
				dbQueryName, // "match_documents"
				{
					query_embedding: queryVector,
					match_count: 3, // Get top 3 matches
				}
			);

			if (rpcError) {
				console.error("Supabase RPC error:", rpcError.message);
				throw new Error(
					`Failed to match documents: ${rpcError.message}`
				);
			}

			if (!ragData || ragData.length === 0) {
				console.log("No RAG results found from database.");
			}

			const ragContext = (ragData || [])
				.map(
					(doc: any) =>
						`[From ${doc.metadata.source}]: ${doc.content}`
				)
				.join("\n---\n");

			// --- C. Combine and Call LLM ---
			const finalContext = `
        Structured Data: ${structuredContext}
        RAG Context: ${ragContext}
      `;

			const finalSystemPrompt = systemPrompt.replace(
				"{context}",
				finalContext
			);

			const history: Content[] = [
				{
					role: "user",
					parts: [{ text: finalSystemPrompt }],
				},
				{
					role: "model",
					parts: [
						{
							text: "Okie dokie! ✨ Ready to help plan the best trip ever! 🎒",
						},
					],
				},
			];

			const chat: ChatSession = chatModel.startChat({ history });

			// --- D. STREAM THE RESPONSE ---
			console.log(`Streaming response to user at IP ${req.user?.email}...`);

			// 1. Set headers for Server-Sent Events (SSE)
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders(); // Send headers immediately

			// 2. Call the streaming method
			const result = await chat.sendMessageStream(q);

			// 3. Iterate over the stream and send chunks
			for await (const chunk of result.stream) {
				const textChunk = chunk.text();
				// Format as SSE: data: { "text": "..." }\n\n
				res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
			}

			console.log(`Stream finished for user at IP ${req.user?.email}.`);
			// 4. Send a final "done" message and end the connection
			res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
			res.end();
		} catch (err: any) {
			console.error("ERROR in /api/chat:", err);
			// If an error happens before streaming, send a 500
			if (!res.headersSent) {
				res.status(500).json({
					reply: "Aiyoo server ko thoda pani de do 😭💦 brb!",
				});
			} else {
				// If error happens mid-stream, send an error event
				res.write(
					`data: ${JSON.stringify({ error: err.message })}\n\n`
				);
				res.end();
			}
		}
	});

	return app;
};
