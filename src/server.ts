// --- This is now the main entrypoint ---
import dotenv from "dotenv";
import path from "path";
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { loadTravelData } from "./utils.js";
import { createApp } from "./index.js"; // Import the factory function

/**
 * Starts the application server.
 */
const startServer = async () => {
	try {
		// 1. Load env vars and check them
		dotenv.config();
		console.log("Loading environment variables...");

		const PORT = process.env.PORT || 8080;
		const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY as string;
		const SUPABASE_URL = process.env.SUPABASE_URL as string;
		const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
		const DB_PATH = path.resolve("./travelData.json");
		const RAG_TABLE_NAME = "documents";
		const RAG_QUERY_NAME = "match_documents";

		if (!GOOGLE_API_KEY) throw new Error("Missing: GOOGLE_API_KEY");
		if (!SUPABASE_URL) throw new Error("Missing: SUPABASE_URL");
		if (!SUPABASE_ANON_KEY) throw new Error("Missing: SUPABASE_ANON_KEY");
		console.log("Environment variables loaded.");

		// 2. Load static data
		console.log("Loading structured data from travelData.json...");
		const cities = loadTravelData(DB_PATH);
		console.log("Structured data loaded.");

		// 3. Initialize all external services
		console.log("Initializing Gemini...");
		const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
		const chatModel = genAI.getGenerativeModel({
			model: "gemini-2.0-flash",
		});

		console.log("Initializing Supabase client...");
		const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

		console.log("Initializing Gemini Embedder...");
		const geminiEmbedder = new GoogleGenerativeAIEmbeddings({
			apiKey: GOOGLE_API_KEY,
			model: "embedding-001",
			taskType: TaskType.SEMANTIC_SIMILARITY,
		});

		console.log("Initializing Supabase Vector Store...");
		const vectorStore = new SupabaseVectorStore(geminiEmbedder, {
			client: supabaseClient,
			tableName: RAG_TABLE_NAME,
			queryName: RAG_QUERY_NAME,
		});
		console.log("Services initialized successfully.");

		// 4. Create the app by passing dependencies
		const app = createApp({ chatModel, geminiEmbedder, supabaseClient, cities, dbQueryName: RAG_QUERY_NAME });

		// 5. Start the server
		app.listen(PORT, () => {
			console.log("-----------------------------------------");
			console.log(
				`✅ Gemini Travel AI running at http://localhost:${PORT}`
			);
			console.log("-----------------------------------------");
		});
	} catch (err: any) {
		// --- THIS WILL CATCH THE REAL ERROR ---
		console.error("🔥 FAILED TO INITIALIZE SERVER 🔥");
		console.error(`Error: ${err.message}`);
		console.error(err.stack); // Print the full stack trace
		process.exit(1);
	}
};

// Start the server
startServer();
